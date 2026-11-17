-- ==============================================================================
-- AmarMenu Migration: Atomic place_order Procedure with Anti-Tampering & Sequences
-- Version: 20261117000027_place_order_procedure.sql
-- ==============================================================================

-- 1. Add idempotency_key to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_restaurant_idempotency 
ON orders(restaurant_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 2. Create gap-free order sequences per restaurant
CREATE TABLE IF NOT EXISTS restaurant_order_sequences (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  current_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Core atomic place_order function
CREATE OR REPLACE FUNCTION place_order(
  p_restaurant_id UUID,
  p_order_type TEXT, -- 'qr', 'counter', 'table', 'phone'
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_items JSONB,
  p_customer_notes TEXT DEFAULT NULL,
  p_qr_token TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_client_subtotal NUMERIC DEFAULT NULL,
  p_client_total NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_existing_order RECORD;
  v_recent_count INT;
  v_restaurant_active BOOLEAN;
  v_vat_percentage NUMERIC;
  v_table RECORD;
  v_table_id UUID := NULL;
  v_table_number TEXT := NULL;
  
  v_item_elem JSONB;
  v_item_id UUID;
  v_item_qty INT;
  v_db_item RECORD;
  v_unit_price NUMERIC;
  v_line_total NUMERIC;
  v_client_line_total NUMERIC;
  v_selected_size JSONB;
  v_selected_addons JSONB;
  v_size_name TEXT;
  v_size_found BOOLEAN;
  v_db_size JSONB;
  v_addon_item JSONB;
  v_addon_name TEXT;
  v_addon_found BOOLEAN;
  v_db_addon JSONB;

  v_calculated_subtotal NUMERIC := 0.00;
  v_calculated_tax NUMERIC := 0.00;
  v_calculated_total NUMERIC := 0.00;
  v_sanitized_items JSONB := '[]'::jsonb;
  
  v_seq BIGINT;
  v_order_number TEXT;
  v_new_order_id UUID;
BEGIN
  -- Basic Input Validation
  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant ID is required';
  END IF;

  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty. Please select at least one item.';
  END IF;

  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) != '' THEN
    SELECT id, order_number, subtotal, tax, total, status
    INTO v_existing_order
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND idempotency_key = p_idempotency_key;

    IF v_existing_order.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', v_existing_order.id,
        'order_number', v_existing_order.order_number,
        'subtotal', v_existing_order.subtotal,
        'tax', v_existing_order.tax,
        'total', v_existing_order.total,
        'status', v_existing_order.status,
        'is_duplicate', true
      );
    END IF;
  END IF;

  -- 2. Rate Limiting Check (Max 5 orders per phone per 5 minutes)
  SELECT COUNT(*) INTO v_recent_count
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND customer_phone = p_customer_phone
    AND created_at > NOW() - INTERVAL '5 minutes';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many orders from this phone number. Please wait a few minutes.';
  END IF;

  -- 3. Restaurant Verification & Configuration
  SELECT is_active, COALESCE(vat_percentage, 5.00) 
  INTO v_restaurant_active, v_vat_percentage
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF v_restaurant_active IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF NOT v_restaurant_active THEN
    RAISE EXCEPTION 'Restaurant is currently inactive';
  END IF;

  -- 4. QR Token Verification (for QR or table orders)
  IF p_order_type = 'qr' OR p_qr_token IS NOT NULL THEN
    IF p_qr_token IS NULL OR trim(p_qr_token) = '' THEN
      RAISE EXCEPTION 'QR token is required for dine-in QR orders';
    END IF;

    SELECT id, table_number, is_active, deleted_at
    INTO v_table
    FROM restaurant_tables
    WHERE restaurant_id = p_restaurant_id
      AND qr_token = p_qr_token;

    IF v_table.id IS NULL THEN
      RAISE EXCEPTION 'Invalid table QR token';
    END IF;

    IF v_table.deleted_at IS NOT NULL OR NOT v_table.is_active THEN
      RAISE EXCEPTION 'Table is inactive or closed';
    END IF;

    v_table_id := v_table.id;
    v_table_number := v_table.table_number;
  END IF;

  -- 5. Server-Side Price Recalculation & Tampering Prevention
  FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item_elem->>'menu_item_id')::UUID;
    v_item_qty := COALESCE((v_item_elem->>'quantity')::INT, 1);

    IF v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item', v_item_qty;
    END IF;

    -- Query item directly from database truths
    SELECT id, name, base_price, is_available, deleted_at, sizes, addons
    INTO v_db_item
    FROM menu_items
    WHERE id = v_item_id AND restaurant_id = p_restaurant_id;

    IF v_db_item.id IS NULL OR v_db_item.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Menu item not found or has been deleted';
    END IF;

    IF NOT v_db_item.is_available THEN
      RAISE EXCEPTION 'Menu item "%" is currently unavailable', v_db_item.name;
    END IF;

    -- Authoritative base price
    v_unit_price := v_db_item.base_price;

    -- Check Size Variant
    v_selected_size := v_item_elem->'selected_size';
    IF v_selected_size IS NOT NULL AND v_selected_size != 'null'::jsonb AND v_selected_size ? 'name' THEN
      v_size_name := v_selected_size->>'name';
      v_size_found := false;

      IF v_db_item.sizes IS NOT NULL THEN
        FOR v_db_size IN SELECT * FROM jsonb_array_elements(v_db_item.sizes)
        LOOP
          IF v_db_size->>'name' = v_size_name THEN
            v_unit_price := (v_db_size->>'price')::NUMERIC;
            v_size_found := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_size_found THEN
        RAISE EXCEPTION 'Invalid size "%" specified for item "%"', v_size_name, v_db_item.name;
      END IF;
    END IF;

    -- Check Add-ons
    v_selected_addons := v_item_elem->'selected_addons';
    IF v_selected_addons IS NOT NULL AND v_selected_addons != 'null'::jsonb AND jsonb_array_length(v_selected_addons) > 0 THEN
      FOR v_addon_item IN SELECT * FROM jsonb_array_elements(v_selected_addons)
      LOOP
        v_addon_name := v_addon_item->>'name';
        v_addon_found := false;

        IF v_db_item.addons IS NOT NULL THEN
          FOR v_db_addon IN SELECT * FROM jsonb_array_elements(v_db_item.addons)
          LOOP
            IF v_db_addon->>'name' = v_addon_name THEN
              v_unit_price := v_unit_price + (v_db_addon->>'price')::NUMERIC;
              v_addon_found := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_addon_found THEN
          RAISE EXCEPTION 'Invalid add-on "%" specified for item "%"', v_addon_name, v_db_item.name;
        END IF;
      END LOOP;
    END IF;

    v_line_total := v_unit_price * v_item_qty;

    -- Anti-tampering check: verify if client supplied manipulated price
    IF v_item_elem ? 'client_price' OR v_item_elem ? 'base_price' OR v_item_elem ? 'item_total' THEN
      v_client_line_total := COALESCE(
        (v_item_elem->>'item_total')::NUMERIC,
        COALESCE((v_item_elem->>'client_price')::NUMERIC, (v_item_elem->>'base_price')::NUMERIC) * v_item_qty
      );

      IF ABS(v_client_line_total - v_line_total) > 0.01 THEN
        RAISE EXCEPTION 'Price tampering detected for item "%": expected ৳%, received ৳%',
          v_db_item.name, v_line_total, v_client_line_total;
      END IF;
    END IF;

    v_calculated_subtotal := v_calculated_subtotal + v_line_total;

    -- Append sanitized item with verified pricing
    v_sanitized_items := v_sanitized_items || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_db_item.id,
        'name', v_db_item.name,
        'quantity', v_item_qty,
        'base_price', v_db_item.base_price,
        'unit_price', v_unit_price,
        'item_total', v_line_total,
        'selected_size', v_selected_size,
        'selected_addons', v_selected_addons,
        'special_instructions', v_item_elem->>'special_instructions'
      )
    );
  END LOOP;

  -- 6. Subtotal Verification
  IF p_client_subtotal IS NOT NULL AND ABS(p_client_subtotal - v_calculated_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'Subtotal mismatch detected: calculated ৳%, received ৳%',
      v_calculated_subtotal, p_client_subtotal;
  END IF;

  -- 7. VAT & Total Calculation
  v_calculated_tax := ROUND(v_calculated_subtotal * (v_vat_percentage / 100.00), 2);
  v_calculated_total := v_calculated_subtotal + v_calculated_tax;

  IF p_client_total IS NOT NULL AND ABS(p_client_total - v_calculated_total) > 0.05 THEN
    RAISE EXCEPTION 'Total mismatch detected: calculated ৳%, received ৳%',
      v_calculated_total, p_client_total;
  END IF;

  -- 8. Gap-Free Order Number via Atomic Sequence
  INSERT INTO restaurant_order_sequences (restaurant_id, current_number, updated_at)
  VALUES (p_restaurant_id, 1, NOW())
  ON CONFLICT (restaurant_id)
  DO UPDATE SET
    current_number = restaurant_order_sequences.current_number + 1,
    updated_at = NOW()
  RETURNING current_number INTO v_seq;

  v_order_number := 'ORD-' || to_char(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  -- 9. Insert Validated Order
  INSERT INTO orders (
    restaurant_id,
    table_id,
    order_number,
    order_type,
    table_number,
    customer_name,
    customer_phone,
    items,
    subtotal,
    tax,
    discount,
    total,
    status,
    customer_notes,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    v_table_id,
    v_order_number,
    p_order_type,
    v_table_number,
    p_customer_name,
    p_customer_phone,
    v_sanitized_items,
    v_calculated_subtotal,
    v_calculated_tax,
    0.00,
    v_calculated_total,
    'pending',
    p_customer_notes,
    p_idempotency_key,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_new_order_id;

  -- 10. Return Order Receipt
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'order_number', v_order_number,
    'subtotal', v_calculated_subtotal,
    'tax', v_calculated_tax,
    'total', v_calculated_total,
    'is_duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION place_order(
  UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC
) TO anon, authenticated;
