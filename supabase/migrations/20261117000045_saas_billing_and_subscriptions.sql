-- ==============================================================================
-- AmarMenu Migration: Super Admin Billing & SaaS Subscriptions
-- Version: 20261117000045_saas_billing_and_subscriptions.sql
-- Description:
--   1. subscription_invoices table: Track platform SaaS subscription payments
--      (bKash, Nagad, Bank Transfer) with transaction IDs and audit verifications.
--   2. submit_subscription_payment: Tenant self-service payment submission RPC.
--   3. verify_subscription_payment: Super Admin approval/rejection RPC with
--      automatic subscription extension, plan activation, and restaurant unlocking.
--   4. evaluate_subscription_grace_and_lock: Automated grace period (7 days)
--      and auto-suspension/lock for expired trials and overdue renewals.
--   5. admin_override_subscription: Super Admin direct subscription management.
--   6. get_platform_billing_overview: Platform-wide MRR, ARR, and subscription KPIs.
-- ==============================================================================

-- ==============================================================================
-- 1. SUBSCRIPTION INVOICES TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  plan_code TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bkash', 'nagad', 'bank_transfer', 'cash', 'card', 'sslcommerz', 'other')),
  transaction_id TEXT,
  sender_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected', 'failed', 'refunded')),
  notes TEXT,
  rejection_reason TEXT,
  period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_invoices_restaurant ON subscription_invoices(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_status ON subscription_invoices(status);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_created ON subscription_invoices(created_at DESC);

-- Enable RLS
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;

-- Staff can view invoices for their own restaurant
DROP POLICY IF EXISTS "sub_invoices_select_tenant" ON subscription_invoices;
CREATE POLICY "sub_invoices_select_tenant" ON subscription_invoices
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- Super admin has full control over all invoices
DROP POLICY IF EXISTS "sub_invoices_admin_all" ON subscription_invoices;
CREATE POLICY "sub_invoices_admin_all" ON subscription_invoices
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ==============================================================================
-- 2. STORED PROCEDURE: submit_subscription_payment
-- ==============================================================================
CREATE OR REPLACE FUNCTION submit_subscription_payment(
  p_restaurant_id UUID,
  p_plan_code TEXT,
  p_billing_cycle TEXT DEFAULT 'monthly',
  p_payment_method TEXT DEFAULT 'bkash',
  p_transaction_id TEXT DEFAULT NULL,
  p_sender_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_plan RECORD;
  v_sub RECORD;
  v_amount NUMERIC(10,2);
  v_invoice_seq INT;
  v_invoice_number TEXT;
  v_invoice_id UUID;
  v_period_start TIMESTAMPTZ := NOW();
  v_period_end TIMESTAMPTZ;
BEGIN
  -- 1. Security Check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := is_super_admin();
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM restaurant_staff
      WHERE auth_user_id = v_caller_id
        AND restaurant_id = p_restaurant_id
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'Access denied: You do not have permission to submit payments for this restaurant' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 2. Resolve Plan and Amount
  SELECT * INTO v_plan FROM plans WHERE name = LOWER(p_plan_code) AND is_active = TRUE;
  IF NOT FOUND THEN
    -- Fallback default pricing if plan row missing
    IF LOWER(p_plan_code) = 'starter' THEN
      v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN 14388.00 ELSE 1499.00 END;
    ELSIF LOWER(p_plan_code) = 'enterprise' THEN
      v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN 57588.00 ELSE 5999.00 END;
    ELSE
      v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN 28788.00 ELSE 2999.00 END;
    END IF;
  ELSE
    v_amount := CASE WHEN p_billing_cycle = 'yearly' THEN v_plan.price_yearly ELSE v_plan.price_monthly END;
  END IF;

  -- 3. Calculate Period
  IF p_billing_cycle = 'yearly' THEN
    v_period_end := v_period_start + INTERVAL '365 days';
  ELSE
    v_period_end := v_period_start + INTERVAL '30 days';
  END IF;

  -- 4. Find Subscription Record
  SELECT id INTO v_sub FROM subscriptions WHERE restaurant_id = p_restaurant_id ORDER BY created_at DESC LIMIT 1;

  -- 5. Generate Invoice Number (e.g. SAAS-202611-0001)
  SELECT COUNT(*) + 1 INTO v_invoice_seq
  FROM subscription_invoices
  WHERE invoice_number LIKE 'SAAS-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '%';

  v_invoice_number := 'SAAS-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '-' || LPAD(v_invoice_seq::TEXT, 4, '0');

  -- 6. Insert Pending Subscription Invoice
  INSERT INTO subscription_invoices (
    invoice_number,
    restaurant_id,
    subscription_id,
    plan_code,
    billing_cycle,
    amount,
    payment_method,
    transaction_id,
    sender_number,
    status,
    notes,
    period_start,
    period_end
  ) VALUES (
    v_invoice_number,
    p_restaurant_id,
    v_sub.id,
    LOWER(p_plan_code),
    p_billing_cycle,
    v_amount,
    LOWER(p_payment_method),
    p_transaction_id,
    p_sender_number,
    'pending',
    p_notes,
    v_period_start,
    v_period_end
  ) RETURNING id INTO v_invoice_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', v_amount,
    'plan_code', LOWER(p_plan_code),
    'billing_cycle', p_billing_cycle,
    'payment_method', LOWER(p_payment_method),
    'transaction_id', p_transaction_id,
    'status', 'pending',
    'message', 'Payment submitted successfully. Awaiting Super Admin verification.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ==============================================================================
-- 3. STORED PROCEDURE: verify_subscription_payment (Super Admin Only)
-- ==============================================================================
CREATE OR REPLACE FUNCTION verify_subscription_payment(
  p_invoice_id UUID,
  p_action TEXT, -- 'approve' or 'reject'
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_invoice RECORD;
  v_plan_id UUID;
BEGIN
  -- 1. Security Check: Caller MUST be Super Admin
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Fetch Invoice
  SELECT * INTO v_invoice FROM subscription_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription invoice not found' USING ERRCODE = 'P0004';
  END IF;

  IF v_invoice.status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is already % and cannot be modified', v_invoice.status USING ERRCODE = 'P0005';
  END IF;

  -- 3. Handle Actions
  IF LOWER(p_action) = 'approve' THEN
    -- Mark invoice as paid
    UPDATE subscription_invoices
    SET
      status = 'paid',
      verified_by = v_caller_id,
      verified_at = NOW(),
      updated_at = NOW()
    WHERE id = p_invoice_id;

    -- Resolve plan_id
    SELECT id INTO v_plan_id FROM plans WHERE name = v_invoice.plan_code;

    -- Upsert or Update active subscription
    IF v_invoice.subscription_id IS NOT NULL THEN
      UPDATE subscriptions
      SET
        plan_id = v_plan_id,
        plan_code = v_invoice.plan_code,
        billing_cycle = v_invoice.billing_cycle,
        amount = v_invoice.amount,
        status = 'active',
        payment_method = v_invoice.payment_method,
        last_payment_at = NOW(),
        current_period_start = v_invoice.period_start,
        current_period_end = v_invoice.period_end,
        trial_ends_at = NULL,
        updated_at = NOW()
      WHERE id = v_invoice.subscription_id;
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
        trial_ends_at
      ) VALUES (
        v_invoice.restaurant_id,
        v_plan_id,
        v_invoice.plan_code,
        v_invoice.billing_cycle,
        v_invoice.amount,
        'active',
        v_invoice.payment_method,
        NOW(),
        v_invoice.period_start,
        v_invoice.period_end,
        NULL
      );
    END IF;

    -- Unlock restaurant if suspended or trial
    UPDATE restaurants
    SET
      subscription_plan = v_invoice.plan_code,
      status = 'active',
      is_active = TRUE,
      block_reason = NULL,
      updated_at = NOW()
    WHERE id = v_invoice.restaurant_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'invoice_id', p_invoice_id,
      'action', 'approved',
      'status', 'paid',
      'plan_code', v_invoice.plan_code,
      'current_period_end', v_invoice.period_end,
      'message', 'Subscription payment verified and account activated successfully.'
    );

  ELSIF LOWER(p_action) = 'reject' THEN
    IF p_rejection_reason IS NULL OR LENGTH(TRIM(p_rejection_reason)) < 3 THEN
      RAISE EXCEPTION 'A valid rejection reason is required (min 3 characters)' USING ERRCODE = 'P0006';
    END IF;

    UPDATE subscription_invoices
    SET
      status = 'rejected',
      rejection_reason = p_rejection_reason,
      verified_by = v_caller_id,
      verified_at = NOW(),
      updated_at = NOW()
    WHERE id = p_invoice_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'invoice_id', p_invoice_id,
      'action', 'rejected',
      'status', 'rejected',
      'rejection_reason', p_rejection_reason,
      'message', 'Subscription payment was rejected.'
    );
  ELSE
    RAISE EXCEPTION 'Invalid action: must be approve or reject' USING ERRCODE = 'P0007';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_subscription_payment(UUID, TEXT, TEXT) TO authenticated;

