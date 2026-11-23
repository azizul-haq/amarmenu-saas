-- Migration: 20261123000082_live_table_locking_and_quota_enforcement.sql
-- Description: Enforce DB-level table limits, atomic table locking in place_order,
-- and automatic table release upon order completion/cancellation.

-- 1. Database-Level Table Quota Enforcement Trigger
CREATE OR REPLACE FUNCTION public.check_restaurant_table_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_max_tables INT;
  v_current_count INT;
  v_plan_name TEXT;
BEGIN
  -- 1. Look up active plan max_tables for this restaurant
  SELECT p.max_tables, p.display_name
  INTO v_max_tables, v_plan_name
  FROM subscriptions s
  JOIN plans p ON p.name = s.plan_code OR p.id = s.plan_id
  WHERE s.restaurant_id = NEW.restaurant_id
    AND s.status IN ('active', 'trial', 'grace_period')
  ORDER BY s.created_at DESC
  LIMIT 1;

  -- Fallback to restaurants.subscription_plan if subscription record not found
  IF v_max_tables IS NULL AND v_plan_name IS NULL THEN
    SELECT p.max_tables, p.display_name
    INTO v_max_tables, v_plan_name
    FROM restaurants r
    JOIN plans p ON p.name = COALESCE(r.subscription_plan, 'growth')
    WHERE r.id = NEW.restaurant_id
    LIMIT 1;
  END IF;

  -- If max_tables is NULL, plan allows unlimited tables (Enterprise)
  IF v_max_tables IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_current_count
    FROM restaurant_tables
    WHERE restaurant_id = NEW.restaurant_id
      AND deleted_at IS NULL;

    IF v_current_count >= v_max_tables THEN
      RAISE EXCEPTION 'Plan table limit reached: Your current % plan allows a maximum of % tables. Please upgrade your plan to add more tables.',
        COALESCE(v_plan_name, 'Subscription'), v_max_tables
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_restaurant_table_quota ON restaurant_tables;
CREATE TRIGGER trg_enforce_restaurant_table_quota
BEFORE INSERT ON restaurant_tables
FOR EACH ROW
EXECUTE FUNCTION public.check_restaurant_table_quota();

-- 2. Automatic Table Release Trigger on Order Completion or Cancellation
CREATE OR REPLACE FUNCTION public.auto_release_table_on_order_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_remaining_active_orders INT;
BEGIN
  -- Check if status is transitioning to a terminal state (completed, cancelled, rejected)
  IF (NEW.status IN ('completed', 'cancelled', 'rejected')) AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NEW.table_id IS NOT NULL THEN
      -- Check if any other active orders exist on this table
      SELECT COUNT(*)
      INTO v_remaining_active_orders
      FROM orders
      WHERE table_id = NEW.table_id
        AND id <> NEW.id
        AND status NOT IN ('completed', 'cancelled', 'rejected');

      -- If no other active orders exist, reset table status to 'available'
      IF v_remaining_active_orders = 0 THEN
        UPDATE restaurant_tables
        SET status = 'available', updated_at = NOW()
        WHERE id = NEW.table_id
          AND status <> 'available';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_release_table ON orders;
CREATE TRIGGER trg_auto_release_table
AFTER UPDATE OF status ON orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_release_table_on_order_close();

-- 3. Atomic Table Locking in place_order RPC
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
  p_client_total NUMERIC DEFAULT NULL,
  p_table_id UUID DEFAULT NULL
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

  -- Normalize order type
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

  -- 4. Table Verification & Atomic Locking for Dine-In Orders:
  IF v_effective_order_type IN ('dine_in', 'qr', 'table') THEN
    IF p_table_id IS NOT NULL THEN
      SELECT id, table_number, status, is_active, deleted_at
      INTO v_table
      FROM restaurant_tables
      WHERE id = p_table_id AND restaurant_id = p_restaurant_id
      FOR UPDATE;
    ELSIF p_qr_token IS NOT NULL AND trim(p_qr_token) <> '' THEN
      SELECT id, table_number, status, is_active, deleted_at
      INTO v_table
      FROM restaurant_tables
      WHERE qr_token = p_qr_token AND restaurant_id = p_restaurant_id
      FOR UPDATE;
    ELSE
      RAISE EXCEPTION 'Please select an available table for dine-in orders.';
    END IF;

    IF v_table.id IS NULL THEN
      RAISE EXCEPTION 'Selected table was not found';
    END IF;

    IF v_table.deleted_at IS NOT NULL OR NOT v_table.is_active THEN
      RAISE EXCEPTION 'Table "%" is inactive or closed', v_table.table_number;
    END IF;

    -- Strict atomic lock check
    IF v_table.status <> 'available' THEN
      RAISE EXCEPTION 'This table is already occupied. Please select another available table.';
    END IF;

    -- Atomically lock table
    UPDATE restaurant_tables
    SET status = 'occupied', updated_at = NOW()
    WHERE id = v_table.id;

    v_table_id := v_table.id;
    v_table_number := v_table.table_number;
  ELSE
    -- Takeaway / Counter orders do not occupy a table
    v_table_id := NULL;
    v_table_number := NULL;
  END IF;

  -- 5. Server-Side Price Recalculation & Tampering Prevention
  FOR v_item_elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item_elem->>'menu_item_id')::UUID;
    v_item_qty := COALESCE((v_item_elem->>'quantity')::INT, 1);

    IF v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item', v_item_qty;
    END IF;

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

    v_unit_price := v_item_record.base_price;

    -- Check Size Variant
    v_selected_size := v_item_elem->'selected_size';
    IF v_selected_size IS NOT NULL AND v_selected_size != 'null'::jsonb AND v_selected_size ? 'name' AND trim(v_selected_size->>'name') <> '' THEN
      v_size_name := v_selected_size->>'name';
      v_size_found := false;

      IF v_item_record.sizes IS NOT NULL AND jsonb_typeof(v_item_record.sizes) = 'array' THEN
        FOR v_db_size IN SELECT * FROM jsonb_array_elements(v_item_record.sizes)
        LOOP
          IF v_db_size->>'name' = v_size_name THEN
            v_unit_price := (v_db_size->>'price')::NUMERIC;
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
              v_unit_price := v_unit_price + (v_db_addon->>'price')::NUMERIC;
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

    v_line_total := v_unit_price * v_item_qty;

    -- Anti-tampering check
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

    v_calculated_subtotal := v_calculated_subtotal + v_line_total;

    v_sanitized_items := v_sanitized_items || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item_record.id,
        'name', v_item_record.name,
        'name_bn', v_item_record.name_bn,
        'quantity', v_item_qty,
        'base_price', v_item_record.base_price,
        'unit_price', v_unit_price,
        'item_total', v_line_total,
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
    'table_id', v_table_id,
    'table_number', v_table_number,
    'is_duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, UUID) TO anon, authenticated, service_role;

-- 4. Enable Public Reading & Realtime on restaurant_tables
DROP POLICY IF EXISTS "tables_select_public" ON restaurant_tables;
CREATE POLICY "tables_select_public"
ON restaurant_tables FOR SELECT
TO anon, authenticated
USING (
  deleted_at IS NULL
  AND is_active = TRUE
);

ALTER TABLE restaurant_tables REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'restaurant_tables'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE restaurant_tables;
  END IF;
END $$;
