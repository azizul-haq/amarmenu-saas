-- Migration: 20261122000080_restrict_served_transition_to_waiter_cashier_management.sql
-- Description: Restrict order 'served' status transition to waiter, cashier, manager, and owner (excluding kitchen role).

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
  v_normalized_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  SELECT is_super_admin() INTO v_is_super;

  IF v_caller_id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_normalized_status := lower(trim(p_new_status));
  IF v_normalized_status = 'confirmed' THEN
    v_normalized_status := 'accepted';
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

  -- Role-based transition authorization
  IF NOT v_is_super THEN
    IF v_normalized_status IN ('accepted', 'rejected') THEN
      IF NOT has_permission(v_order.restaurant_id, 'confirm_order') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot confirm or reject orders' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status IN ('preparing', 'ready') THEN
      IF NOT has_permission(v_order.restaurant_id, 'update_kitchen_status') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot update kitchen status' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'served' THEN
      -- Waiter, Cashier, Manager, Owner are authorized (Kitchen is strictly excluded)
      IF NOT (
        has_permission(v_order.restaurant_id, 'confirm_order')
        OR has_permission(v_order.restaurant_id, 'settle_bill')
      ) THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot mark orders as served' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'completed' THEN
      IF NOT has_permission(v_order.restaurant_id, 'settle_bill') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot complete orders' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'cancelled' THEN
      IF NOT (
        has_permission(v_order.restaurant_id, 'void_order')
        OR (v_order.status = 'pending' AND has_permission(v_order.restaurant_id, 'confirm_order'))
      ) THEN
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
    status = v_normalized_status,
    verified_by = CASE WHEN v_normalized_status = 'accepted' AND verified_by IS NULL THEN v_caller_id ELSE verified_by END,
    waiter_name = CASE WHEN (v_normalized_status IN ('accepted', 'served')) AND (waiter_name IS NULL OR waiter_name = '') THEN v_staff_name ELSE waiter_name END,
    accepted_by_name = CASE WHEN v_normalized_status = 'accepted' AND (accepted_by_name IS NULL OR accepted_by_name = '') THEN v_staff_name ELSE accepted_by_name END,
    served_at = CASE WHEN v_normalized_status = 'served' AND served_at IS NULL THEN NOW() ELSE served_at END,
    rejection_reason = CASE WHEN v_normalized_status = 'rejected' THEN COALESCE(p_notes, rejection_reason) ELSE rejection_reason END,
    cancellation_reason = CASE WHEN v_normalized_status = 'cancelled' THEN COALESCE(p_notes, cancellation_reason) ELSE cancellation_reason END,
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
    v_normalized_status,
    v_caller_id,
    p_notes
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', v_normalized_status,
    'waiter_name', v_staff_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
