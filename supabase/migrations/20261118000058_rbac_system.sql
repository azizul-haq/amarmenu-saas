-- ==============================================================================
-- AmarMenu Migration: Role-Based Access Control (RBAC) System
-- Version: 20261118000058_rbac_system.sql
-- Description:
--   1. role_permissions table seeded with authoritative permissions matrix.
--      Roles: owner, manager, cashier, kitchen, waiter.
--   2. SQL helper has_permission(p_restaurant_id, p_permission).
--   3. Helper get_staff_permissions(p_restaurant_id) for frontend dynamic UX.
--   4. Trigger enforce_staff_role_rules on restaurant_staff:
--      - Only owner can add, remove, or change roles.
--      - A user can never change their own role or active status.
--      - A restaurant must always keep at least one active owner.
--   5. Full RBAC and security definer hardening across all mutating RPCs:
--      - transition_order_status (confirm_order, update_kitchen_status, settle_bill, void_order)
--      - settle_order_bill (settle_bill, apply_discount)
--      - void_order_with_pin (void_settled_bill for paid orders, void_order for unpaid)
--      - open_cash_shift, close_cash_shift, get_active_cash_shift (manage_shifts)
--      - get_restaurant_sales_analytics, get_mushak_6_3_report (view_reports)
--      - submit_subscription_payment (manage_subscription)
--   6. RLS policy updates on payments and cash_shifts to isolate kitchen staff.
-- ==============================================================================

-- 1. Table: role_permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'waiter')),
  permission TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, permission)
);

-- Seed authoritative permission matrix
INSERT INTO role_permissions (role, permission) VALUES
  -- Owner
  ('owner', 'view_reports'),
  ('owner', 'edit_menu'),
  ('owner', 'delete_menu'),
  ('owner', 'toggle_availability'),
  ('owner', 'confirm_order'),
  ('owner', 'update_kitchen_status'),
  ('owner', 'settle_bill'),
  ('owner', 'apply_discount'),
  ('owner', 'void_order'),
  ('owner', 'void_settled_bill'),
  ('owner', 'manage_shifts'),
  ('owner', 'manage_staff'),
  ('owner', 'change_settings'),
  ('owner', 'manage_subscription'),
  ('owner', 'view_financials'),
  ('owner', 'view_order_financials'),

  -- Manager
  ('manager', 'view_reports'),
  ('manager', 'edit_menu'),
  ('manager', 'toggle_availability'),
  ('manager', 'confirm_order'),
  ('manager', 'update_kitchen_status'),
  ('manager', 'settle_bill'),
  ('manager', 'apply_discount'),
  ('manager', 'void_order'),
  ('manager', 'manage_shifts'),
  ('manager', 'change_settings'),
  ('manager', 'view_financials'),
  ('manager', 'view_order_financials'),

  -- Cashier
  ('cashier', 'confirm_order'),
  ('cashier', 'settle_bill'),
  ('cashier', 'manage_shifts'),
  ('cashier', 'view_financials'),
  ('cashier', 'view_order_financials'),

  -- Kitchen
  ('kitchen', 'toggle_availability'),
  ('kitchen', 'update_kitchen_status'),

  -- Waiter
  ('waiter', 'confirm_order'),
  ('waiter', 'view_order_financials')
ON CONFLICT (role, permission) DO NOTHING;

GRANT SELECT ON role_permissions TO anon, authenticated, service_role;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_read_all" ON role_permissions;
CREATE POLICY "role_permissions_read_all" ON role_permissions
  FOR SELECT TO authenticated, anon
  USING (true);