-- ==============================================================================
-- 4. STORED PROCEDURE: evaluate_subscription_grace_and_lock
-- ==============================================================================
CREATE OR REPLACE FUNCTION evaluate_subscription_grace_and_lock()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_grace_count INT := 0;
  v_suspended_count INT := 0;
  v_now TIMESTAMPTZ := NOW();
  v_sub RECORD;
BEGIN
  -- Only authenticated admins or system callers
  IF auth.uid() IS NOT NULL AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'P0002';
  END IF;

  -- 1. Check Expired Trials
  FOR v_sub IN
    SELECT s.id, s.restaurant_id, s.trial_ends_at, s.status
    FROM subscriptions s
    WHERE s.status IN ('trial', 'grace_period')
      AND s.trial_ends_at IS NOT NULL
      AND s.trial_ends_at < v_now
  LOOP
    -- If within 7 days of trial expiry -> Grace Period
    IF v_now - v_sub.trial_ends_at <= INTERVAL '7 days' THEN
      IF v_sub.status != 'grace_period' THEN
        UPDATE subscriptions SET status = 'grace_period', updated_at = v_now WHERE id = v_sub.id;
        v_grace_count := v_grace_count + 1;
      END IF;
    ELSE
      -- More than 7 days overdue -> Suspend and lock restaurant
      UPDATE subscriptions SET status = 'suspended', updated_at = v_now WHERE id = v_sub.id;
      UPDATE restaurants
      SET
        status = 'blocked',
        is_active = FALSE,
        block_reason = 'Trial expired without subscription payment (Grace period exceeded)',
        updated_at = v_now
      WHERE id = v_sub.restaurant_id;
      v_suspended_count := v_suspended_count + 1;
    END IF;
  END LOOP;

  -- 2. Check Overdue Active Subscriptions
  FOR v_sub IN
    SELECT s.id, s.restaurant_id, s.current_period_end, s.status
    FROM subscriptions s
    WHERE s.status IN ('active', 'grace_period')
      AND s.current_period_end < v_now
  LOOP
    -- If within 7 days of period end -> Grace Period
    IF v_now - v_sub.current_period_end <= INTERVAL '7 days' THEN
      IF v_sub.status != 'grace_period' THEN
        UPDATE subscriptions SET status = 'grace_period', updated_at = v_now WHERE id = v_sub.id;
        v_grace_count := v_grace_count + 1;
      END IF;
    ELSE
      -- More than 7 days overdue -> Suspend and lock restaurant
      UPDATE subscriptions SET status = 'suspended', updated_at = v_now WHERE id = v_sub.id;
      UPDATE restaurants
      SET
        status = 'blocked',
        is_active = FALSE,
        block_reason = 'Subscription renewal overdue (Grace period exceeded)',
        updated_at = v_now
      WHERE id = v_sub.restaurant_id;
      v_suspended_count := v_suspended_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'evaluated_at', v_now,
    'grace_period_assigned', v_grace_count,
    'suspended_and_locked', v_suspended_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION evaluate_subscription_grace_and_lock() TO authenticated;

