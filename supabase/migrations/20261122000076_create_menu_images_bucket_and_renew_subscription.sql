-- Migration 20261122000076: Create menu-images storage bucket & renew_subscription_online RPC

-- 1. Create storage bucket for menu item images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  TRUE,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

-- Policies for menu-images bucket
DROP POLICY IF EXISTS "Public Read Menu Images" ON storage.objects;
CREATE POLICY "Public Read Menu Images"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "Allow Authenticated Insert Menu Images" ON storage.objects;
CREATE POLICY "Allow Authenticated Insert Menu Images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "Allow Authenticated Update Menu Images" ON storage.objects;
CREATE POLICY "Allow Authenticated Update Menu Images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "Allow Authenticated Delete Menu Images" ON storage.objects;
CREATE POLICY "Allow Authenticated Delete Menu Images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "Allow Anon Insert Menu Images" ON storage.objects;
CREATE POLICY "Allow Anon Insert Menu Images"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'menu-images');

-- 2. Stored Procedure: renew_subscription_online
CREATE OR REPLACE FUNCTION public.renew_subscription_online(
  p_restaurant_id UUID,
  p_plan_code TEXT,
  p_billing_cycle TEXT,
  p_payment_method TEXT,
  p_gateway_trx_id TEXT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_email TEXT;
  v_plan_id UUID;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_subscription_id UUID;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_days INT;
  v_current_end TIMESTAMPTZ;
BEGIN
  -- 1. Security Check: Caller must be authenticated
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Caller must be restaurant owner or super admin
  IF NOT is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM restaurant_staff
    WHERE auth_user_id = v_caller_id
      AND restaurant_id = p_restaurant_id
      AND role = 'owner'
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Access denied: Only restaurant owner can renew subscription' USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  -- 2. Resolve Plan
  SELECT id INTO v_plan_id FROM plans WHERE LOWER(name) = LOWER(p_plan_code) OR LOWER(slug) = LOWER(p_plan_code) LIMIT 1;
  IF v_plan_id IS NULL THEN
    SELECT id INTO v_plan_id FROM plans LIMIT 1;
  END IF;

  -- 3. Calculate Renewal Duration
  IF LOWER(p_billing_cycle) = 'yearly' THEN
    v_days := 365;
  ELSE
    v_days := 30;
  END IF;

  -- Check existing subscription
  SELECT id, current_period_end INTO v_subscription_id, v_current_end
  FROM subscriptions
  WHERE restaurant_id = p_restaurant_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_current_end IS NOT NULL AND v_current_end > NOW() THEN
    v_period_start := v_current_end;
    v_period_end := v_current_end + (v_days || ' days')::INTERVAL;
  ELSE
    v_period_start := NOW();
    v_period_end := NOW() + (v_days || ' days')::INTERVAL;
  END IF;

  -- 4. Generate Invoice Number
  v_invoice_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

  -- 5. Insert directly into subscription_invoices with status = 'paid'
  INSERT INTO subscription_invoices (
    restaurant_id,
    subscription_id,
    invoice_number,
    plan_code,
    billing_cycle,
    amount,
    payment_method,
    transaction_id,
    period_start,
    period_end,
    status,
    verified_by,
    verified_at,
    notes,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    v_subscription_id,
    v_invoice_number,
    LOWER(p_plan_code),
    LOWER(p_billing_cycle),
    p_amount,
    LOWER(p_payment_method),
    p_gateway_trx_id,
    v_period_start,
    v_period_end,
    'paid',
    v_caller_id,
    NOW(),
    'Direct Online Payment (' || UPPER(p_payment_method) || ')',
    NOW(),
    NOW()
  ) RETURNING id INTO v_invoice_id;

  -- 6. Upsert/Update Subscription
  IF v_subscription_id IS NOT NULL THEN
    UPDATE subscriptions
    SET
      plan_id = v_plan_id,
      plan_code = LOWER(p_plan_code),
      billing_cycle = LOWER(p_billing_cycle),
      amount = p_amount,
      status = 'active',
      payment_method = LOWER(p_payment_method),
      last_payment_at = NOW(),
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      trial_ends_at = NULL,
      updated_at = NOW()
    WHERE id = v_subscription_id;
  ELSE
    INSERT INTO subscriptions (
      restaurant_id,
      plan_id,
      plan_code,
      billing_cycle,
      amount,
      status,
      payment_method,
      last_payment_at,
      current_period_start,
      current_period_end,
      trial_ends_at,
      created_at,
      updated_at
    ) VALUES (
      p_restaurant_id,
      v_plan_id,
      LOWER(p_plan_code),
      LOWER(p_billing_cycle),
      p_amount,
      'active',
      LOWER(p_payment_method),
      NOW(),
      v_period_start,
      v_period_end,
      NULL,
      NOW(),
      NOW()
    ) RETURNING id INTO v_subscription_id;

    -- Link back to invoice
    UPDATE subscription_invoices SET subscription_id = v_subscription_id WHERE id = v_invoice_id;
  END IF;

  -- 7. Unlock/Activate Restaurant
  UPDATE restaurants
  SET
    subscription_plan = LOWER(p_plan_code),
    status = 'active',
    is_active = TRUE,
    block_reason = NULL,
    updated_at = NOW()
  WHERE id = p_restaurant_id;

  -- 8. Audit Logging
  INSERT INTO audit_logs (
    restaurant_id,
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    new_values
  ) VALUES (
    p_restaurant_id,
    v_caller_id,
    'owner',
    'subscription_online_renewed',
    'subscriptions',
    v_subscription_id,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'amount', p_amount,
      'plan_code', p_plan_code,
      'billing_cycle', p_billing_cycle,
      'payment_method', p_payment_method,
      'transaction_id', p_gateway_trx_id,
      'period_end', v_period_end
    )
  );

  INSERT INTO platform_audit_logs (
    actor_id,
    actor_email,
    action,
    target_type,
    target_id,
    new_values,
    reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'owner@restaurant.com'),
    'subscription_online_renewed',
    'restaurant',
    p_restaurant_id::text,
    jsonb_build_object(
      'invoice_id', v_invoice_id,
      'invoice_number', v_invoice_number,
      'amount', p_amount,
      'payment_method', p_payment_method
    ),
    'Restaurant owner completed instant online subscription payment'
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'plan_code', p_plan_code,
    'billing_cycle', p_billing_cycle,
    'amount', p_amount,
    'payment_method', p_payment_method,
    'transaction_id', p_gateway_trx_id,
    'current_period_end', v_period_end,
    'message', 'Subscription successfully renewed!'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.renew_subscription_online(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_subscription_online(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated, service_role;
