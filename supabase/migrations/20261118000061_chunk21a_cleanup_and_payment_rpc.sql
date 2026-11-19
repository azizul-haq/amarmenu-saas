-- Migration 20261118000061: Chunk 21a Cleanup, Payment Status RPC & Foreign Key Drop
-- Plain drop of unused notifications table and legacy users table (no CASCADE)
-- Safe customer-facing RPC get_payment_status(tran_id) to eliminate direct table reads on online_payment_sessions

-- 1. Drop unused notifications table and legacy baseline procedures
DROP TABLE IF EXISTS public.notifications;
DROP FUNCTION IF EXISTS public.admin_create_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_create_restaurant(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_create_restaurant;

-- 2. Plain drop of legacy users table (no CASCADE to prevent accidental object removal)
DROP TABLE IF EXISTS public.users;

-- 3. Create secure customer-facing get_payment_status RPC
CREATE OR REPLACE FUNCTION public.get_payment_status(p_tran_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_invoice_number TEXT;
BEGIN
  IF p_tran_id IS NULL OR length(trim(p_tran_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction ID is required');
  END IF;

  SELECT s.status, s.order_id, o.invoice_number
  INTO v_session
  FROM public.online_payment_sessions s
  LEFT JOIN public.orders o ON o.id = s.order_id
  WHERE s.tran_id = trim(p_tran_id)
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment session not found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_session.status,
    'invoice_number', v_session.invoice_number,
    'order_id', v_session.order_id
  );
END;
$$;

-- 4. Grant execute permissions on get_payment_status to anon, authenticated, service_role
REVOKE ALL ON FUNCTION public.get_payment_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_status(TEXT) TO anon, authenticated, service_role;
