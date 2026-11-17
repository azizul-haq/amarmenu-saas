-- ==============================================================================
-- Migration 40: Allow Manager Void Transition (completed -> cancelled) & Audit Immutability Policies
-- ==============================================================================

-- 1. Update order status transition trigger to allow manager void of completed orders
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If status is not changing, allow update (e.g. updating notes, items, etc.)
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
    -- Valid: Manager override / void settled bill
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

-- 2. Add explicit UPDATE and DELETE policies on audit_logs so the mutation trigger always intercepts
DROP POLICY IF EXISTS "audit_logs_update_prohibited" ON audit_logs;
CREATE POLICY "audit_logs_update_prohibited" ON audit_logs
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (false);

DROP POLICY IF EXISTS "audit_logs_delete_prohibited" ON audit_logs;
CREATE POLICY "audit_logs_delete_prohibited" ON audit_logs
  FOR DELETE
  TO authenticated
  USING (true);
