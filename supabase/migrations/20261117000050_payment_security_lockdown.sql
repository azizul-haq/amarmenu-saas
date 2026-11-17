-- ==============================================================================
-- AmarMenu Migration: Payment Security Lockdown & Direct Mutation Blocking
-- Version: 20261117000050_payment_security_lockdown.sql
-- ==============================================================================

-- 1. REVOKE all online payment settlement and cancellation functions from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION complete_online_payment(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION execute_online_payment_success(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_online_payment(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_online_payment(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Strictly grant execute ONLY to service_role (used by serverless Edge Functions)
GRANT EXECUTE ON FUNCTION complete_online_payment(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION execute_online_payment_success(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION fail_online_payment(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_online_payment(TEXT, TEXT) TO service_role;

-- Ensure initiate_online_payment remains callable by clients
GRANT EXECUTE ON FUNCTION initiate_online_payment(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_online_payment_session(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- 2. Update settle_order_bill and complete_online_payment to set transaction session flag
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
  v_is_admin BOOLEAN;
  v_caller_restaurant_id UUID;
  
  v_discount NUMERIC(10,2);
  v_payable_total NUMERIC(10,2);
  v_tendered NUMERIC(10,2);
  v_change NUMERIC(10,2);
  
  v_next_seq BIGINT;
  v_date_str TEXT;
  v_invoice_number TEXT;
  v_payment_id UUID;
BEGIN
  -- Authorize settlement for this transaction
  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to settle bill' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_super_admin() INTO v_is_admin;
  SELECT current_restaurant_id() INTO v_caller_restaurant_id;

  IF NOT v_is_admin AND (v_caller_restaurant_id IS NULL OR v_caller_restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only settle bills for your own restaurant' USING ERRCODE = '42501';
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
    SET status = 'available',
        updated_at = NOW()
    WHERE id = v_order.table_id;
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

CREATE OR REPLACE FUNCTION complete_online_payment(
  p_session_id TEXT,
  p_gateway_trx_id TEXT,
  p_val_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session RECORD;
  v_order RECORD;
  v_next_seq BIGINT;
  v_date_str TEXT;
  v_invoice_number TEXT;
  v_payment_id UUID;
  v_gw_trx_id TEXT;
BEGIN
  -- Authorize settlement for this transaction
  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Session ID is required' USING ERRCODE = 'P0001';
  END IF;

  v_gw_trx_id := trim(COALESCE(p_gateway_trx_id, 'TRX-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10))));

  SELECT * INTO v_session
  FROM online_payment_sessions
  WHERE tran_id = p_session_id OR session_id = p_session_id OR id::text = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Online payment session "%" not found', p_session_id USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'completed' THEN
    SELECT * INTO v_order FROM orders WHERE id = v_session.order_id;
    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'message', 'Payment already completed',
      'session_id', v_session.tran_id,
      'tran_id', v_session.tran_id,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'invoice_number', v_order.invoice_number,
      'amount', v_session.amount,
      'gateway', v_session.gateway,
      'gateway_trx_id', v_session.gateway_trx_id,
      'val_id', v_session.val_id,
      'settled_at', v_session.updated_at
    );
  END IF;

  IF v_session.status IN ('failed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot complete payment session with status "%"', v_session.status USING ERRCODE = 'P0003';
  END IF;

  IF v_session.expires_at < NOW() THEN
    UPDATE online_payment_sessions SET status = 'expired', updated_at = NOW() WHERE id = v_session.id;
    RAISE EXCEPTION 'Payment session has expired' USING ERRCODE = 'P0004';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_session.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated order not found' USING ERRCODE = 'P0005';
  END IF;

  IF v_order.invoice_number IS NOT NULL THEN
    v_invoice_number := v_order.invoice_number;
  ELSE
    SELECT to_char(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') INTO v_date_str;

    INSERT INTO restaurant_invoice_sequences (restaurant_id, current_number, updated_at)
    VALUES (v_order.restaurant_id, 1, NOW())
    ON CONFLICT (restaurant_id) DO UPDATE
    SET current_number = restaurant_invoice_sequences.current_number + 1,
        updated_at = NOW()
    RETURNING current_number INTO v_next_seq;

    v_invoice_number := 'INV-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');
  END IF;

  INSERT INTO payments (
    restaurant_id,
    order_id,
    payment_method,
    amount,
    tendered_amount,
    change_amount,
    transaction_id,
    status,
    notes
  ) VALUES (
    v_order.restaurant_id,
    v_order.id,
    v_session.gateway,
    v_session.amount,
    v_session.amount,
    0.00,
    v_gw_trx_id,
    'completed',
    'Auto-settled via ' || upper(v_session.gateway) || ' (Tran: ' || v_session.tran_id || ')'
  )
  RETURNING id INTO v_payment_id;

  UPDATE orders
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    invoice_number = v_invoice_number,
    payment_method = v_session.gateway,
    payment_status = 'paid',
    payment_transaction_id = v_gw_trx_id,
    tendered_amount = v_session.amount,
    change_amount = 0.00,
    updated_at = NOW()
  WHERE id = v_order.id;

  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available',
        updated_at = NOW()
    WHERE id = v_order.table_id;
  END IF;

  UPDATE online_payment_sessions
  SET
    status = 'completed',
    gateway_trx_id = v_gw_trx_id,
    val_id = p_val_id,
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_payload, '{}'::jsonb),
    updated_at = NOW()
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.tran_id,
    'tran_id', v_session.tran_id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_invoice_number,
    'amount', v_session.amount,
    'gateway', v_session.gateway,
    'gateway_trx_id', v_gw_trx_id,
    'val_id', p_val_id,
    'payment_id', v_payment_id,
    'table_reset', v_order.table_id IS NOT NULL,
    'settled_at', NOW()
  );
END;
$$;

-- 3. Block direct client UPDATE on orders setting payment_status = 'paid' or invoice_number
CREATE OR REPLACE FUNCTION validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if client is directly setting payment_status to 'paid' without settlement authorization
  IF (NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM 'paid'))
     OR (NEW.invoice_number IS NOT NULL AND (OLD.invoice_number IS DISTINCT FROM NEW.invoice_number)) THEN
    IF current_setting('amarmenu.settlement_authorized', true) <> 'on' THEN
      RAISE EXCEPTION 'Direct update prohibited: Bill settlement and payment verification must be performed via settle_order_bill or verified gateway callback'
        USING ERRCODE = 'P0007';
    END IF;
  END IF;

  -- If status is not changing, allow other valid updates (notes, items)
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
    -- Only allowed if authorized settlement is active
    IF current_setting('amarmenu.settlement_authorized', true) = 'on' THEN
      -- Valid: Authorized Auto-Settlement
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

-- 4. Audit & Fix legacy SECURITY DEFINER functions without explicit search_path
-- Set explicit search_path = public, extensions on all identified functions
DO $$
DECLARE
  v_func RECORD;
BEGIN
  FOR v_func IN
    SELECT p.oid::regprocedure AS func_sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = TRUE
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
      ))
  LOOP
    EXECUTE 'ALTER FUNCTION ' || v_func.func_sig || ' SET search_path = public, extensions;';
  END LOOP;
END;
$$;