-- 2. Core Security Helper: has_permission
CREATE OR REPLACE FUNCTION has_permission(
  p_restaurant_id UUID,
  p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_user_role TEXT;
  v_has_perm BOOLEAN := FALSE;
  v_is_super BOOLEAN;
  v_current_role TEXT;
BEGIN
  BEGIN
    v_current_role := current_setting('role', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_role := NULL;
  END;

  IF v_current_role = 'service_role' THEN
    RETURN TRUE;
  END IF;

  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT is_super_admin() INTO v_is_super;
  IF v_is_super IS TRUE THEN
    RETURN TRUE;
  END IF;

  SELECT role INTO v_user_role
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = p_restaurant_id
    AND is_active = TRUE
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role = v_user_role
      AND permission = p_permission
  ) INTO v_has_perm;

  RETURN COALESCE(v_has_perm, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION has_permission(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_permission(UUID, TEXT) TO authenticated, service_role;


-- 3. Dynamic permissions retrieval for Frontend
CREATE OR REPLACE FUNCTION get_staff_permissions(
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_user_role TEXT;
  v_permissions JSONB := '[]'::jsonb;
  v_is_super BOOLEAN;
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RETURN jsonb_build_object('role', null, 'permissions', '[]'::jsonb);
  END IF;

  SELECT is_super_admin() INTO v_is_super;
  IF v_is_super IS TRUE THEN
    SELECT jsonb_agg(DISTINCT permission) INTO v_permissions FROM role_permissions;
    RETURN jsonb_build_object('role', 'super_admin', 'permissions', COALESCE(v_permissions, '[]'::jsonb));
  END IF;

  SELECT role INTO v_user_role
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = p_restaurant_id
    AND is_active = TRUE
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RETURN jsonb_build_object('role', null, 'permissions', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(permission) INTO v_permissions
  FROM role_permissions
  WHERE role = v_user_role;

  RETURN jsonb_build_object(
    'role', v_user_role,
    'permissions', COALESCE(v_permissions, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION get_staff_permissions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_staff_permissions(UUID) TO authenticated, service_role;


-- 4. Staff Management Safety Rules Trigger
CREATE OR REPLACE FUNCTION enforce_staff_role_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_current_role TEXT;
  v_active_owners INT;
BEGIN
  BEGIN
    v_current_role := current_setting('role', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_role := NULL;
  END;

  IF v_current_role = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT is_super_admin() INTO v_is_super;
  IF v_is_super IS TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 1. INSERT Validation
  IF TG_OP = 'INSERT' THEN
    IF NOT has_permission(NEW.restaurant_id, 'manage_staff') THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner can add staff members' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 2. UPDATE Validation
  IF TG_OP = 'UPDATE' THEN
    IF OLD.auth_user_id = auth.uid() AND (OLD.role <> NEW.role OR OLD.is_active <> NEW.is_active) THEN
      RAISE EXCEPTION 'A user can never change their own role or active status' USING ERRCODE = 'P0001';
    END IF;

    IF (OLD.role <> NEW.role OR OLD.is_active <> NEW.is_active) THEN
      IF NOT has_permission(NEW.restaurant_id, 'manage_staff') THEN
        RAISE EXCEPTION 'Access denied: Only restaurant owner can change staff roles' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.is_active = FALSE) THEN
      SELECT COUNT(*) INTO v_active_owners
      FROM restaurant_staff
      WHERE restaurant_id = OLD.restaurant_id
        AND role = 'owner'
        AND is_active = TRUE
        AND id <> OLD.id;

      IF v_active_owners = 0 THEN
        RAISE EXCEPTION 'A restaurant must always keep at least one active owner' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- 3. DELETE Validation
  IF TG_OP = 'DELETE' THEN
    IF OLD.auth_user_id = auth.uid() THEN
      RAISE EXCEPTION 'A user can never delete their own staff record' USING ERRCODE = 'P0001';
    END IF;

    IF NOT has_permission(OLD.restaurant_id, 'manage_staff') THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner can delete staff members' USING ERRCODE = '42501';
    END IF;

    IF OLD.role = 'owner' THEN
      SELECT COUNT(*) INTO v_active_owners
      FROM restaurant_staff
      WHERE restaurant_id = OLD.restaurant_id
        AND role = 'owner'
        AND is_active = TRUE
        AND id <> OLD.id;

      IF v_active_owners = 0 THEN
        RAISE EXCEPTION 'A restaurant must always keep at least one active owner' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_staff_role_rules ON restaurant_staff;
CREATE TRIGGER trg_enforce_staff_role_rules
  BEFORE INSERT OR UPDATE OR DELETE ON restaurant_staff
  FOR EACH ROW
  EXECUTE FUNCTION enforce_staff_role_rules();


-- 5. RPC: transition_order_status
DROP FUNCTION IF EXISTS transition_order_status(UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION transition_order_status(
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
BEGIN
  v_caller_id := auth.uid();
  SELECT is_super_admin() INTO v_is_super;

  IF v_caller_id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT id, restaurant_id, status, order_number, table_number, verified_by, cancellation_reason, rejection_reason
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

  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  UPDATE orders
  SET
    status = p_new_status,
    verified_by = CASE WHEN p_new_status = 'accepted' AND verified_by IS NULL THEN v_caller_id ELSE verified_by END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN COALESCE(p_notes, rejection_reason) ELSE rejection_reason END,
    cancellation_reason = CASE WHEN p_new_status = 'cancelled' THEN COALESCE(p_notes, cancellation_reason) ELSE cancellation_reason END,
    payment_method = COALESCE(p_payment_method, payment_method),
    payment_status = COALESCE(p_payment_status, payment_status),
    payment_transaction_id = COALESCE(p_payment_transaction_id, payment_transaction_id)
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
    'from_status', v_order.status,
    'to_status', p_new_status,
    'old_status', v_order.status,
    'new_status', p_new_status,
    'changed_by', COALESCE(v_staff.full_name, 'Super Admin')
  );
END;
$$;

REVOKE ALL ON FUNCTION transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- 6. RPC: settle_order_bill
DROP FUNCTION IF EXISTS settle_order_bill(UUID, TEXT, NUMERIC, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION settle_order_bill(
  p_order_id UUID,
  p_payment_method TEXT DEFAULT 'cash',
  p_tendered_amount NUMERIC DEFAULT NULL,
  p_discount NUMERIC DEFAULT 0.00,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_order RECORD;
  v_restaurant RECORD;
  v_is_super BOOLEAN;
  v_caller_restaurant_id UUID;
  v_discount NUMERIC(10,2);
  v_payable_total NUMERIC(10,2);
  v_tendered NUMERIC(10,2);
  v_change NUMERIC(10,2);
  v_next_seq BIGINT;
  v_date_str TEXT;
  v_invoice_number TEXT;
  v_payment_id UUID;
  v_shift RECORD;
BEGIN
  v_caller_id := auth.uid();
  SELECT is_super_admin() INTO v_is_super;

  IF v_caller_id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Authentication required to settle bill' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT current_restaurant_id() INTO v_caller_restaurant_id;
  IF NOT v_is_super AND (v_caller_restaurant_id IS NULL OR v_caller_restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only settle bills for your own restaurant' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_super THEN
    IF NOT has_permission(v_order.restaurant_id, 'settle_bill') THEN
      RAISE EXCEPTION 'Permission denied: caller cannot settle bills' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF COALESCE(p_discount, 0.00) > 0.00 THEN
    IF NOT v_is_super THEN
      IF NOT has_permission(v_order.restaurant_id, 'apply_discount') THEN
        RAISE EXCEPTION 'Permission denied: caller cannot apply discount' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF v_order.status = 'cancelled' OR v_order.status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot settle cancelled or rejected order' USING ERRCODE = 'P0003';
  END IF;

  IF v_order.payment_status = 'paid' AND v_order.invoice_number IS NOT NULL THEN
    RAISE EXCEPTION 'Order bill has already been settled with invoice %', v_order.invoice_number USING ERRCODE = 'P0004';
  END IF;

  v_discount := GREATEST(0.00, COALESCE(p_discount, v_order.discount, 0.00));
  v_payable_total := GREATEST(0.00, v_order.subtotal + v_order.tax - v_discount);

  v_tendered := COALESCE(p_tendered_amount, v_payable_total);
  IF v_tendered < v_payable_total THEN
    RAISE EXCEPTION 'Tendered amount (৳%) is less than payable total (৳%)', v_tendered, v_payable_total USING ERRCODE = 'P0005';
  END IF;

  v_change := v_tendered - v_payable_total;

  SELECT to_char(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') INTO v_date_str;

  INSERT INTO restaurant_invoice_sequences (restaurant_id, current_number, updated_at)
  VALUES (v_order.restaurant_id, 1, NOW())
  ON CONFLICT (restaurant_id) DO UPDATE
  SET current_number = restaurant_invoice_sequences.current_number + 1,
      updated_at = NOW()
  RETURNING current_number INTO v_next_seq;

  v_invoice_number := 'INV-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');

  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  UPDATE orders
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    invoice_number = v_invoice_number,
    discount = v_discount,
    total = v_payable_total,
    tendered_amount = v_tendered,
    change_amount = v_change,
    payment_method = p_payment_method,
    payment_status = 'paid',
    last_updated_by = v_caller_id,
    updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO payments (
    restaurant_id,
    order_id,
    payment_method,
    amount,
    tendered_amount,
    change_amount,
    status,
    collected_by,
    notes
  ) VALUES (
    v_order.restaurant_id,
    v_order.id,
    p_payment_method,
    v_payable_total,
    v_tendered,
    v_change,
    'completed',
    v_caller_id,
    p_notes
  )
  RETURNING id INTO v_payment_id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available', updated_at = NOW()
    WHERE id = v_order.table_id;
  END IF;

  SELECT * INTO v_shift
  FROM cash_shifts
  WHERE restaurant_id = v_order.restaurant_id AND status = 'open'
  ORDER BY opening_time DESC
  LIMIT 1;

  IF v_shift.id IS NOT NULL THEN
    IF p_payment_method = 'cash' THEN
      UPDATE cash_shifts
      SET
        cash_sales = cash_sales + v_payable_total,
        total_sales = total_sales + v_payable_total,
        total_orders = total_orders + 1,
        updated_at = NOW()
      WHERE id = v_shift.id;
    ELSE
      UPDATE cash_shifts
      SET
        digital_sales = digital_sales + v_payable_total,
        total_sales = total_sales + v_payable_total,
        total_orders = total_orders + 1,
        updated_at = NOW()
      WHERE id = v_shift.id;
    END IF;
  END IF;

  SELECT name, name_bn, phone, address, vat_bin_no, trade_license_no
  INTO v_restaurant
  FROM restaurants
  WHERE id = v_order.restaurant_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_invoice_number,
    'subtotal', v_order.subtotal,
    'tax', v_order.tax,
    'discount', v_discount,
    'total', v_payable_total,
    'tendered_amount', v_tendered,
    'change_amount', v_change,
    'payment_method', p_payment_method,
    'table_reset', v_order.table_id IS NOT NULL,
    'settled_at', NOW(),
    'restaurant', jsonb_build_object(
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION settle_order_bill(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION settle_order_bill(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;


-- 7. RPC: void_order_with_pin
DROP FUNCTION IF EXISTS void_order_with_pin(UUID, TEXT, TEXT);
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
  v_caller_id UUID;
  v_order RECORD;
  v_manager_id UUID;
  v_manager_auth_id UUID;
  v_manager_role TEXT;
  v_manager_name TEXT;
  v_is_super BOOLEAN;
  v_table_released BOOLEAN := FALSE;
  v_audit_log_id UUID;
  v_old_state JSONB;
  v_new_state JSONB;
BEGIN
  v_caller_id := auth.uid();
  SELECT is_super_admin() INTO v_is_super;

  IF p_reason IS NULL OR TRIM(p_reason) = '' OR LENGTH(TRIM(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A valid reason (minimum 3 characters) is strictly mandatory'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_super AND current_restaurant_id() <> v_order.restaurant_id THEN
    RAISE EXCEPTION 'Unauthorized: You can only void orders for your own restaurant'
      USING ERRCODE = '42501';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    IF NOT v_is_super AND NOT has_permission(v_order.restaurant_id, 'void_settled_bill') THEN
      RAISE EXCEPTION 'Access denied: Only owners can void settled/paid bills' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT v_is_super AND NOT has_permission(v_order.restaurant_id, 'void_order') THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner or manager can void orders' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT v_is_super THEN
    v_manager_id := verify_manager_pin(v_order.restaurant_id, p_manager_pin);
    IF v_manager_id IS NULL THEN
      RAISE EXCEPTION 'Invalid manager PIN: Authorization failed' USING ERRCODE = 'P0001';
    END IF;

    SELECT auth_user_id, role, full_name INTO v_manager_auth_id, v_manager_role, v_manager_name
    FROM restaurant_staff WHERE id = v_manager_id;

    IF v_order.payment_status = 'paid' AND v_manager_role <> 'owner' THEN
      RAISE EXCEPTION 'Access denied: Voiding a settled bill requires owner PIN authorization' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_manager_id := v_caller_id;
    v_manager_auth_id := v_caller_id;
    v_manager_role := 'super_admin';
    v_manager_name := 'Super Admin';
  END IF;

  v_old_state := jsonb_build_object(
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'total', v_order.total,
    'table_id', v_order.table_id,
    'table_number', v_order.table_number,
    'order_number', v_order.order_number
  );

  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);
  PERFORM set_config('amarmenu.manager_void_in_progress', 'on', true);

  UPDATE orders
  SET
    status = 'cancelled',
    cancellation_reason = p_reason,
    cancelled_at = NOW(),
    last_updated_by = v_caller_id
  WHERE id = p_order_id;

  UPDATE payments
  SET
    status = 'refunded',
    notes = COALESCE(notes, '') || ' [Voided by Manager: ' || v_manager_name || ', Reason: ' || p_reason || ']'
  WHERE order_id = p_order_id AND status = 'completed';

  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available', updated_at = NOW()
    WHERE id = v_order.table_id;
    v_table_released := TRUE;
  ELSIF v_order.table_number IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available', updated_at = NOW()
    WHERE restaurant_id = v_order.restaurant_id
      AND (table_number = v_order.table_number::text OR table_number = ('Table ' || v_order.table_number::text))
      AND status = 'occupied';
    v_table_released := TRUE;
  END IF;

  v_new_state := jsonb_build_object(
    'status', 'cancelled',
    'payment_status', CASE WHEN v_order.payment_status = 'paid' THEN 'refunded' ELSE v_order.payment_status END,
    'cancellation_reason', p_reason,
    'voided_by_role', v_manager_role,
    'voided_by_name', v_manager_name
  );

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
    v_order.restaurant_id,
    COALESCE(v_manager_auth_id, v_caller_id),
    v_manager_name,
    v_manager_role,
    'void_order',
    'orders',
    p_order_id,
    v_old_state,
    v_new_state,
    p_reason
  )
  RETURNING id INTO v_audit_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', 'cancelled',
    'table_released', v_table_released,
    'audit_log_id', v_audit_log_id,
    'voided_by', v_manager_name,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION void_order_with_pin(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION void_order_with_pin(UUID, TEXT, TEXT) TO authenticated, service_role;


-- 8. RPCs: Cash Shifts (manage_shifts)
DROP FUNCTION IF EXISTS open_cash_shift(NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION open_cash_shift(
  p_opening_float NUMERIC DEFAULT 0.00,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_caller_staff RECORD;
  v_existing_shift RECORD;
  v_new_shift_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_float NUMERIC(10,2) := GREATEST(0.00, COALESCE(p_opening_float, 0.00));
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to open cash shift' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You are not active staff at any restaurant' USING ERRCODE = '42501';
  END IF;

  IF NOT is_super_admin() THEN
    IF NOT has_permission(v_caller_staff.restaurant_id, 'manage_shifts') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot open shifts' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_opening_float < 0 THEN
    RAISE EXCEPTION 'Opening float cannot be negative' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_shift
  FROM cash_shifts
  WHERE restaurant_id = v_caller_staff.restaurant_id
    AND status = 'open'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'An open shift is already active for this restaurant (opened at %). Please close it before opening a new one.',
      v_existing_shift.opening_time USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO cash_shifts (
    restaurant_id,
    opened_by,
    status,
    opening_float,
    opening_time,
    notes,
    created_at,
    updated_at
  ) VALUES (
    v_caller_staff.restaurant_id,
    v_caller_auth_id,
    'open',
    v_float,
    v_now,
    p_notes,
    v_now,
    v_now
  )
  RETURNING id INTO v_new_shift_id;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', v_new_shift_id,
    'restaurant_id', v_caller_staff.restaurant_id,
    'opening_float', v_float,
    'opening_time', v_now,
    'status', 'open'
  );
END;
$$;

REVOKE ALL ON FUNCTION open_cash_shift(NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION open_cash_shift(NUMERIC, TEXT) TO authenticated, service_role;


DROP FUNCTION IF EXISTS close_cash_shift(UUID, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION close_cash_shift(
  p_shift_id UUID,
  p_closing_count NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_caller_staff RECORD;
  v_shift RECORD;
  v_restaurant RECORD;
  v_opener_name TEXT;
  v_closer_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  
  v_total_sales NUMERIC(10,2) := 0.00;
  v_cash_sales NUMERIC(10,2) := 0.00;
  v_digital_sales NUMERIC(10,2) := 0.00;
  v_bkash_sales NUMERIC(10,2) := 0.00;
  v_nagad_sales NUMERIC(10,2) := 0.00;
  v_card_sales NUMERIC(10,2) := 0.00;
  v_tax_collected NUMERIC(10,2) := 0.00;
  v_discount_total NUMERIC(10,2) := 0.00;
  v_expected_cash NUMERIC(10,2) := 0.00;
  v_discrepancy NUMERIC(10,2) := 0.00;
  
  v_total_orders INT := 0;
  v_voided_orders INT := 0;
  v_dine_in_orders INT := 0;
  v_takeaway_orders INT := 0;
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to close cash shift' USING ERRCODE = '42501';
  END IF;

  IF p_closing_count IS NULL OR p_closing_count < 0 THEN
    RAISE EXCEPTION 'Closing cash count cannot be negative' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_shift
  FROM cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash shift not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_shift.status = 'closed' THEN
    RAISE EXCEPTION 'Shift is already closed (closed at %)', v_shift.closing_time USING ERRCODE = 'P0003';
  END IF;

  IF NOT is_super_admin() THEN
    IF current_restaurant_id() <> v_shift.restaurant_id THEN
      RAISE EXCEPTION 'Access denied: You can only close shifts for your own restaurant' USING ERRCODE = '42501';
    END IF;

    IF NOT has_permission(v_shift.restaurant_id, 'manage_shifts') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot close shifts or generate Z-reports' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = v_shift.restaurant_id
  LIMIT 1;

  v_closer_name := COALESCE(v_caller_staff.full_name, 'Cashier');

  SELECT full_name INTO v_opener_name
  FROM restaurant_staff
  WHERE auth_user_id = v_shift.opened_by
  LIMIT 1;

  SELECT * INTO v_restaurant
  FROM restaurants
  WHERE id = v_shift.restaurant_id;

  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method != 'cash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'bkash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'nagad' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'card' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00)
  INTO
    v_cash_sales,
    v_digital_sales,
    v_bkash_sales,
    v_nagad_sales,
    v_card_sales
  FROM payments
  WHERE restaurant_id = v_shift.restaurant_id
    AND created_at >= v_shift.opening_time
    AND created_at <= v_now;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'completed' AND order_type IN ('table', 'qr')),
    COUNT(*) FILTER (WHERE status = 'completed' AND order_type = 'counter'),
    COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN status = 'completed' THEN tax ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(discount, 0) ELSE 0 END), 0.00)
  INTO
    v_total_orders,
    v_voided_orders,
    v_dine_in_orders,
    v_takeaway_orders,
    v_total_sales,
    v_tax_collected,
    v_discount_total
  FROM orders
  WHERE restaurant_id = v_shift.restaurant_id
    AND created_at >= v_shift.opening_time
    AND created_at <= v_now;

  v_expected_cash := v_shift.opening_float + v_cash_sales;
  v_discrepancy := p_closing_count - v_expected_cash;

  UPDATE cash_shifts
  SET
    closed_by = v_caller_auth_id,
    status = 'closed',
    closing_time = v_now,
    closing_count = p_closing_count,
    expected_cash = v_expected_cash,
    discrepancy = v_discrepancy,
    total_sales = v_total_sales,
    cash_sales = v_cash_sales,
    digital_sales = v_digital_sales,
    tax_collected = v_tax_collected,
    discount_total = v_discount_total,
    total_orders = v_total_orders,
    voided_orders = v_voided_orders,
    notes = p_notes,
    updated_at = v_now
  WHERE id = p_shift_id;

  RETURN jsonb_build_object(
    'success', true,
    'z_report_number', 'Z-' || TO_CHAR(v_now, 'YYYYMMDD') || '-' || SUBSTRING(p_shift_id::TEXT, 1, 8),
    'shift_id', p_shift_id,
    'status', 'closed',
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no
    ),
    'timings', jsonb_build_object(
      'opened_at', v_shift.opening_time,
      'closed_at', v_now,
      'opened_by', COALESCE(v_opener_name, 'Cashier'),
      'closed_by', v_closer_name
    ),
    'cash_reconciliation', jsonb_build_object(
      'opening_float', v_shift.opening_float,
      'cash_sales', v_cash_sales,
      'expected_cash', v_expected_cash,
      'actual_cash_counted', p_closing_count,
      'discrepancy', v_discrepancy,
      'is_balanced', (v_discrepancy = 0),
      'has_shortage', (v_discrepancy < 0),
      'has_overage', (v_discrepancy > 0)
    ),
    'sales_summary', jsonb_build_object(
      'gross_sales', v_total_sales,
      'cash_sales', v_cash_sales,
      'digital_sales', v_digital_sales,
      'bkash_sales', v_bkash_sales,
      'nagad_sales', v_nagad_sales,
      'card_sales', v_card_sales,
      'tax_collected', v_tax_collected,
      'discount_total', v_discount_total,
      'completed_orders_count', v_total_orders,
      'dine_in_orders_count', v_dine_in_orders,
      'takeaway_orders_count', v_takeaway_orders,
      'voided_orders_count', v_voided_orders
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION close_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_cash_shift(UUID, NUMERIC, TEXT) TO authenticated, service_role;


DROP FUNCTION IF EXISTS get_active_cash_shift(UUID);
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
  IF NOT is_super_admin() THEN
    IF p_restaurant_id <> current_restaurant_id() THEN
      RAISE EXCEPTION 'Unauthorized: Cross-tenant access denied' USING ERRCODE = '42501';
    END IF;

    IF NOT has_permission(p_restaurant_id, 'manage_shifts') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot manage cash shifts' USING ERRCODE = '42501';
    END IF;
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

  SELECT full_name INTO v_opener_name
  FROM restaurant_staff
  WHERE auth_user_id = v_shift.opened_by
  LIMIT 1;

  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status IN ('paid', 'completed') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method != 'cash' AND status IN ('paid', 'completed') THEN amount ELSE 0 END), 0.00),
    COUNT(DISTINCT CASE WHEN status IN ('paid', 'completed') THEN order_id ELSE NULL END)
  INTO v_cash_sales, v_digital_sales, v_completed_orders
  FROM payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= v_shift.opening_time;

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

REVOKE ALL ON FUNCTION get_active_cash_shift(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_active_cash_shift(UUID) TO authenticated, service_role;


-- 9. RPC: submit_subscription_payment (manage_subscription)
DROP FUNCTION IF EXISTS submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION submit_subscription_payment(
  p_restaurant_id UUID,
  p_plan_code TEXT,
  p_billing_cycle TEXT DEFAULT 'monthly',
  p_payment_method TEXT DEFAULT 'bkash',
  p_transaction_id TEXT DEFAULT NULL,
  p_sender_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_is_super BOOLEAN;
  v_plan RECORD;
  v_sub RECORD;
  v_amount NUMERIC(10,2);
  v_invoice_seq INT;
  v_invoice_number TEXT;
  v_invoice_id UUID;
  v_period_start TIMESTAMPTZ := NOW();
  v_period_end TIMESTAMPTZ;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := is_super_admin();
  IF NOT v_is_super THEN
    SELECT role INTO v_caller_role
    FROM restaurant_staff
    WHERE auth_user_id = v_caller_id
      AND restaurant_id = p_restaurant_id
      AND is_active = TRUE;

    IF v_caller_role IS NULL OR v_caller_role <> 'owner' THEN
      RAISE EXCEPTION 'Access denied: You do not have permission to submit payments for this restaurant' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT * INTO v_plan FROM plans WHERE name = LOWER(p_plan_code) AND is_active = TRUE;
  IF NOT FOUND THEN
    IF LOWER(p_plan_code) = 'starter' THEN
      v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN 14388.00 ELSE 1499.00 END;
    ELSIF LOWER(p_plan_code) = 'enterprise' THEN
      v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN 57588.00 ELSE 5999.00 END;
    ELSE
      v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN 28788.00 ELSE 2999.00 END;
    END IF;
  ELSE
    v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN v_plan.price_yearly ELSE v_plan.price_monthly END;
  END IF;

  IF p_billing_cycle = 'yearly' THEN
    v_period_end := v_period_start + INTERVAL '365 days';
  ELSE
    v_period_end := v_period_start + INTERVAL '30 days';
  END IF;

  SELECT id INTO v_sub FROM subscriptions WHERE restaurant_id = p_restaurant_id ORDER BY created_at DESC LIMIT 1;

  SELECT COUNT(*) + 1 INTO v_invoice_seq
  FROM subscription_invoices
  WHERE invoice_number LIKE 'SAAS-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '%';

  v_invoice_number := 'SAAS-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '-' || LPAD(v_invoice_seq::TEXT, 4, '0');

  INSERT INTO subscription_invoices (
    invoice_number,
    restaurant_id,
    subscription_id,
    plan_code,
    billing_cycle,
    amount,
    payment_method,
    transaction_id,
    sender_number,
    status,
    notes,
    period_start,
    period_end
  ) VALUES (
    v_invoice_number,
    p_restaurant_id,
    v_sub.id,
    LOWER(p_plan_code),
    p_billing_cycle,
    v_amount,
    LOWER(p_payment_method),
    p_transaction_id,
    p_sender_number,
    'pending',
    p_notes,
    v_period_start,
    v_period_end
  ) RETURNING id INTO v_invoice_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', v_amount,
    'plan_code', LOWER(p_plan_code),
    'billing_cycle', p_billing_cycle,
    'payment_method', LOWER(p_payment_method),
    'transaction_id', p_transaction_id,
    'status', 'pending',
    'message', 'Payment submitted successfully. Awaiting Super Admin verification.'
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- 10. RPCs: Analytics & Mushak Reports (view_reports)
DROP FUNCTION IF EXISTS get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION get_restaurant_sales_analytics(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_restaurant RECORD;

  v_gross_sales NUMERIC(10,2) := 0.00;
  v_net_sales NUMERIC(10,2) := 0.00;
  v_total_vat NUMERIC(10,2) := 0.00;
  v_total_discount NUMERIC(10,2) := 0.00;
  v_total_orders INT := 0;
  v_avg_order_value NUMERIC(10,2) := 0.00;
  v_voided_orders INT := 0;

  v_cash_sales NUMERIC(10,2) := 0.00;
  v_bkash_sales NUMERIC(10,2) := 0.00;
  v_nagad_sales NUMERIC(10,2) := 0.00;
  v_card_sales NUMERIC(10,2) := 0.00;
  v_other_sales NUMERIC(10,2) := 0.00;

  v_payment_methods JSONB := '[]'::jsonb;
  v_order_types JSONB := '[]'::jsonb;
  v_daily_sales JSONB := '[]'::jsonb;
  v_top_items JSONB := '[]'::jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := is_super_admin();
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM restaurant_staff
      WHERE auth_user_id = v_caller_id
        AND restaurant_id = p_restaurant_id
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'Access denied: You do not have permission to view analytics for this restaurant' USING ERRCODE = 'P0002';
    END IF;

    IF NOT has_permission(p_restaurant_id, 'view_reports') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot view reports' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, name, name_bn, vat_bin_no, trade_license_no, default_vat_rate, currency, currency_symbol
  INTO v_restaurant
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0004';
  END IF;

  SELECT
    COALESCE(SUM(total), 0.00),
    COALESCE(SUM(subtotal - COALESCE(discount, 0.00)), 0.00),
    COALESCE(SUM(tax), 0.00),
    COALESCE(SUM(discount), 0.00),
    COUNT(*)
  INTO
    v_gross_sales,
    v_net_sales,
    v_total_vat,
    v_total_discount,
    v_total_orders
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND status = 'completed'
    AND COALESCE(completed_at, created_at) >= p_start_date
    AND COALESCE(completed_at, created_at) <= p_end_date;

  IF v_total_orders > 0 THEN
    v_avg_order_value := ROUND(v_gross_sales / v_total_orders, 2);
  ELSE
    v_avg_order_value := 0.00;
  END IF;

  SELECT COUNT(*)
  INTO v_voided_orders
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND status = 'cancelled'
    AND COALESCE(cancelled_at, updated_at, created_at) >= p_start_date
    AND COALESCE(cancelled_at, updated_at, created_at) <= p_end_date;

  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'bkash' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'nagad' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method NOT IN ('cash', 'bkash', 'nagad', 'card') THEN amount ELSE 0 END), 0.00)
  INTO
    v_cash_sales,
    v_bkash_sales,
    v_nagad_sales,
    v_card_sales,
    v_other_sales
  FROM payments
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('completed', 'paid')
    AND created_at >= p_start_date
    AND created_at <= p_end_date;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'method', method,
        'amount', amount,
        'count', count
      )
    ),
    '[]'::jsonb
  ) INTO v_payment_methods
  FROM (
    SELECT
      payment_method AS method,
      COALESCE(SUM(amount), 0.00) AS amount,
      COUNT(*) AS count
    FROM payments
    WHERE restaurant_id = p_restaurant_id
      AND status IN ('completed', 'paid')
      AND created_at >= p_start_date
      AND created_at <= p_end_date
    GROUP BY payment_method
    ORDER BY amount DESC
  ) pm;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', order_type,
        'count', count,
        'revenue', total_rev
      )
    ),
    '[]'::jsonb
  ) INTO v_order_types
  FROM (
    SELECT
      order_type,
      COUNT(*) AS count,
      COALESCE(SUM(total), 0.00) AS total_rev
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND status = 'completed'
      AND COALESCE(completed_at, created_at) >= p_start_date
      AND COALESCE(completed_at, created_at) <= p_end_date
    GROUP BY order_type
    ORDER BY count DESC
  ) ot;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', day_str,
        'label', day_label,
        'gross_sales', day_gross,
        'net_sales', day_net,
        'vat_collected', day_vat,
        'orders_count', day_orders
      ) ORDER BY day_str ASC
    ),
    '[]'::jsonb
  ) INTO v_daily_sales
  FROM (
    SELECT
      TO_CHAR(COALESCE(completed_at, created_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day_str,
      TO_CHAR(COALESCE(completed_at, created_at) AT TIME ZONE 'Asia/Dhaka', 'Mon DD') AS day_label,
      COALESCE(SUM(total), 0.00) AS day_gross,
      COALESCE(SUM(subtotal - COALESCE(discount, 0.00)), 0.00) AS day_net,
      COALESCE(SUM(tax), 0.00) AS day_vat,
      COUNT(*) AS day_orders
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND status = 'completed'
      AND COALESCE(completed_at, created_at) >= p_start_date
      AND COALESCE(completed_at, created_at) <= p_end_date
    GROUP BY day_str, day_label
    ORDER BY day_str ASC
  ) daily;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', item_name,
        'quantity', qty,
        'revenue', rev
      )
    ),
    '[]'::jsonb
  ) INTO v_top_items
  FROM (
    SELECT
      oi.item_name,
      SUM(oi.quantity) AS qty,
      COALESCE(SUM(oi.item_total), 0.00) AS rev
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.restaurant_id = p_restaurant_id
      AND o.status = 'completed'
      AND COALESCE(o.completed_at, o.created_at) >= p_start_date
      AND COALESCE(o.completed_at, o.created_at) <= p_end_date
    GROUP BY oi.item_name
    ORDER BY rev DESC, qty DESC
    LIMIT 50
  ) top;

  RETURN jsonb_build_object(
    'success', TRUE,
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no,
      'currency_symbol', COALESCE(v_restaurant.currency_symbol, '৳')
    ),
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'summary', jsonb_build_object(
      'gross_sales', v_gross_sales,
      'net_sales', v_net_sales,
      'vat_collected', v_total_vat,
      'discount_total', v_total_discount,
      'total_orders', v_total_orders,
      'average_order_value', v_avg_order_value,
      'voided_orders', v_voided_orders
    ),
    'payment_breakdown', jsonb_build_object(
      'cash_sales', v_cash_sales,
      'bkash_sales', v_bkash_sales,
      'nagad_sales', v_nagad_sales,
      'card_sales', v_card_sales,
      'other_sales', v_other_sales,
      'methods', v_payment_methods
    ),
    'order_types', v_order_types,
    'daily_sales', v_daily_sales,
    'top_items', v_top_items
  );
END;
$$;

REVOKE ALL ON FUNCTION get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;


DROP FUNCTION IF EXISTS get_mushak_6_3_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION get_mushak_6_3_report(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_restaurant RECORD;

  v_total_invoices INT := 0;
  v_total_subtotal NUMERIC(10,2) := 0.00;
  v_total_discount NUMERIC(10,2) := 0.00;
  v_total_taxable NUMERIC(10,2) := 0.00;
  v_total_vat NUMERIC(10,2) := 0.00;
  v_total_gross NUMERIC(10,2) := 0.00;

  v_invoices JSONB := '[]'::jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := is_super_admin();
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM restaurant_staff
      WHERE auth_user_id = v_caller_id
        AND restaurant_id = p_restaurant_id
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'Access denied: You do not have permission to view NBR VAT report for this restaurant' USING ERRCODE = 'P0002';
    END IF;

    IF NOT has_permission(p_restaurant_id, 'view_reports') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot view reports' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, name, name_bn, address, vat_bin_no, trade_license_no, default_vat_rate, currency, currency_symbol
  INTO v_restaurant
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0004';
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(subtotal), 0.00),
    COALESCE(SUM(discount), 0.00),
    COALESCE(SUM(subtotal - COALESCE(discount, 0.00)), 0.00),
    COALESCE(SUM(tax), 0.00),
    COALESCE(SUM(total), 0.00)
  INTO
    v_total_invoices,
    v_total_subtotal,
    v_total_discount,
    v_total_taxable,
    v_total_vat,
    v_total_gross
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND status = 'completed'
    AND invoice_number IS NOT NULL
    AND COALESCE(completed_at, created_at) >= p_start_date
    AND COALESCE(completed_at, created_at) <= p_end_date;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order_id', o.id,
        'invoice_number', COALESCE(o.invoice_number, 'INV-' || o.order_number),
        'order_number', o.order_number,
        'date_time', TO_CHAR(COALESCE(o.completed_at, o.created_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI:SS'),
        'customer_name', COALESCE(o.customer_name, 'Walking Customer'),
        'customer_phone', COALESCE(o.customer_phone, 'N/A'),
        'subtotal', o.subtotal,
        'discount', COALESCE(o.discount, 0.00),
        'taxable_amount', GREATEST(0.00, o.subtotal - COALESCE(o.discount, 0.00)),
        'vat_rate', COALESCE(v_restaurant.default_vat_rate, 5.00),
        'vat_amount', o.tax,
        'total_amount', o.total,
        'payment_method', COALESCE(o.payment_method, 'cash')
      ) ORDER BY o.invoice_number ASC, COALESCE(o.completed_at, o.created_at) ASC
    ),
    '[]'::jsonb
  ) INTO v_invoices
  FROM orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status = 'completed'
    AND o.invoice_number IS NOT NULL
    AND COALESCE(o.completed_at, o.created_at) >= p_start_date
    AND COALESCE(o.completed_at, o.created_at) <= p_end_date;

  RETURN jsonb_build_object(
    'success', TRUE,
    'mushak_form', 'Mushak-6.3',
    'title', 'কর চালানপত্র রেজিস্টার (Mushak-6.3 Tax Invoice Register)',
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'address', v_restaurant.address,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no,
      'vat_rate', COALESCE(v_restaurant.default_vat_rate, 5.00),
      'currency_symbol', COALESCE(v_restaurant.currency_symbol, '৳')
    ),
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'summary', jsonb_build_object(
      'total_invoices', v_total_invoices,
      'total_subtotal', v_total_subtotal,
      'total_discount', v_total_discount,
      'total_taxable', v_total_taxable,
      'total_vat', v_total_vat,
      'total_gross', v_total_gross
    ),
    'invoices', v_invoices
  );
END;
$$;

REVOKE ALL ON FUNCTION get_mushak_6_3_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_mushak_6_3_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;


-- 11. Row Level Security: Kitchen Financial Isolation
DROP POLICY IF EXISTS "payments_select_staff" ON payments;
CREATE POLICY "payments_select_staff" ON payments
  FOR SELECT TO authenticated
  USING (
    has_permission(restaurant_id, 'view_financials')
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "cash_shifts_select_staff" ON cash_shifts;
CREATE POLICY "cash_shifts_select_staff" ON cash_shifts
  FOR SELECT TO authenticated
  USING (
    has_permission(restaurant_id, 'manage_shifts')
    OR is_super_admin()
  );
