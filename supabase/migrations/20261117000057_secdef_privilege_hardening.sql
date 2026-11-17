-- ==============================================================================
-- AmarMenu Migration: SECURITY DEFINER Privilege Hardening & Allowlist
-- Version: 20261117000057_secdef_privilege_hardening.sql
-- ==============================================================================

-- 1. DROP test helpers and temporary inspection functions
DROP FUNCTION IF EXISTS test_execute_settlement_as_service_role(TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS test_execute_fail_as_service_role(TEXT, TEXT);
DROP FUNCTION IF EXISTS get_project_jwt_secret();

-- 2. Add PIN attempt rate limiting / lockout columns to restaurant_staff
ALTER TABLE restaurant_staff
  ADD COLUMN IF NOT EXISTS failed_pin_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ DEFAULT NULL;

-- 3. Update get_active_cash_shift with cross-tenant authorization check and standard keys
CREATE OR REPLACE FUNCTION get_active_cash_shift(
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_shift RECORD;
  v_opener_name TEXT;
  v_cash_sales NUMERIC(10,2) := 0.00;
  v_digital_sales NUMERIC(10,2) := 0.00;
  v_completed_orders INT := 0;
  v_voided_orders INT := 0;
  v_expected_cash NUMERIC(10,2) := 0.00;
BEGIN
  -- Strict cross-tenant check: must match current staff restaurant or super admin
  IF p_restaurant_id <> current_restaurant_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_shift
  FROM cash_shifts
  WHERE restaurant_id = p_restaurant_id
    AND status = 'open'
  ORDER BY opening_time DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_active_shift', false);
  END IF;

  -- Get opener name
  SELECT full_name INTO v_opener_name
  FROM restaurant_staff
  WHERE auth_user_id = v_shift.opened_by
  LIMIT 1;

  -- Live calculate sales during shift
  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status IN ('paid', 'completed') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method != 'cash' AND status IN ('paid', 'completed') THEN amount ELSE 0 END), 0.00),
    COUNT(DISTINCT CASE WHEN status IN ('paid', 'completed') THEN order_id ELSE NULL END)
  INTO v_cash_sales, v_digital_sales, v_completed_orders
  FROM payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= v_shift.opening_time;

  -- Count voids during shift
  SELECT COUNT(*)
  INTO v_voided_orders
  FROM audit_logs
  WHERE restaurant_id = p_restaurant_id
    AND action = 'void_order'
    AND created_at >= v_shift.opening_time;

  v_expected_cash := v_shift.opening_float + v_cash_sales;

  RETURN jsonb_build_object(
    'has_active_shift', true,
    'shift_id', v_shift.id,
    'restaurant_id', v_shift.restaurant_id,
    'opened_by_name', COALESCE(v_opener_name, 'Cashier'),
    'opening_float', v_shift.opening_float,
    'opening_time', v_shift.opening_time,
    'status', v_shift.status,
    'live_cash_sales', v_cash_sales,
    'live_digital_sales', v_digital_sales,
    'live_total_sales', (v_cash_sales + v_digital_sales),
    'live_expected_cash', v_expected_cash,
    'live_completed_orders', v_completed_orders,
    'live_voids_count', v_voided_orders
  );
END;
$$;

