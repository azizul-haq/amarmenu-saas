-- ==============================================================================
-- AmarMenu Migration: Online Payment Gateways (bKash & SSLCOMMERZ) & Auto-Settlement
-- Version: 20261117000047_online_payment_gateways.sql
-- ==============================================================================

-- 1. Ensure payments payment_method constraint includes 'sslcommerz'
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check 
  CHECK (payment_method IN ('cash', 'bkash', 'nagad', 'card', 'sslcommerz', 'other'));

-- 2. Create online_payment_sessions table
CREATE TABLE IF NOT EXISTS online_payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tran_id TEXT UNIQUE NOT NULL,
  session_id TEXT UNIQUE NOT NULL,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL CHECK (gateway IN ('bkash', 'sslcommerz', 'nagad')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'expired')),
  gateway_trx_id TEXT,
  gateway_payment_id TEXT,
  val_id TEXT,
  customer_phone TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '20 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_payment_sessions_order ON online_payment_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_online_payment_sessions_restaurant ON online_payment_sessions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_online_payment_sessions_tran ON online_payment_sessions(tran_id);
CREATE INDEX IF NOT EXISTS idx_online_payment_sessions_status ON online_payment_sessions(status);

-- 3. Update validate_order_status_transition to allow transition to 'completed' when bill is paid/settled
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

-- 4. Enable RLS on online_payment_sessions
ALTER TABLE online_payment_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "online_payment_sessions_staff_select" ON online_payment_sessions;
CREATE POLICY "online_payment_sessions_staff_select" ON online_payment_sessions
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "online_payment_sessions_public_select" ON online_payment_sessions;
CREATE POLICY "online_payment_sessions_public_select" ON online_payment_sessions
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 5. Stored Procedure: create_online_payment_session / initiate_online_payment
CREATE OR REPLACE FUNCTION create_online_payment_session(
  p_order_id UUID,
  p_gateway TEXT,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_restaurant RECORD;
  v_gateway TEXT;
  v_tran_id TEXT;
  v_gw_payment_id TEXT;
  v_redirect_url TEXT;
  v_payable_amount NUMERIC(10,2);
  v_session RECORD;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order ID is required' USING ERRCODE = 'P0001';
  END IF;

  v_gateway := lower(trim(COALESCE(p_gateway, 'bkash')));
  IF v_gateway NOT IN ('bkash', 'sslcommerz', 'nagad') THEN
    RAISE EXCEPTION 'Invalid payment gateway: %', p_gateway USING ERRCODE = 'P0002';
  END IF;

  -- 1. Fetch order details
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0003';
  END IF;

  IF v_order.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot initiate payment for % order', v_order.status USING ERRCODE = 'P0004';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Order #% is already paid (Invoice: %)', v_order.order_number, COALESCE(v_order.invoice_number, 'N/A') USING ERRCODE = 'P0005';
  END IF;

  v_payable_amount := v_order.total;
  IF v_payable_amount <= 0 THEN
    RAISE EXCEPTION 'Order total must be greater than zero' USING ERRCODE = 'P0006';
  END IF;

  -- 2. Fetch restaurant branding info
  SELECT id, name, name_bn, currency, slug INTO v_restaurant
  FROM restaurants
  WHERE id = v_order.restaurant_id;

  -- 3. Generate unique transaction / session id: TXN-YYYYMMDD-XXXXXX
  v_tran_id := 'TXN-' || to_char(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));

  -- Generate gateway-specific mock reference
  IF v_gateway = 'bkash' THEN
    v_gw_payment_id := 'BK_PAY_' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10));
    v_redirect_url := '/checkout/gateway-simulator?session_id=' || v_tran_id || '&gateway=bkash';
  ELSIF v_gateway = 'sslcommerz' THEN
    v_gw_payment_id := 'SSLC_SESS_' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
    v_redirect_url := '/checkout/gateway-simulator?session_id=' || v_tran_id || '&gateway=sslcommerz';
  ELSE
    v_gw_payment_id := 'NAGAD_PAY_' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10));
    v_redirect_url := '/checkout/gateway-simulator?session_id=' || v_tran_id || '&gateway=nagad';
  END IF;

  -- 4. Insert into online_payment_sessions
  INSERT INTO online_payment_sessions (
    tran_id,
    session_id,
    order_id,
    restaurant_id,
    gateway,
    amount,
    currency,
    status,
    gateway_payment_id,
    customer_phone,
    metadata,
    expires_at
  ) VALUES (
    v_tran_id,
    v_tran_id,
    v_order.id,
    v_order.restaurant_id,
    v_gateway,
    v_payable_amount,
    'BDT',
    'pending',
    v_gw_payment_id,
    COALESCE(p_customer_phone, v_order.customer_phone),
    jsonb_build_object(
      'order_number', v_order.order_number,
      'order_type', v_order.order_type,
      'table_number', v_order.table_number,
      'restaurant_name', v_restaurant.name
    ),
    NOW() + INTERVAL '20 minutes'
  )
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.session_id,
    'tran_id', v_session.tran_id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'amount', v_session.amount,
    'currency', v_session.currency,
    'gateway', v_session.gateway,
    'gateway_payment_id', v_session.gateway_payment_id,
    'redirect_url', v_redirect_url,
    'expires_at', v_session.expires_at,
    'restaurant_name', v_restaurant.name
  );
END;
$$;

