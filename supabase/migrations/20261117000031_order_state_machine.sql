-- ==============================================================================
-- AmarMenu Migration: Server-Enforced Order State Machine & Waiter Verification
-- Version: 20261117000031_order_state_machine.sql
-- ==============================================================================

-- 1. Add verification and reason columns to orders
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS last_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Create order_status_history audit table
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_restaurant ON order_status_history(restaurant_id);

ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_status_history_select_staff ON order_status_history;
CREATE POLICY order_status_history_select_staff ON order_status_history
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- 3. Trigger Function to Strictly Enforce State Transitions
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If status hasn't changed, allow the update (e.g. updating notes, payment)
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Validate state machine rules
  IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'cancelled', 'rejected') THEN
    -- Valid: waiter confirms, rejects, or order is cancelled
  ELSIF OLD.status = 'accepted' AND NEW.status IN ('preparing', 'cancelled') THEN
    -- Valid: kitchen starts preparing or order cancelled
  ELSIF OLD.status = 'preparing' AND NEW.status IN ('ready', 'cancelled') THEN
    -- Valid: kitchen finishes cooking or cancelled
  ELSIF OLD.status = 'ready' AND NEW.status IN ('completed', 'cancelled') THEN
    -- Valid: waiter serves to customer / counter collection
  ELSE
    RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Auto-populate chronological status timestamps in Asia/Dhaka time
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

DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_transition();

-- 4. Atomic Stored Procedure for Authenticated Staff / Waiter Transition
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

  -- Fetch target order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- Verify staff authorization for this specific restaurant
  SELECT is_super_admin() INTO v_is_admin;
  SELECT current_restaurant_id() INTO v_caller_restaurant_id;

  IF NOT v_is_admin AND (v_caller_restaurant_id IS NULL OR v_caller_restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only transition orders for your own restaurant' USING ERRCODE = '42501';
  END IF;

  -- Perform update (Trigger trg_validate_order_status_transition will validate and set timestamps)
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

  -- Record audit log in order_status_history
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
    'updated_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