-- 4. Update verify_manager_pin with attempt rate limiting, lockout, and audit logging
CREATE OR REPLACE FUNCTION verify_manager_pin(
  p_restaurant_id UUID,
  p_pin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller RECORD;
  v_manager_id UUID;
  v_failed_count INT;
  v_lock_until TIMESTAMPTZ;
  v_is_super BOOLEAN;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Manager PIN must be at least 4 digits';
  END IF;

  SELECT is_super_admin() INTO v_is_super;

  -- Lookup caller in restaurant_staff
  SELECT id, restaurant_id, full_name, role, failed_pin_attempts, pin_locked_until
  INTO v_caller
  FROM restaurant_staff
  WHERE auth_user_id = auth.uid()
    AND is_active = TRUE
    AND (restaurant_id = p_restaurant_id OR v_is_super);

  IF v_caller.id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Unauthorized: Active staff member profile required' USING ERRCODE = '42501';
  END IF;

  -- Check if caller is currently locked out
  IF v_caller.pin_locked_until IS NOT NULL AND v_caller.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'Manager PIN verification locked out until %. Try again later.', v_caller.pin_locked_until USING ERRCODE = 'P0008';
  END IF;

  -- Check PIN against active managers/owners in the restaurant
  SELECT id INTO v_manager_id
  FROM restaurant_staff
  WHERE restaurant_id = p_restaurant_id
    AND role IN ('owner', 'manager')
    AND is_active = TRUE
    AND manager_pin_hash IS NOT NULL
    AND manager_pin_hash = extensions.crypt(p_pin, manager_pin_hash)
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    -- PIN failed! Increment failed attempts and evaluate lockout
    IF v_caller.id IS NOT NULL THEN
      v_failed_count := COALESCE(v_caller.failed_pin_attempts, 0) + 1;
      IF v_failed_count >= 5 THEN
        v_lock_until := NOW() + INTERVAL '15 minutes';
      ELSE
        v_lock_until := NULL;
      END IF;

      UPDATE restaurant_staff
      SET failed_pin_attempts = v_failed_count,
          pin_locked_until = v_lock_until
      WHERE id = v_caller.id;

      -- Log failed attempt to audit_logs
      INSERT INTO audit_logs (
        restaurant_id,
        actor_id,
        actor_name,
        actor_role,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        reason
      ) VALUES (
        p_restaurant_id,
        auth.uid(),
        v_caller.full_name,
        v_caller.role,
        'manager_pin_failed',
        'staff_pin',
        v_caller.id,
        jsonb_build_object('failed_attempts', v_caller.failed_pin_attempts),
        jsonb_build_object('failed_attempts', v_failed_count, 'locked_until', v_lock_until),
        'Failed manager PIN verification attempt'
      );
    END IF;

    -- Return NULL so state is preserved without transaction abort
    RETURN NULL;
  END IF;

  -- Success: reset failed attempts counter if caller exists
  IF v_caller.id IS NOT NULL THEN
    UPDATE restaurant_staff
    SET failed_pin_attempts = 0,
        pin_locked_until = NULL
    WHERE id = v_caller.id;
  END IF;

  RETURN v_manager_id;
END;
$$;

-- 5. Update void_order_with_pin to validate manager authorization
CREATE OR REPLACE FUNCTION void_order_with_pin(
  p_order_id UUID,
  p_manager_pin TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller RECORD;
  v_order RECORD;
  v_manager_id UUID;
  v_old_values JSONB;
  v_new_values JSONB;
  v_audit_log_id UUID;
  v_table_id UUID;
  v_is_super BOOLEAN;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A valid reason (minimum 3 characters) is strictly mandatory for manager voids';
  END IF;

  SELECT is_super_admin() INTO v_is_super;

  -- 1. Resolve caller
  SELECT id, restaurant_id, role, full_name INTO v_caller
  FROM restaurant_staff
  WHERE auth_user_id = auth.uid() AND is_active = TRUE;

  IF v_caller.id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Unauthorized: Active staff profile required' USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch target order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Cross-tenant check
  IF NOT v_is_super AND (v_caller.restaurant_id IS NULL OR v_caller.restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only void orders for your own restaurant' USING ERRCODE = '42501';
  END IF;

  -- 4. Verify Manager PIN
  v_manager_id := verify_manager_pin(v_order.restaurant_id, p_manager_pin);
  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Invalid manager PIN: Authorization failed' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Set session flag for status transition trigger
  PERFORM set_config('amarmenu.manager_void_in_progress', 'on', true);

  -- Capture before snapshot
  v_old_values := jsonb_build_object(
    'status', v_order.status,
    'total', v_order.total,
    'subtotal', v_order.subtotal,
    'tax', v_order.tax,
    'discount', v_order.discount,
    'table_id', v_order.table_id,
    'invoice_number', v_order.invoice_number,
    'payment_status', v_order.payment_status
  );

  -- Update order to cancelled
  UPDATE orders
  SET
    status = 'cancelled',
    cancellation_reason = p_reason,
    cancelled_at = NOW(),
    last_updated_by = auth.uid()
  WHERE id = p_order_id;

  -- Release table if dine-in
  v_table_id := v_order.table_id;
  IF v_table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available', updated_at = NOW()
    WHERE id = v_table_id;
  END IF;

  -- Refund payments
  UPDATE payments
  SET status = 'refunded',
      notes = COALESCE(notes, '') || ' [Voided by Manager: ' || p_reason || ']',
      updated_at = NOW()
  WHERE order_id = p_order_id AND status = 'completed';

  -- Capture after snapshot
  v_new_values := jsonb_build_object(
    'status', 'cancelled',
    'cancellation_reason', p_reason,
    'cancelled_at', NOW(),
    'table_released', (v_table_id IS NOT NULL)
  );

  -- Insert immutable audit log
  INSERT INTO audit_logs (
    restaurant_id,
    actor_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values,
    reason,
    manager_id
  ) VALUES (
    v_order.restaurant_id,
    auth.uid(),
    COALESCE(v_caller.full_name, 'Super Admin'),
    COALESCE(v_caller.role, 'super_admin'),
    'void_order',
    'order',
    v_order.id,
    v_old_values,
    v_new_values,
    p_reason,
    v_manager_id
  )
  RETURNING id INTO v_audit_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', 'cancelled',
    'audit_log_id', v_audit_log_id,
    'table_released', (v_table_id IS NOT NULL)
  );
END;
$$;

-- 6. Refine RLS policies on menu_categories, menu_items, and orders by role (anon vs authenticated)
DROP POLICY IF EXISTS "categories_read" ON menu_categories;
DROP POLICY IF EXISTS "categories_read_anon" ON menu_categories;
DROP POLICY IF EXISTS "categories_read_staff" ON menu_categories;

CREATE POLICY "categories_read_anon"
  ON menu_categories FOR SELECT TO anon
  USING ((deleted_at IS NULL) AND (EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_categories.restaurant_id AND r.is_active = true)));

CREATE POLICY "categories_read_staff"
  ON menu_categories FOR SELECT TO authenticated
  USING ((restaurant_id = current_restaurant_id()) OR is_super_admin() OR ((deleted_at IS NULL) AND (EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_categories.restaurant_id AND r.is_active = true))));

