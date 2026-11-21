-- AmarMenu Migration: Add Waiter Tracking and Expand Order Types
-- Version: 20261121000075_add_waiter_name_and_order_type_dinein_takeaway.sql

-- 1. Add waiter_name and accepted_by_name columns to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS waiter_name TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS accepted_by_name TEXT;

-- 2. Expand orders_order_type_check to support 'dine_in' and 'takeaway'
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_check 
  CHECK (order_type = ANY (ARRAY['dine_in'::text, 'takeaway'::text, 'qr'::text, 'counter'::text, 'phone'::text, 'table'::text]));
ALTER TABLE public.orders ALTER COLUMN order_type SET DEFAULT 'dine_in';

-- 3. Update transition_order_status RPC to record waiter_name and accepted_by_name
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id UUID,
  p_new_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_payment_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_order RECORD;
  v_staff RECORD;
  v_staff_name TEXT;
BEGIN
  v_caller_id := auth.uid();
  SELECT is_super_admin() INTO v_is_super;

  IF v_caller_id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, restaurant_id, status, order_number, table_number, verified_by, waiter_name, accepted_by_name, cancellation_reason, rejection_reason
  INTO v_order
  FROM orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_super THEN
    IF current_restaurant_id() <> v_order.restaurant_id THEN
      RAISE EXCEPTION 'Unauthorized: You can only transition orders for your own restaurant' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT v_is_super THEN
    IF p_new_status IN ('accepted', 'rejected') THEN
      IF NOT has_permission(v_order.restaurant_id, 'confirm_order') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot confirm or reject orders' USING ERRCODE = '42501';
      END IF;
    ELSIF p_new_status IN ('preparing', 'ready') THEN
      IF NOT has_permission(v_order.restaurant_id, 'update_kitchen_status') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot update kitchen status' USING ERRCODE = '42501';
      END IF;
    ELSIF p_new_status = 'completed' THEN
      IF NOT has_permission(v_order.restaurant_id, 'settle_bill') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot complete orders' USING ERRCODE = '42501';
      END IF;
    ELSIF p_new_status = 'cancelled' THEN
      IF NOT has_permission(v_order.restaurant_id, 'void_order') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot cancel orders' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  SELECT id, full_name, role INTO v_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_id AND restaurant_id = v_order.restaurant_id
  LIMIT 1;

  v_staff_name := COALESCE(v_staff.full_name, 'Staff');

  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  UPDATE orders
  SET
    status = p_new_status,
    verified_by = CASE WHEN p_new_status = 'accepted' AND verified_by IS NULL THEN v_caller_id ELSE verified_by END,
    waiter_name = CASE WHEN p_new_status = 'accepted' AND (waiter_name IS NULL OR waiter_name = '') THEN v_staff_name ELSE waiter_name END,
    accepted_by_name = CASE WHEN p_new_status = 'accepted' AND (accepted_by_name IS NULL OR accepted_by_name = '') THEN v_staff_name ELSE accepted_by_name END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN COALESCE(p_notes, rejection_reason) ELSE rejection_reason END,
    cancellation_reason = CASE WHEN p_new_status = 'cancelled' THEN COALESCE(p_notes, cancellation_reason) ELSE cancellation_reason END,
    payment_method = COALESCE(p_payment_method, payment_method),
    payment_status = COALESCE(p_payment_status, payment_status),
    payment_transaction_id = COALESCE(p_payment_transaction_id, payment_transaction_id),
    updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (
    order_id,
    restaurant_id,
    from_status,
    to_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    v_order.restaurant_id,
    v_order.status,
    p_new_status,
    v_caller_id,
    p_notes
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', p_new_status,
    'waiter_name', v_staff_name
  );
END;
$$;

