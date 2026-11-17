-- ==============================================================================
-- AmarMenu Migration: Restore manager void check in validate_order_status_transition
-- Version: 20261117000048_fix_status_transition_manager_void.sql
-- ==============================================================================

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
    -- ONLY allowed if authorized manager void override is active in current transaction
    IF current_setting('amarmenu.manager_void_in_progress', true) = 'on' THEN
      -- Valid: Authorized Manager Override via void_order_with_pin
    ELSE
      RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.status = 'completed' AND OLD.status IN ('pending', 'accepted', 'preparing', 'ready') AND NEW.payment_status = 'paid' THEN
    -- Valid: Direct online payment or bill auto-settlement across any active state
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
