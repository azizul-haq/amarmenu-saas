-- ==============================================================================
-- AmarMenu Migration: Trigger on all order updates to prevent unauthorized payment settlement
-- Version: 20261117000053_trigger_on_all_order_updates.sql
-- ==============================================================================

DROP TRIGGER IF EXISTS trg_validate_order_status_transition ON orders;
CREATE TRIGGER trg_validate_order_status_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_transition();
