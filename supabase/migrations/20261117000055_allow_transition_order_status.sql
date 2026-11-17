-- ==============================================================================
-- AmarMenu Migration: Authorize transition_order_status RPC
-- Version: 20261117000055_allow_transition_order_status.sql
-- ==============================================================================

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
  v_order RECORD;
  v_is_admin BOOLEAN;
  v_caller_restaurant_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update order status' USING ERRCODE = '42501';
  END IF;

  -- Authorize transaction when moving via verified RPC
  IF p_new_status = 'completed' OR p_payment_status = 'paid' THEN
    PERFORM set_config('amarmenu.settlement_authorized', 'on', true);
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_super_admin() INTO v_is_admin;
  SELECT current_restaurant_id() INTO v_caller_restaurant_id;

  IF NOT v_is_admin AND (v_caller_restaurant_id IS NULL OR v_caller_restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only transition orders for your own restaurant' USING ERRCODE = '42501';
  END IF;

  UPDATE orders
  SET
    status = p_new_status,
    verified_by = CASE WHEN p_new_status = 'accepted' AND verified_by IS NULL THEN v_caller_id ELSE verified_by END,
    last_updated_by = v_caller_id,
    cancellation_reason = CASE WHEN p_new_status = 'cancelled' THEN COALESCE(p_notes, cancellation_reason) ELSE cancellation_reason END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN COALESCE(p_notes, rejection_reason) ELSE rejection_reason END,
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
    v_order.id,
    v_order.restaurant_id,
    v_order.status,
    p_new_status,
    v_caller_id,
    p_notes
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'from_status', v_order.status,
    'to_status', p_new_status,
    'changed_at', NOW()
  );
END;
$$;