-- ==============================================================================
-- 5. STORED PROCEDURE: admin_override_subscription (Super Admin Manual Control)
-- ==============================================================================
CREATE OR REPLACE FUNCTION admin_override_subscription(
  p_restaurant_id UUID,
  p_plan_code TEXT,
  p_status TEXT, -- 'trial', 'active', 'grace_period', 'suspended'
  p_extend_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plan_id UUID;
  v_plan_price NUMERIC(10,2);
  v_now TIMESTAMPTZ := NOW();
  v_new_end TIMESTAMPTZ := NOW() + (p_extend_days || ' days')::INTERVAL;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, price_monthly INTO v_plan_id, v_plan_price FROM plans WHERE name = LOWER(p_plan_code);
  IF v_plan_price IS NULL THEN
    v_plan_price := 2999.00;
  END IF;

  -- Check if subscription exists for restaurant
  IF EXISTS (SELECT 1 FROM subscriptions WHERE restaurant_id = p_restaurant_id) THEN
    UPDATE subscriptions
    SET
      plan_id = v_plan_id,
      plan_code = LOWER(p_plan_code),
      amount = v_plan_price,
      status = p_status,
      current_period_end = v_new_end,
      trial_ends_at = CASE WHEN p_status = 'trial' THEN v_new_end ELSE NULL END,
      updated_at = v_now
    WHERE restaurant_id = p_restaurant_id;
  ELSE
    INSERT INTO subscriptions (
      restaurant_id,
      plan_id,
      plan_code,
      amount,
      status,
      current_period_start,
      current_period_end,
      trial_ends_at
    ) VALUES (
      p_restaurant_id,
      v_plan_id,
      LOWER(p_plan_code),
      v_plan_price,
      p_status,
      v_now,
      v_new_end,
      CASE WHEN p_status = 'trial' THEN v_new_end ELSE NULL END
    );
  END IF;

  -- Update restaurant status
  UPDATE restaurants
  SET
    subscription_plan = LOWER(p_plan_code),
    status = CASE WHEN p_status = 'suspended' THEN 'blocked' ELSE 'active' END,
    is_active = CASE WHEN p_status = 'suspended' THEN FALSE ELSE TRUE END,
    block_reason = CASE WHEN p_status = 'suspended' THEN 'Suspended by Super Admin' ELSE NULL END,
    updated_at = v_now
  WHERE id = p_restaurant_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'restaurant_id', p_restaurant_id,
    'plan_code', LOWER(p_plan_code),
    'status', p_status,
    'expires_at', v_new_end,
    'message', 'Subscription updated successfully by Super Admin'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_override_subscription(UUID, TEXT, TEXT, INT) TO authenticated;

-- ==============================================================================
-- 6. STORED PROCEDURE: get_platform_billing_overview
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_platform_billing_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_total_mrr NUMERIC(10,2) := 0.00;
  v_total_arr NUMERIC(10,2) := 0.00;
  v_active_subs INT := 0;
  v_trial_subs INT := 0;
  v_grace_subs INT := 0;
  v_suspended_subs INT := 0;
  v_pending_verifications INT := 0;
  v_total_collected NUMERIC(10,2) := 0.00;
  v_invoices JSONB := '[]'::jsonb;
  v_subscriptions JSONB := '[]'::jsonb;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  -- Counts by status
  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'trial'),
    COUNT(*) FILTER (WHERE status = 'grace_period'),
    COUNT(*) FILTER (WHERE status = 'suspended'),
    COALESCE(SUM(CASE 
      WHEN status = 'active' AND billing_cycle = 'yearly' THEN amount / 12.0
      WHEN status = 'active' THEN amount 
      ELSE 0.00 
    END), 0.00)
  INTO
    v_active_subs,
    v_trial_subs,
    v_grace_subs,
    v_suspended_subs,
    v_total_mrr
  FROM subscriptions;

  v_total_arr := v_total_mrr * 12.0;

  -- Pending and collected invoices
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending'),
    COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0.00)
  INTO
    v_pending_verifications,
    v_total_collected
  FROM subscription_invoices;

  -- Recent Invoices List
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'invoice_number', i.invoice_number,
        'restaurant_id', i.restaurant_id,
        'restaurant_name', r.name,
        'plan_code', i.plan_code,
        'billing_cycle', i.billing_cycle,
        'amount', i.amount,
        'payment_method', i.payment_method,
        'transaction_id', i.transaction_id,
        'sender_number', i.sender_number,
        'status', i.status,
        'notes', i.notes,
        'rejection_reason', i.rejection_reason,
        'created_at', i.created_at,
        'verified_at', i.verified_at
      ) ORDER BY i.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_invoices
  FROM subscription_invoices i
  LEFT JOIN restaurants r ON r.id = i.restaurant_id
  LIMIT 50;

  -- All Restaurant Subscriptions List
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'restaurant_id', s.restaurant_id,
        'restaurant_name', r.name,
        'restaurant_slug', r.slug,
        'owner_phone', r.phone,
        'plan_code', s.plan_code,
        'billing_cycle', s.billing_cycle,
        'amount', s.amount,
        'status', s.status,
        'trial_ends_at', s.trial_ends_at,
        'current_period_end', s.current_period_end,
        'last_payment_at', s.last_payment_at,
        'created_at', s.created_at
      ) ORDER BY s.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_subscriptions
  FROM subscriptions s
  LEFT JOIN restaurants r ON r.id = s.restaurant_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'metrics', jsonb_build_object(
      'total_mrr', v_total_mrr,
      'total_arr', v_total_arr,
      'active_subscriptions', v_active_subs,
      'trial_subscriptions', v_trial_subs,
      'grace_subscriptions', v_grace_subs,
      'suspended_subscriptions', v_suspended_subs,
      'pending_verifications', v_pending_verifications,
      'total_collected', v_total_collected
    ),
    'invoices', v_invoices,
    'subscriptions', v_subscriptions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_platform_billing_overview() TO authenticated;
