-- Migration 20261118000062: Polling Token, DB-backed Rate Limiting, and Order Privacy Hardening
-- 1. DB-backed rate limits table + atomic check_and_increment_rate_limit RPC (service_role only)
-- 2. 128-bit polling token for online_payment_sessions and updated get_payment_status RPC (no order_id, invoice_number only when paid)
-- 3. Hardened get_customer_order RPC removing customer_name and customer_phone for public anon safety

-- ============================================================================
-- 1. DB-Backed Rate Limiting Table & Function
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  identifier TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rate_limits_bucket_identifier_key UNIQUE (bucket, identifier)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON public.rate_limits(updated_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_bucket TEXT,
  p_identifier TEXT,
  p_max_attempts INT,
  p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.rate_limits%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Cleanup entries older than 1 day
  DELETE FROM public.rate_limits WHERE updated_at < v_now - INTERVAL '1 day';

  -- Select and lock the rate limit row for this bucket and identifier
  SELECT * INTO v_row
  FROM public.rate_limits
  WHERE bucket = p_bucket AND identifier = p_identifier
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.rate_limits (bucket, identifier, attempts, first_attempt_at, updated_at)
    VALUES (p_bucket, p_identifier, 1, v_now, v_now);
    RETURN true;
  END IF;

  -- If time window has expired, reset attempt counter
  IF v_now >= v_row.first_attempt_at + (p_window_seconds || ' seconds')::INTERVAL THEN
    UPDATE public.rate_limits
    SET attempts = 1,
        first_attempt_at = v_now,
        updated_at = v_now
    WHERE id = v_row.id;
    RETURN true;
  END IF;

  -- Within window: check if attempts exceeded
  IF v_row.attempts >= p_max_attempts THEN
    UPDATE public.rate_limits
    SET updated_at = v_now
    WHERE id = v_row.id;
    RETURN false;
  END IF;

  -- Within window and below limit: increment attempts
  UPDATE public.rate_limits
  SET attempts = attempts + 1,
      updated_at = v_now
  WHERE id = v_row.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, TEXT, INT, INT) TO service_role;

-- ============================================================================
-- 2. Add Polling Token to online_payment_sessions & Update Initiate RPC
-- ============================================================================

ALTER TABLE public.online_payment_sessions
  ADD COLUMN IF NOT EXISTS polling_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_online_payment_sessions_polling_token
  ON public.online_payment_sessions(polling_token);

CREATE OR REPLACE FUNCTION public.create_online_payment_session(
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
  v_polling_token TEXT;
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

  -- Generate 128-bit unguessable polling token (16 bytes hex = 32 hex chars)
  v_polling_token := encode(gen_random_bytes(16), 'hex');

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
    polling_token,
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
    v_polling_token,
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
    'polling_token', v_session.polling_token,
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

CREATE OR REPLACE FUNCTION public.initiate_online_payment(
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

GRANT EXECUTE ON FUNCTION public.create_online_payment_session(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.initiate_online_payment(UUID, TEXT, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 3. Secure get_payment_status by 128-bit Polling Token (No order_id, Invoice only when paid)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_payment_status(TEXT);

CREATE OR REPLACE FUNCTION public.get_payment_status(p_polling_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_invoice_number TEXT;
BEGIN
  -- Strict validation of 128-bit hex token (at least 32 characters)
  IF p_polling_token IS NULL OR length(trim(p_polling_token)) < 32 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid polling token');
  END IF;

  SELECT s.status, o.invoice_number
  INTO v_session
  FROM public.online_payment_sessions s
  LEFT JOIN public.orders o ON o.id = s.order_id
  WHERE s.polling_token = trim(p_polling_token)
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment session not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_session.status,
    'invoice_number', CASE WHEN v_session.status IN ('completed', 'paid') THEN v_session.invoice_number ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_status(TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 4. Secure get_customer_order RPC (Remove customer PII: name & phone)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_order(p_order_id UUID)
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

REVOKE ALL ON FUNCTION public.get_customer_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_order(UUID) TO anon, authenticated, service_role;

-- Revoke direct execution on internal trigger function
REVOKE ALL ON FUNCTION public.enforce_staff_role_rules() FROM PUBLIC, anon, authenticated;

-- Hardened Staff Management Safety Rules: Check sole active owner invariant before permission check
CREATE OR REPLACE FUNCTION public.enforce_staff_role_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_current_role TEXT;
  v_active_owners INT;
BEGIN
  BEGIN
    v_current_role := current_setting('role', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_role := NULL;
  END;

  IF v_current_role = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT is_super_admin() INTO v_is_super;
  IF v_is_super IS TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 1. INSERT Validation
  IF TG_OP = 'INSERT' THEN
    IF NOT has_permission(NEW.restaurant_id, 'manage_staff') THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner can add staff members' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 2. UPDATE Validation
  IF TG_OP = 'UPDATE' THEN
    IF OLD.auth_user_id = auth.uid() AND (OLD.role <> NEW.role OR OLD.is_active <> NEW.is_active) THEN
      RAISE EXCEPTION 'A user can never change their own role or active status' USING ERRCODE = 'P0001';
    END IF;

    -- Invariant: A restaurant must always keep at least one active owner
    IF OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.is_active = FALSE) THEN
      SELECT COUNT(*) INTO v_active_owners
      FROM restaurant_staff
      WHERE restaurant_id = OLD.restaurant_id
        AND role = 'owner'
        AND is_active = TRUE
        AND id <> OLD.id;

      IF v_active_owners = 0 THEN
        RAISE EXCEPTION 'A restaurant must always keep at least one active owner' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF (OLD.role <> NEW.role OR OLD.is_active <> NEW.is_active) THEN
      IF NOT has_permission(NEW.restaurant_id, 'manage_staff') THEN
        RAISE EXCEPTION 'Access denied: Only restaurant owner can change staff roles' USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- 3. DELETE Validation
  IF TG_OP = 'DELETE' THEN
    IF OLD.auth_user_id = auth.uid() THEN
      RAISE EXCEPTION 'A user can never delete their own staff record' USING ERRCODE = 'P0001';
    END IF;

    -- Invariant: A restaurant must always keep at least one active owner
    IF OLD.role = 'owner' THEN
      SELECT COUNT(*) INTO v_active_owners
      FROM restaurant_staff
      WHERE restaurant_id = OLD.restaurant_id
        AND role = 'owner'
        AND is_active = TRUE
        AND id <> OLD.id;

      IF v_active_owners = 0 THEN
        RAISE EXCEPTION 'A restaurant must always keep at least one active owner' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    IF NOT has_permission(OLD.restaurant_id, 'manage_staff') THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner can delete staff members' USING ERRCODE = '42501';
    END IF;

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Ensure service_role role has full administrative access on all public schema objects
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Separate restaurants SELECT policy for anon vs authenticated (so anon never evaluates current_restaurant_id)
DROP POLICY IF EXISTS "restaurants_public_read_active" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_staff_read_own" ON public.restaurants;

CREATE POLICY "restaurants_public_read_active" ON public.restaurants
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "restaurants_staff_read_own" ON public.restaurants
  FOR SELECT TO authenticated
  USING (is_active = true OR is_super_admin() OR id = current_restaurant_id());