-- 4. Update place_order to allow dine_in & takeaway seamlessly
CREATE OR REPLACE FUNCTION public.place_order(
  p_restaurant_id UUID,
  p_order_type TEXT,
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
  v_item_record RECORD;
  v_unit_price NUMERIC(10, 2);
  v_line_total NUMERIC(10, 2);
  v_client_line_total NUMERIC(10, 2);
  v_selected_size JSONB;
  v_size_name TEXT;
  v_size_found BOOLEAN;
  v_db_size JSONB;
  v_selected_addons JSONB;
  v_addon_item JSONB;
  v_addon_name TEXT;
  v_addon_found BOOLEAN;
  v_db_addon JSONB;
  
  v_calculated_subtotal NUMERIC(10, 2) := 0.00;
  v_calculated_tax NUMERIC(10, 2) := 0.00;
  v_calculated_total NUMERIC(10, 2) := 0.00;
  v_sanitized_items JSONB := '[]'::JSONB;
  
  v_seq BIGINT;
  v_order_number TEXT;
  v_new_order_id UUID;
  v_final_order_number TEXT;
  v_effective_order_type TEXT;

  v_staff_name TEXT := NULL;
BEGIN
  -- Basic Input Validation
  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant ID is required';
  END IF;

  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty. Please select at least one item.';
  END IF;

  -- Normalize order type (defaults to 'dine_in')
  IF p_order_type IS NULL OR trim(p_order_type) = '' THEN
    v_effective_order_type := 'dine_in';
  ELSE
    v_effective_order_type := lower(trim(p_order_type));
  END IF;

  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    SELECT id, order_number, subtotal, tax, total, status
    INTO v_existing_order
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;

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
  SELECT COUNT(*)
  INTO v_recent_count
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND customer_phone = p_customer_phone
    AND created_at > (NOW() - INTERVAL '5 minutes');

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many orders from this phone number. Please wait a few minutes.';
  END IF;

  -- 3. Restaurant Active & VAT Verification
  SELECT is_active, COALESCE(default_vat_rate, 5.00)
  INTO v_restaurant_active, v_vat_percentage
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF v_restaurant_active IS NULL THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF NOT v_restaurant_active THEN
    RAISE EXCEPTION 'Restaurant is currently inactive';
  END IF;

  -- 4. Table Verification:
  -- If order type is explicitly 'qr', valid qr_token is required
  IF v_effective_order_type = 'qr' THEN
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
  ELSIF p_qr_token IS NOT NULL AND trim(p_qr_token) <> '' THEN
    -- If qr_token is supplied for any other order type, verify and resolve table
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

    -- Query authoritative truths using base_price
    SELECT id, name, name_bn, base_price, is_available, deleted_at, sizes, addons
    INTO v_item_record
    FROM menu_items
    WHERE id = v_item_id AND restaurant_id = p_restaurant_id;

    IF v_item_record.id IS NULL OR v_item_record.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Menu item not found or has been deleted';
    END IF;

    IF NOT v_item_record.is_available THEN
      RAISE EXCEPTION 'Item "%" is currently unavailable', v_item_record.name;
    END IF;

    v_item_unit_price := v_item_record.base_price;

    -- Check Size Variant
    v_selected_size := v_item_elem->'selected_size';
    IF v_selected_size IS NOT NULL AND v_selected_size != 'null'::jsonb AND v_selected_size ? 'name' AND trim(v_selected_size->>'name') <> '' THEN
      v_size_name := v_selected_size->>'name';
      v_size_found := false;

      IF v_item_record.sizes IS NOT NULL AND jsonb_typeof(v_item_record.sizes) = 'array' THEN
        FOR v_db_size IN SELECT * FROM jsonb_array_elements(v_item_record.sizes)
        LOOP
          IF v_db_size->>'name' = v_size_name THEN
            v_item_unit_price := (v_db_size->>'price')::NUMERIC;
            v_size_found := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_size_found THEN
        RAISE EXCEPTION 'Invalid size "%" specified for item "%"', v_size_name, v_item_record.name;
      END IF;
    END IF;

    -- Check Add-ons
    v_selected_addons := v_item_elem->'selected_addons';
    IF v_selected_addons IS NOT NULL AND v_selected_addons != 'null'::jsonb AND jsonb_typeof(v_selected_addons) = 'array' AND jsonb_array_length(v_selected_addons) > 0 THEN
      FOR v_addon_item IN SELECT * FROM jsonb_array_elements(v_selected_addons)
      LOOP
        v_addon_name := v_addon_item->>'name';
        v_addon_found := false;

        IF v_item_record.addons IS NOT NULL AND jsonb_typeof(v_item_record.addons) = 'array' THEN
          FOR v_db_addon IN SELECT * FROM jsonb_array_elements(v_item_record.addons)
          LOOP
            IF v_db_addon->>'name' = v_addon_name THEN
              v_item_unit_price := v_item_unit_price + (v_db_addon->>'price')::NUMERIC;
              v_addon_found := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_addon_found THEN
          RAISE EXCEPTION 'Invalid add-on "%" specified for item "%"', v_addon_name, v_item_record.name;
        END IF;
      END LOOP;
    END IF;

    v_item_line_total := v_item_unit_price * v_item_qty;

    -- Anti-tampering check: verify if client supplied manipulated price
    IF v_item_elem ? 'client_price' OR v_item_elem ? 'base_price' OR v_item_elem ? 'item_total' THEN
      v_client_line_total := COALESCE(
        (v_item_elem->>'item_total')::NUMERIC,
        COALESCE((v_item_elem->>'client_price')::NUMERIC, (v_item_elem->>'base_price')::NUMERIC) * v_item_qty
      );

      IF ABS(v_client_line_total - v_line_total) > 0.05 THEN
        RAISE EXCEPTION 'Price tampering detected for item "%": expected ৳%, received ৳%',
          v_item_record.name, v_line_total, v_client_line_total;
      END IF;
    END IF;

    v_calculated_subtotal := v_calculated_subtotal + v_item_line_total;

    -- Build sanitized item payload
    v_sanitized_items := v_sanitized_items || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item_record.id,
        'name', v_item_record.name,
        'name_bn', v_item_record.name_bn,
        'quantity', v_item_qty,
        'base_price', v_item_record.base_price,
        'unit_price', v_item_unit_price,
        'item_total', v_item_line_total,
        'selected_size', v_selected_size,
        'selected_addons', COALESCE(v_selected_addons, '[]'::JSONB),
        'special_instructions', v_item_elem->>'special_instructions'
      )
    );
  END LOOP;

  -- 6. Subtotal Verification
  IF p_client_subtotal IS NOT NULL AND ABS(p_client_subtotal - v_calculated_subtotal) > 0.05 THEN
    RAISE EXCEPTION 'Subtotal mismatch detected: calculated ৳%, received ৳%',
      v_calculated_subtotal, p_client_subtotal;
  END IF;

  -- 7. VAT & Total Calculation
  IF v_vat_percentage > 1.0 THEN
    v_calculated_tax := ROUND(v_calculated_subtotal * (v_vat_percentage / 100.00), 2);
  ELSE
    v_calculated_tax := ROUND(v_calculated_subtotal * v_vat_percentage, 2);
  END IF;
  v_calculated_total := v_calculated_subtotal + v_calculated_tax;

  IF p_client_total IS NOT NULL AND ABS(p_client_total - v_calculated_total) > 0.05 THEN
    RAISE EXCEPTION 'Total mismatch detected: calculated ৳%, received ৳%',
      v_calculated_total, p_client_total;
  END IF;

  -- Check if caller is authenticated staff
  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_staff_name
    FROM restaurant_staff
    WHERE auth_user_id = auth.uid() AND restaurant_id = p_restaurant_id
    LIMIT 1;
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
    waiter_name,
    accepted_by_name,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    v_table_id,
    v_order_number,
    v_effective_order_type,
    CASE WHEN v_effective_order_type IN ('takeaway', 'counter') THEN NULL ELSE v_table_number END,
    COALESCE(p_customer_name, 'Walking Customer'),
    p_customer_phone,
    v_sanitized_items,
    v_calculated_subtotal,
    v_calculated_tax,
    0.00,
    v_calculated_total,
    'pending',
    p_customer_notes,
    p_idempotency_key,
    v_staff_name,
    v_staff_name,
    NOW(),
    NOW()
  )
  RETURNING id, order_number INTO v_new_order_id, v_final_order_number;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'order_number', v_final_order_number,
    'subtotal', v_calculated_subtotal,
    'tax', v_calculated_tax,
    'total', v_calculated_total,
    'status', 'pending',
    'is_duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_order(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated, service_role;
