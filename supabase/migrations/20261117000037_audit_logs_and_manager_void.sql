-- ==============================================================================
-- Migration 37: Append-Only Audit Logs & Manager PIN Overrides (Void Bill, Item Void)
-- ==============================================================================

-- 1. Add manager_pin_hash to restaurant_staff
ALTER TABLE restaurant_staff ADD COLUMN IF NOT EXISTS manager_pin_hash TEXT;
-- Note: Default PIN seeds removed. PINs are set via set_staff_manager_pin RPC with strict non-trivial validation.

-- 2. Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL, -- 'void_order', 'void_item', 'apply_discount', 'waive_bill'
  entity_type TEXT NOT NULL, -- 'order', 'payment', 'order_item'
  entity_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  manager_id UUID REFERENCES restaurant_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_restaurant ON audit_logs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(restaurant_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(restaurant_id, created_at DESC);

-- 3. Strict Append-Only Immutability Trigger (Prohibits UPDATE and DELETE)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Append-only audit table: UPDATE and DELETE operations are strictly prohibited (SQLSTATE P0001)';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON audit_logs;
CREATE TRIGGER trg_prevent_audit_log_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

-- 4. Enable Row Level Security (RLS) on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select_staff" ON audit_logs;
CREATE POLICY "audit_logs_select_staff" ON audit_logs
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- Only procedure / system inserts audit logs
DROP POLICY IF EXISTS "audit_logs_insert_staff" ON audit_logs;
CREATE POLICY "audit_logs_insert_staff" ON audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- No UPDATE or DELETE policies are created (and trigger prevents it unconditionally)

-- 5. Helper function to verify manager PIN
CREATE OR REPLACE FUNCTION verify_manager_pin(
  p_restaurant_id UUID,
  p_pin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_id UUID;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Manager PIN must be at least 4 digits';
  END IF;

  SELECT id INTO v_manager_id
  FROM restaurant_staff
  WHERE restaurant_id = p_restaurant_id
    AND role IN ('owner', 'manager')
    AND is_active = TRUE
    AND manager_pin_hash IS NOT NULL
    AND manager_pin_hash = crypt(p_pin, manager_pin_hash)
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    RAISE EXCEPTION 'Invalid manager PIN: Authorization failed';
  END IF;

  RETURN v_manager_id;
END;
$$;

-- 6. Atomic Stored Procedure to Void an Order with Manager PIN & Mandatory Reason
CREATE OR REPLACE FUNCTION void_order_with_pin(
  p_order_id UUID,
  p_manager_pin TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_caller_staff RECORD;
  v_order RECORD;
  v_manager_id UUID;
  v_audit_log_id UUID;
  v_old_values JSONB;
  v_new_values JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Validate caller authentication
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: Anonymous callers cannot void orders';
  END IF;

  -- 2. Validate mandatory reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A valid reason (minimum 3 characters) is strictly mandatory to void an order';
  END IF;

  -- 3. Lock and retrieve order
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Order is already % and cannot be voided again', v_order.status;
  END IF;

  -- 4. Check caller staff permissions
  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = v_order.restaurant_id
    AND is_active = TRUE;

  IF NOT FOUND AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You can only void orders for your own restaurant';
  END IF;

  -- 5. Verify Manager PIN
  v_manager_id := verify_manager_pin(v_order.restaurant_id, p_manager_pin);

  -- 6. Capture snapshot before void
  v_old_values := jsonb_build_object(
    'status', v_order.status,
    'total', v_order.total,
    'subtotal', v_order.subtotal,
    'tax', v_order.tax,
    'discount', v_order.discount,
    'table_id', v_order.table_id,
    'invoice_number', v_order.invoice_number,
    'payment_method', v_order.payment_method
  );

  -- 7. Void the order (set status to cancelled)
  UPDATE orders
  SET
    status = 'cancelled',
    cancellation_reason = 'Manager Void: ' || trim(p_reason),
    cancelled_at = v_now,
    updated_at = v_now
  WHERE id = v_order.id;

  -- 8. Release table if occupied
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available', updated_at = v_now
    WHERE id = v_order.table_id;
  END IF;

  -- 9. Mark any completed payments as refunded
  UPDATE payments
  SET
    status = 'refunded',
    notes = COALESCE(notes || ' | ', '') || 'Voided by Manager: ' || trim(p_reason),
    updated_at = v_now
  WHERE order_id = v_order.id;

  v_new_values := jsonb_build_object(
    'status', 'cancelled',
    'cancellation_reason', 'Manager Void: ' || trim(p_reason),
    'cancelled_at', v_now,
    'table_released', v_order.table_id IS NOT NULL
  );

  -- 10. Record append-only audit log entry
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
    manager_id,
    created_at
  ) VALUES (
    v_order.restaurant_id,
    v_caller_auth_id,
    COALESCE(v_caller_staff.full_name, 'Platform Super Admin'),
    COALESCE(v_caller_staff.role, 'super_admin'),
    'void_order',
    'order',
    v_order.id,
    v_old_values,
    v_new_values,
    trim(p_reason),
    v_manager_id,
    v_now
  )
  RETURNING id INTO v_audit_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_order.invoice_number,
    'status', 'cancelled',
    'audit_log_id', v_audit_log_id,
    'table_released', v_order.table_id IS NOT NULL,
    'voided_at', v_now
  );
END;
$$;

-- 7. Update manager PIN for a staff member (Owner only)
CREATE OR REPLACE FUNCTION set_staff_manager_pin(
  p_staff_id UUID,
  p_new_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_target_staff RECORD;
  v_caller_staff RECORD;
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_new_pin IS NULL OR length(trim(p_new_pin)) < 4 OR length(trim(p_new_pin)) > 6 THEN
    RAISE EXCEPTION 'Manager PIN must be between 4 and 6 numeric digits';
  END IF;

  SELECT * INTO v_target_staff
  FROM restaurant_staff
  WHERE id = p_staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- Caller must be owner of that restaurant or super admin
  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = v_target_staff.restaurant_id
    AND role = 'owner'
    AND is_active = TRUE;

  IF NOT FOUND AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only the restaurant owner can set or update manager PINs';
  END IF;

  UPDATE restaurant_staff
  SET manager_pin_hash = crypt(trim(p_new_pin), gen_salt('bf')),
      updated_at = NOW()
  WHERE id = p_staff_id;

  RETURN jsonb_build_object(
    'success', true,
    'staff_id', p_staff_id,
    'message', 'Manager PIN updated successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION void_order_with_pin(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION void_order_with_pin(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION set_staff_manager_pin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_staff_manager_pin(UUID, TEXT) TO authenticated;