-- Alias for create_online_payment_session
CREATE OR REPLACE FUNCTION initiate_online_payment(
  p_order_id UUID,
  p_gateway TEXT,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN create_online_payment_session(p_order_id, p_gateway, p_customer_phone);
END;
$$;

-- 6. Stored Procedure: complete_online_payment / execute_online_payment_success
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
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Session ID is required' USING ERRCODE = 'P0001';
  END IF;

  v_gw_trx_id := trim(COALESCE(p_gateway_trx_id, 'TRX-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10))));

  -- 1. Find session
  SELECT * INTO v_session
  FROM online_payment_sessions
  WHERE tran_id = p_session_id OR session_id = p_session_id OR id::text = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Online payment session "%" not found', p_session_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency check: if already completed, return existing settlement data
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

  -- 2. Fetch and lock order
  SELECT * INTO v_order FROM orders WHERE id = v_session.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated order not found' USING ERRCODE = 'P0005';
  END IF;

  -- 3. Sequential fiscal invoice number generation (INV-YYYYMMDD-XXXX)
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

  -- 4. Record payment in payments table
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

  -- 5. Auto-settle Order
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

  -- 6. Reset Dine-In Table Status to 'available'
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available',
        updated_at = NOW()
    WHERE id = v_order.table_id;
  END IF;

  -- 7. Update online_payment_sessions to 'completed'
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

-- Alias for complete_online_payment
CREATE OR REPLACE FUNCTION execute_online_payment_success(
  p_session_id TEXT,
  p_gateway_trx_id TEXT,
  p_val_id TEXT DEFAULT NULL,
  p_gateway_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN complete_online_payment(p_session_id, p_gateway_trx_id, p_val_id, p_gateway_payload);
END;
$$;

-- 7. Stored Procedure: fail_online_payment / cancel_online_payment
CREATE OR REPLACE FUNCTION fail_online_payment(
  p_session_id TEXT,
  p_reason TEXT DEFAULT 'Payment failed or cancelled by user'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session RECORD;
  v_target_status TEXT;
BEGIN
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RAISE EXCEPTION 'Session ID is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_session
  FROM online_payment_sessions
  WHERE tran_id = p_session_id OR session_id = p_session_id OR id::text = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Online payment session "%" not found', p_session_id USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot cancel or fail an already completed payment' USING ERRCODE = 'P0003';
  END IF;

  v_target_status := CASE WHEN lower(COALESCE(p_reason, '')) LIKE '%cancel%' THEN 'cancelled' ELSE 'failed' END;

  UPDATE online_payment_sessions
  SET
    status = v_target_status,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'failure_reason', p_reason,
      'failed_at', NOW()
    ),
    updated_at = NOW()
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.tran_id,
    'status', v_target_status,
    'reason', p_reason,
    'updated_at', NOW()
  );
END;
$$;

-- Alias for fail_online_payment
CREATE OR REPLACE FUNCTION cancel_online_payment(
  p_session_id TEXT,
  p_reason TEXT DEFAULT 'Payment cancelled by customer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN fail_online_payment(p_session_id, p_reason);
END;
$$;

-- 8. Update get_customer_order to include invoice_number and payment_transaction_id
CREATE OR REPLACE FUNCTION get_customer_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_restaurant RECORD;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Order ID is required');
  END IF;

  SELECT 
    id,
    restaurant_id,
    order_number,
    order_type,
    table_number,
    customer_name,
    customer_phone,
    items,
    subtotal,
    tax,
    discount,
    total,
    status,
    payment_method,
    payment_status,
    payment_transaction_id,
    invoice_number,
    customer_notes,
    created_at,
    accepted_at,
    preparing_at,
    ready_at,
    completed_at,
    cancelled_at
  INTO v_order
  FROM orders
  WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Order not found');
  END IF;

  SELECT 
    id,
    name,
    name_bn,
    slug,
    phone,
    address,
    logo_url,
    vat_bin_no,
    currency,
    currency_symbol
  INTO v_restaurant
  FROM restaurants
  WHERE id = v_order.restaurant_id;

  RETURN jsonb_build_object(
    'found', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'order_type', v_order.order_type,
      'table_number', v_order.table_number,
      'customer_name', v_order.customer_name,
      'items', v_order.items,
      'subtotal', v_order.subtotal,
      'tax', v_order.tax,
      'discount', v_order.discount,
      'total', v_order.total,
      'status', v_order.status,
      'payment_method', v_order.payment_method,
      'payment_status', v_order.payment_status,
      'payment_transaction_id', v_order.payment_transaction_id,
      'invoice_number', v_order.invoice_number,
      'customer_notes', v_order.customer_notes,
      'created_at', v_order.created_at,
      'accepted_at', v_order.accepted_at,
      'preparing_at', v_order.preparing_at,
      'ready_at', v_order.ready_at,
      'completed_at', v_order.completed_at,
      'cancelled_at', v_order.cancelled_at
    ),
    'restaurant', jsonb_build_object(
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'slug', v_restaurant.slug,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'logo_url', v_restaurant.logo_url,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'currency', v_restaurant.currency,
      'currency_symbol', v_restaurant.currency_symbol
    )
  );
END;
$$;

-- 9. Grants
GRANT EXECUTE ON FUNCTION create_online_payment_session(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION initiate_online_payment(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_online_payment(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION execute_online_payment_success(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fail_online_payment(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_online_payment(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_customer_order(UUID) TO anon, authenticated, service_role;