DROP POLICY IF EXISTS "menu_items_select" ON menu_items;
DROP POLICY IF EXISTS "menu_items_select_anon" ON menu_items;
DROP POLICY IF EXISTS "menu_items_select_staff" ON menu_items;

CREATE POLICY "menu_items_select_anon"
  ON menu_items FOR SELECT TO anon
  USING ((deleted_at IS NULL) AND (is_available = true) AND (EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_items.restaurant_id AND r.is_active = true)));

CREATE POLICY "menu_items_select_staff"
  ON menu_items FOR SELECT TO authenticated
  USING ((restaurant_id = current_restaurant_id()) OR is_super_admin() OR ((deleted_at IS NULL) AND (is_available = true) AND (EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_items.restaurant_id AND r.is_active = true))));

DROP POLICY IF EXISTS "orders_read_staff" ON orders;
CREATE POLICY "orders_read_staff"
  ON orders FOR SELECT TO authenticated
  USING ((restaurant_id = current_restaurant_id()) OR is_super_admin());

DROP POLICY IF EXISTS "orders_staff_update" ON orders;
CREATE POLICY "orders_staff_update"
  ON orders FOR UPDATE TO authenticated
  USING ((restaurant_id = current_restaurant_id()) OR is_super_admin());

DROP POLICY IF EXISTS "Restaurant owners can manage orders" ON orders;

-- 7. REVOKE ALL FROM PUBLIC, anon, authenticated on EVERY SECURITY DEFINER function in public
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.oid::regprocedure::text AS func_sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = TRUE
  ) LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.func_sig || ' FROM PUBLIC, anon, authenticated;';
  END LOOP;
END;
$$;

-- 8. GRANT EXECUTE per strict allowlist

-- 8a. Anon + Authenticated (Customer Storefront & Online Payments)
GRANT EXECUTE ON FUNCTION place_order(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_customer_order(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION verify_table_qr_token(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION initiate_online_payment(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_online_payment_session(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- 8b. Authenticated Only (Staff Operations & Storefront Helpers)
GRANT EXECUTE ON FUNCTION open_cash_shift(NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION close_cash_shift(UUID, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_active_cash_shift(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION settle_order_bill(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION void_order_with_pin(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION verify_manager_pin(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_staff_manager_pin(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION record_kot_print(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION regenerate_table_qr_token(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_mushak_6_3_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_restaurant_id() TO authenticated, service_role;

-- 8c. Authenticated + is_super_admin() Check Inside (Platform Super Admin Operations)
GRANT EXECUTE ON FUNCTION admin_create_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_reject_request(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_override_subscription(UUID, TEXT, TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION verify_subscription_payment(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_platform_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_platform_billing_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_table_policies(TEXT) TO authenticated, service_role;

-- 8d. Service Role Only (Backend Tasks, Auto-Lock, Auditing & Webhook Settlement)
GRANT EXECUTE ON FUNCTION complete_online_payment(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION execute_online_payment_success(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fail_online_payment(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_online_payment(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION evaluate_subscription_grace_and_lock() TO service_role;
GRANT EXECUTE ON FUNCTION audit_security_definer_functions() TO service_role;
GRANT EXECUTE ON FUNCTION check_function_privilege(TEXT, TEXT) TO service_role;

-- 8e. Trigger-Only (sync_order_items_trigger)
-- Execution is revoked from all, used only by database triggers
