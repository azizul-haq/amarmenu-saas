-- ==============================================================================
-- Migration 41: Enforce that completed -> cancelled can ONLY be performed via manager void
-- ==============================================================================

-- 1. Update validate_order_status_transition()
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If status is not changing, allow update
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allowed status transitions:
  IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'cancelled', 'rejected') THEN
    -- Valid: waiter confirms, rejects, or order is cancelled
  ELSIF OLD.status = 'accepted' AND NEW.status IN ('preparing', 'cancelled') THEN
    -- Valid: kitchen starts preparing or order cancelled
  ELSIF OLD.status = 'preparing' AND NEW.status IN ('ready', 'cancelled') THEN
    -- Valid: kitchen finishes cooking or cancelled
  ELSIF OLD.status = 'ready' AND NEW.status IN ('completed', 'cancelled') THEN
    -- Valid: waiter serves to customer / counter collection
  ELSIF OLD.status = 'completed' AND NEW.status = 'cancelled' THEN
    -- ONLY allowed if authorized manager void override is active in current transaction
    IF current_setting('amarmenu.manager_void_in_progress', true) = 'on' THEN
      -- Valid: Authorized Manager Override via void_order_with_pin
    ELSE
      RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Auto-populate transition timestamps
  IF NEW.status = 'accepted' AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at := NOW();
  ELSIF NEW.status = 'preparing' AND NEW.preparing_at IS NULL THEN
    NEW.preparing_at := NOW();
  ELSIF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN
    NEW.ready_at := NOW();
  ELSIF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
  ELSIF NEW.status IN ('cancelled', 'rejected') AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := NOW();
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- 2. Update void_order_with_pin to set transaction local flag
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

  -- Set transaction-scoped flag to allow completed -> cancelled
  PERFORM set_config('amarmenu.manager_void_in_progress', 'on', true);

  -- 7. Void the order (set status to cancelled)
  UPDATE orders
  SET
    status = 'cancelled',
    cancellation_reason = 'Manager Void: ' || trim(p_reason),
    cancelled_at = v_now,
    updated_at = v_now
  WHERE id = v_order.id;

  -- Reset flag
  PERFORM set_config('amarmenu.manager_void_in_progress', 'off', true);

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
