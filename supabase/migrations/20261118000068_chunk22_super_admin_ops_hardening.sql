-- ==============================================================================
-- AmarMenu Migration: Chunk 22 - Super Admin Ops Hardening
-- Migration: 20261118000068_chunk22_super_admin_ops_hardening.sql
-- ==============================================================================

-- 0. Ensure restaurants has block_reason column and plans has updated_at column
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS block_reason TEXT;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 1. Immutable TrxID normalization function
CREATE OR REPLACE FUNCTION public.normalize_trxid(p_trxid TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_trxid IS NULL OR trim(p_trxid) = '' THEN NULL
    ELSE lower(trim(p_trxid))
  END;
$$;

-- 2. Partial unique index on subscription_invoices covering pending, paid, and rejected TrxIDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_invoices_unique_trxid
ON public.subscription_invoices (public.normalize_trxid(transaction_id))
WHERE status IN ('pending', 'paid', 'rejected') 
  AND transaction_id IS NOT NULL 
  AND trim(transaction_id) <> '';

-- 3. Dedicated Append-Only platform_audit_logs table
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_action ON public.platform_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_target ON public.platform_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_actor ON public.platform_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created ON public.platform_audit_logs(created_at DESC);

-- Trigger function to strictly prevent UPDATE, DELETE, and TRUNCATE
CREATE OR REPLACE FUNCTION public.prevent_platform_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Platform audit logs are strictly append-only and cannot be mutated or deleted'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_audit_block_mutation ON public.platform_audit_logs;
CREATE TRIGGER trg_platform_audit_block_mutation
BEFORE UPDATE OR DELETE ON public.platform_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_audit_mutation();

DROP TRIGGER IF EXISTS trg_platform_audit_block_truncate ON public.platform_audit_logs;
CREATE TRIGGER trg_platform_audit_block_truncate
BEFORE TRUNCATE ON public.platform_audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_platform_audit_mutation();

-- RLS: Revoke all writes from public/anon/authenticated. Grant SELECT to super admin only.
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.platform_audit_logs TO service_role;

DROP POLICY IF EXISTS platform_audit_logs_super_admin_select ON public.platform_audit_logs;
CREATE POLICY platform_audit_logs_super_admin_select ON public.platform_audit_logs
  FOR SELECT TO authenticated
  USING (is_super_admin());

-- 4. Super Admin RPC: Release Rejected Subscription TrxID
CREATE OR REPLACE FUNCTION public.admin_release_subscription_trxid(
  p_invoice_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_invoice RECORD;
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
  v_old_trxid TEXT;
  v_new_trxid TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_invoice FROM subscription_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription invoice not found' USING ERRCODE = 'P0004';
  END IF;

  IF v_invoice.status != 'rejected' THEN
    RAISE EXCEPTION 'Only rejected transaction IDs can be released' USING ERRCODE = 'P0008';
  END IF;

  IF v_invoice.transaction_id IS NULL OR trim(v_invoice.transaction_id) = '' THEN
    RAISE EXCEPTION 'Invoice has no transaction ID to release' USING ERRCODE = 'P0008';
  END IF;

  v_old_trxid := v_invoice.transaction_id;
  v_new_trxid := v_old_trxid || '-RELEASED-' || substr(md5(gen_random_uuid()::text), 1, 8);

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  UPDATE subscription_invoices
  SET transaction_id = v_new_trxid,
      notes = COALESCE(notes || E'\n', '') || 'TrxID released by admin: ' || COALESCE(p_reason, 'No reason specified'),
      updated_at = NOW()
  WHERE id = p_invoice_id;

  INSERT INTO platform_audit_logs (
    actor_id,
    actor_email,
    action,
    target_type,
    target_id,
    old_values,
    new_values,
    reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    'release_subscription_trxid',
    'subscription_invoice',
    p_invoice_id::text,
    jsonb_build_object('transaction_id', v_old_trxid, 'status', 'rejected'),
    jsonb_build_object('transaction_id', v_new_trxid, 'released_trxid', v_old_trxid),
    p_reason
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'invoice_id', p_invoice_id,
    'released_trxid', v_old_trxid,
    'message', 'Transaction ID successfully released'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_release_subscription_trxid(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_subscription_trxid(UUID, TEXT) TO authenticated, service_role;

-- 5. Hardened submit_subscription_payment: checks normalized TrxID with generic error
DROP FUNCTION IF EXISTS submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
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
  v_caller_role TEXT;
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
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := is_super_admin();
  IF NOT v_is_super THEN
    SELECT role INTO v_caller_role
    FROM restaurant_staff
    WHERE auth_user_id = v_caller_id
      AND restaurant_id = p_restaurant_id
      AND is_active = TRUE;

    IF v_caller_role IS NULL OR v_caller_role <> 'owner' THEN
      RAISE EXCEPTION 'Access denied: You do not have permission to submit payments for this restaurant' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Normalized TrxID check
  IF p_transaction_id IS NOT NULL AND trim(p_transaction_id) <> '' THEN
    IF EXISTS (
      SELECT 1 FROM subscription_invoices
      WHERE public.normalize_trxid(transaction_id) = public.normalize_trxid(p_transaction_id)
        AND status IN ('pending', 'paid', 'rejected')
    ) THEN
      RAISE EXCEPTION 'Transaction ID has already been used and cannot be submitted again'
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  SELECT * INTO v_plan FROM plans WHERE name = LOWER(p_plan_code) AND is_active = TRUE;
  IF NOT FOUND THEN
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

  IF p_billing_cycle = 'yearly' THEN
    v_period_end := v_period_start + INTERVAL '365 days';
  ELSE
    v_period_end := v_period_start + INTERVAL '30 days';
  END IF;

  SELECT id INTO v_sub FROM subscriptions WHERE restaurant_id = p_restaurant_id ORDER BY created_at DESC LIMIT 1;

  SELECT COUNT(*) + 1 INTO v_invoice_seq
  FROM subscription_invoices
  WHERE invoice_number LIKE 'SAAS-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '%';

  v_invoice_number := 'SAAS-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMM') || '-' || LPAD(v_invoice_seq::TEXT, 4, '0');

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
    'created_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_subscription_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 6. Hardened verify_subscription_payment: REQUIRED p_amount, self-verification guard, audited
DROP FUNCTION IF EXISTS public.verify_subscription_payment(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.verify_subscription_payment(UUID, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.verify_subscription_payment(
  p_invoice_id UUID,
  p_action TEXT,
  p_amount NUMERIC,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_email TEXT;
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

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  -- 2. Fetch Invoice
  SELECT * INTO v_invoice FROM subscription_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription invoice not found' USING ERRCODE = 'P0004';
  END IF;

  IF v_invoice.status != 'pending' THEN
    RAISE EXCEPTION 'Invoice is already % and cannot be modified', v_invoice.status USING ERRCODE = 'P0005';
  END IF;

  -- 3. Self-verification Guard: Super Admin who is also staff/owner of invoice restaurant is denied
  IF EXISTS (
    SELECT 1 FROM restaurant_staff
    WHERE auth_user_id = v_caller_id
      AND restaurant_id = v_invoice.restaurant_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Access denied: Super Admin cannot verify payments for their own restaurant' USING ERRCODE = 'P0003';
  END IF;

  -- 4. Handle Actions
  IF LOWER(p_action) = 'approve' THEN
    -- Amount verification: must match invoice amount exactly
    IF p_amount IS NULL OR p_amount != v_invoice.amount THEN
      RAISE EXCEPTION 'Verified amount (%) does not match invoice amount (%)', p_amount, v_invoice.amount
        USING ERRCODE = 'P0007';
    END IF;

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

    -- Audit log
    INSERT INTO platform_audit_logs (
      actor_id,
      actor_email,
      action,
      target_type,
      target_id,
      old_values,
      new_values,
      reason
    ) VALUES (
      v_caller_id,
      COALESCE(v_caller_email, 'system'),
      'verify_subscription_payment',
      'subscription_invoice',
      p_invoice_id::text,
      jsonb_build_object('status', 'pending', 'amount', v_invoice.amount),
      jsonb_build_object('status', 'paid', 'verified_amount', p_amount, 'plan_code', v_invoice.plan_code),
      'Payment verified and activated by Super Admin'
    );

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

    -- Audit log
    INSERT INTO platform_audit_logs (
      actor_id,
      actor_email,
      action,
      target_type,
      target_id,
      old_values,
      new_values,
      reason
    ) VALUES (
      v_caller_id,
      COALESCE(v_caller_email, 'system'),
      'reject_subscription_payment',
      'subscription_invoice',
      p_invoice_id::text,
      jsonb_build_object('status', 'pending', 'amount', v_invoice.amount),
      jsonb_build_object('status', 'rejected', 'rejection_reason', p_rejection_reason),
      p_rejection_reason
    );

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

REVOKE ALL ON FUNCTION public.verify_subscription_payment(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_subscription_payment(UUID, TEXT, NUMERIC, TEXT) TO authenticated, service_role;

-- 7. Internal Sweep Function: evaluate_subscription_grace_and_lock(p_actor_id UUID DEFAULT NULL)
DROP FUNCTION IF EXISTS public.evaluate_subscription_grace_and_lock();
DROP FUNCTION IF EXISTS public.evaluate_subscription_grace_and_lock(UUID);

CREATE OR REPLACE FUNCTION public.evaluate_subscription_grace_and_lock(
  p_actor_id UUID DEFAULT NULL
)
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
  v_actor_email TEXT := 'system';
BEGIN
  -- NO auth.uid() check here: callable by service_role or backend pg_cron directly
  IF p_actor_id IS NOT NULL THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = p_actor_id;
    IF v_actor_email IS NULL THEN
      v_actor_email := p_actor_id::text;
    END IF;
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

        INSERT INTO platform_audit_logs (
          actor_id, actor_email, action, target_type, target_id,
          old_values, new_values, reason
        ) VALUES (
          p_actor_id, v_actor_email, 'subscription_grace_period', 'subscription', v_sub.id::text,
          jsonb_build_object('status', v_sub.status),
          jsonb_build_object('status', 'grace_period', 'restaurant_id', v_sub.restaurant_id),
          'Trial expired: assigned 7-day grace period'
        );
      END IF;
    ELSE
      -- More than 7 days overdue -> Suspend and lock restaurant
      IF v_sub.status != 'suspended' THEN
        UPDATE subscriptions SET status = 'suspended', updated_at = v_now WHERE id = v_sub.id;
        UPDATE restaurants
        SET
          status = 'blocked',
          is_active = FALSE,
          block_reason = 'Trial expired without subscription payment (Grace period exceeded)',
          updated_at = v_now
        WHERE id = v_sub.restaurant_id;
        v_suspended_count := v_suspended_count + 1;

        INSERT INTO platform_audit_logs (
          actor_id, actor_email, action, target_type, target_id,
          old_values, new_values, reason
        ) VALUES (
          p_actor_id, v_actor_email, 'subscription_suspend_and_lock', 'restaurant', v_sub.restaurant_id::text,
          jsonb_build_object('subscription_status', v_sub.status),
          jsonb_build_object('subscription_status', 'suspended', 'restaurant_status', 'blocked'),
          'Trial grace period exceeded: suspended subscription and locked restaurant'
        );
      END IF;
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

        INSERT INTO platform_audit_logs (
          actor_id, actor_email, action, target_type, target_id,
          old_values, new_values, reason
        ) VALUES (
          p_actor_id, v_actor_email, 'subscription_grace_period', 'subscription', v_sub.id::text,
          jsonb_build_object('status', v_sub.status),
          jsonb_build_object('status', 'grace_period', 'restaurant_id', v_sub.restaurant_id),
          'Subscription renewal overdue: assigned 7-day grace period'
        );
      END IF;
    ELSE
      -- More than 7 days overdue -> Suspend and lock restaurant
      IF v_sub.status != 'suspended' THEN
        UPDATE subscriptions SET status = 'suspended', updated_at = v_now WHERE id = v_sub.id;
        UPDATE restaurants
        SET
          status = 'blocked',
          is_active = FALSE,
          block_reason = 'Subscription renewal overdue (Grace period exceeded)',
          updated_at = v_now
        WHERE id = v_sub.restaurant_id;
        v_suspended_count := v_suspended_count + 1;

        INSERT INTO platform_audit_logs (
          actor_id, actor_email, action, target_type, target_id,
          old_values, new_values, reason
        ) VALUES (
          p_actor_id, v_actor_email, 'subscription_suspend_and_lock', 'restaurant', v_sub.restaurant_id::text,
          jsonb_build_object('subscription_status', v_sub.status),
          jsonb_build_object('subscription_status', 'suspended', 'restaurant_status', 'blocked'),
          'Subscription renewal grace period exceeded: suspended and locked restaurant'
        );
      END IF;
    END IF;
  END LOOP;

  -- Returns counts only, no restaurant names/emails
  RETURN jsonb_build_object(
    'success', TRUE,
    'evaluated_at', v_now,
    'grace_period_assigned', v_grace_count,
    'suspended_and_locked', v_suspended_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_subscription_grace_and_lock(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_subscription_grace_and_lock(UUID) TO service_role;

-- 8. Super Admin Wrapper: admin_run_grace_sweep()
CREATE OR REPLACE FUNCTION public.admin_run_grace_sweep()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  RETURN public.evaluate_subscription_grace_and_lock(auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_grace_sweep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_grace_sweep() TO authenticated, service_role;

-- 9. Instrument admin_toggle_restaurant_status with platform_audit_logs
CREATE OR REPLACE FUNCTION public.admin_toggle_restaurant_status(
  p_restaurant_id UUID,
  p_is_active BOOLEAN,
  p_block_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_old_is_active BOOLEAN;
  v_old_status TEXT;
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_active, status INTO v_old_is_active, v_old_status
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  UPDATE restaurants
  SET
    is_active = p_is_active,
    status = CASE WHEN p_is_active THEN 'active' ELSE 'blocked' END,
    block_reason = CASE WHEN p_is_active THEN NULL ELSE p_block_reason END,
    updated_at = NOW()
  WHERE id = p_restaurant_id;

  INSERT INTO platform_audit_logs (
    actor_id, actor_email, action, target_type, target_id,
    old_values, new_values, reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    'toggle_restaurant_status',
    'restaurant',
    p_restaurant_id::text,
    jsonb_build_object('is_active', v_old_is_active, 'status', v_old_status),
    jsonb_build_object('is_active', p_is_active, 'status', CASE WHEN p_is_active THEN 'active' ELSE 'blocked' END),
    p_block_reason
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- 10. Instrument admin_reject_request with platform_audit_logs
CREATE OR REPLACE FUNCTION public.admin_reject_request(
  p_request_id UUID,
  p_rejection_reason TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_final_reason TEXT;
  v_old_status TEXT;
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required' USING ERRCODE = 'P0002';
  END IF;

  SELECT status INTO v_old_status FROM registration_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration request not found' USING ERRCODE = 'P0002';
  END IF;

  v_final_reason := COALESCE(p_rejection_reason, p_reason, 'Rejected by platform admin');
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  UPDATE registration_requests
  SET
    status = 'rejected',
    reviewed_at = NOW(),
    rejection_reason = v_final_reason
  WHERE id = p_request_id;

  INSERT INTO platform_audit_logs (
    actor_id, actor_email, action, target_type, target_id,
    old_values, new_values, reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    'reject_registration_request',
    'registration_request',
    p_request_id::text,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', 'rejected'),
    v_final_reason
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reject_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_request(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 11. Instrument approve_registration_request with platform_audit_logs
CREATE OR REPLACE FUNCTION public.approve_registration_request(
  p_request_id UUID,
  p_subscription_plan TEXT DEFAULT 'free_trial',
  p_internal_notes TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_req registration_requests%ROWTYPE;
  v_slug TEXT;
  v_base_slug TEXT;
  v_restaurant_id UUID;
  v_plan_id UUID;
  v_staff_id UUID;
  v_email TEXT;
  v_existing_auth_id UUID;
  v_result JSONB;
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
BEGIN
  -- 1. Security Check: Caller must be an active super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin privilege required' USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  -- 2. Fetch Registration Request
  SELECT * INTO v_req FROM registration_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Registration request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status = 'approved' THEN
    RAISE EXCEPTION 'Registration request has already been approved' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Determine owner email (prefer super admin override, fallback to request email)
  v_email := lower(trim(COALESCE(NULLIF(p_email, ''), v_req.email)));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A valid email address is required to approve the restaurant' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Generate unique slug
  v_base_slug := lower(regexp_replace(trim(v_req.restaurant_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  v_slug := v_base_slug;

  IF EXISTS (SELECT 1 FROM restaurants WHERE slug = v_slug) THEN
    v_slug := v_base_slug || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  -- 5. Create Restaurant Record
  INSERT INTO restaurants (
    name,
    slug,
    phone,
    email,
    city,
    address,
    restaurant_type,
    subscription_plan,
    is_active,
    currency,
    default_vat_rate
  ) VALUES (
    v_req.restaurant_name,
    v_slug,
    v_req.phone,
    v_email,
    v_req.city,
    v_req.address,
    v_req.restaurant_type,
    COALESCE(p_subscription_plan, 'free_trial'),
    true,
    '৳',
    0.05
  )
  RETURNING id INTO v_restaurant_id;

  -- 6. Look up plan by name and provision subscription
  SELECT id INTO v_plan_id FROM plans WHERE name = lower(p_subscription_plan) LIMIT 1;

  INSERT INTO subscriptions (
    restaurant_id,
    plan_id,
    status,
    current_period_start,
    current_period_end
  ) VALUES (
    v_restaurant_id,
    v_plan_id,
    'active',
    NOW(),
    NOW() + INTERVAL '30 days'
  );

  -- 7. Check if user already exists in auth.users and auto-link immediately
  SELECT id INTO v_existing_auth_id
  FROM auth.users
  WHERE lower(email) = v_email
  LIMIT 1;

  -- 8. Create Restaurant Staff entry (role: owner)
  INSERT INTO restaurant_staff (
    restaurant_id,
    auth_user_id,
    full_name,
    phone,
    email,
    role,
    is_active
  ) VALUES (
    v_restaurant_id,
    v_existing_auth_id,
    v_req.owner_name,
    v_req.phone,
    v_email,
    'owner',
    true
  )
  RETURNING id INTO v_staff_id;

  -- 9. Update Registration Request
  UPDATE registration_requests
  SET
    status = 'approved',
    reviewed_at = NOW(),
    internal_notes = p_internal_notes,
    email = v_email
  WHERE id = p_request_id;

  -- 10. Audit log
  INSERT INTO public.platform_audit_logs (
    actor_id,
    actor_email,
    action,
    target_type,
    target_id,
    old_values,
    new_values,
    reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    'approve_registration_request',
    'restaurant',
    v_restaurant_id::text,
    jsonb_build_object('registration_request_id', p_request_id, 'status', 'pending'),
    jsonb_build_object('restaurant_id', v_restaurant_id, 'status', 'approved', 'plan', p_subscription_plan, 'email', v_email),
    p_internal_notes
  );

  v_result := jsonb_build_object(
    'success', true,
    'restaurant_id', v_restaurant_id,
    'restaurant_name', v_req.restaurant_name,
    'slug', v_slug,
    'owner_name', v_req.owner_name,
    'email', v_email,
    'staff_id', v_staff_id,
    'already_has_auth_account', (v_existing_auth_id IS NOT NULL)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_registration_request(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_registration_request(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 12. Instrument admin_override_subscription with platform_audit_logs
CREATE OR REPLACE FUNCTION public.admin_override_subscription(
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
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
  v_old_status TEXT;
  v_old_plan TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  SELECT id, price_monthly INTO v_plan_id, v_plan_price FROM plans WHERE name = LOWER(p_plan_code);
  IF v_plan_price IS NULL THEN
    v_plan_price := 2999.00;
  END IF;

  SELECT status, plan_code INTO v_old_status, v_old_plan FROM subscriptions WHERE restaurant_id = p_restaurant_id LIMIT 1;

  -- Check if subscription exists for restaurant
  IF v_old_status IS NOT NULL THEN
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

  INSERT INTO platform_audit_logs (
    actor_id, actor_email, action, target_type, target_id,
    old_values, new_values, reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    'override_subscription',
    'restaurant_subscription',
    p_restaurant_id::text,
    jsonb_build_object('status', v_old_status, 'plan_code', v_old_plan),
    jsonb_build_object('status', p_status, 'plan_code', LOWER(p_plan_code), 'expires_at', v_new_end),
    'Manual subscription override by Super Admin'
  );

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

REVOKE ALL ON FUNCTION public.admin_override_subscription(UUID, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_override_subscription(UUID, TEXT, TEXT, INT) TO authenticated, service_role;

-- 13. Instrument admin_save_plan with platform_audit_logs
CREATE OR REPLACE FUNCTION public.admin_save_plan(
  p_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_price_monthly NUMERIC DEFAULT 0,
  p_price_yearly NUMERIC DEFAULT 0,
  p_max_tables INT DEFAULT NULL,
  p_max_staff INT DEFAULT NULL,
  p_features JSONB DEFAULT '[]'::jsonb,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plan_id UUID;
  v_plan_name TEXT;
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
  v_old_display TEXT;
  v_old_price NUMERIC;
  v_action TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Plan name is required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
  v_plan_name := lower(trim(p_name));

  IF p_id IS NOT NULL THEN
    v_action := 'update_plan';
    SELECT display_name, price_monthly INTO v_old_display, v_old_price FROM plans WHERE id = p_id;

    UPDATE plans
    SET
      display_name = COALESCE(p_display_name, display_name),
      description = COALESCE(p_description, description),
      price_monthly = COALESCE(p_price_monthly, price_monthly),
      price_yearly = COALESCE(p_price_yearly, price_yearly),
      max_tables = p_max_tables,
      max_staff = p_max_staff,
      features = COALESCE(p_features, features),
      is_active = COALESCE(p_is_active, is_active),
      updated_at = NOW()
    WHERE id = p_id
    RETURNING id INTO v_plan_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Plan not found for update' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_action := 'create_plan';
    INSERT INTO plans (
      name, display_name, description, price_monthly, price_yearly,
      max_tables, max_staff, features, is_active, created_at, updated_at
    ) VALUES (
      v_plan_name,
      COALESCE(p_display_name, initcap(v_plan_name)),
      COALESCE(p_description, ''),
      COALESCE(p_price_monthly, 0),
      COALESCE(p_price_yearly, 0),
      p_max_tables,
      p_max_staff,
      COALESCE(p_features, '[]'::jsonb),
      COALESCE(p_is_active, TRUE),
      NOW(),
      NOW()
    )
    ON CONFLICT (name) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      price_monthly = EXCLUDED.price_monthly,
      price_yearly = EXCLUDED.price_yearly,
      max_tables = EXCLUDED.max_tables,
      max_staff = EXCLUDED.max_staff,
      features = EXCLUDED.features,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING id INTO v_plan_id;
  END IF;

  INSERT INTO platform_audit_logs (
    actor_id, actor_email, action, target_type, target_id,
    old_values, new_values, reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    v_action,
    'plan',
    v_plan_id::text,
    CASE WHEN v_old_display IS NOT NULL THEN jsonb_build_object('display_name', v_old_display, 'price_monthly', v_old_price) ELSE NULL END,
    jsonb_build_object('name', v_plan_name, 'price_monthly', p_price_monthly, 'price_yearly', p_price_yearly, 'is_active', p_is_active),
    'Super Admin plan configuration'
  );

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'message', 'Plan saved successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_plan(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INT, INT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_plan(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INT, INT, JSONB, BOOLEAN) TO authenticated, service_role;

-- 14. Instrument admin_toggle_plan_status with platform_audit_logs
CREATE OR REPLACE FUNCTION public.admin_toggle_plan_status(
  p_plan_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_old_is_active BOOLEAN;
  v_caller_id UUID := auth.uid();
  v_caller_email TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_active INTO v_old_is_active FROM plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

  UPDATE plans
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_plan_id;

  INSERT INTO platform_audit_logs (
    actor_id, actor_email, action, target_type, target_id,
    old_values, new_values, reason
  ) VALUES (
    v_caller_id,
    COALESCE(v_caller_email, 'system'),
    'toggle_plan_status',
    'plan',
    p_plan_id::text,
    jsonb_build_object('is_active', v_old_is_active),
    jsonb_build_object('is_active', p_is_active),
    CASE WHEN p_is_active THEN 'Activated plan' ELSE 'Archived/Deactivated plan' END
  );

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'is_active', p_is_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_toggle_plan_status(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_plan_status(UUID, BOOLEAN) TO authenticated, service_role;

-- 15. Guarded pg_cron daily schedule (00:05 Asia/Dhaka -> 18:05 UTC -> '5 18 * * *')
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    GRANT USAGE ON SCHEMA cron TO service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA cron TO service_role;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_subscription_grace_sweep') THEN
      PERFORM cron.unschedule('daily_subscription_grace_sweep');
    END IF;

    PERFORM cron.schedule(
      'daily_subscription_grace_sweep',
      '5 18 * * *',
      'SELECT public.evaluate_subscription_grace_and_lock(NULL);'
    );
  END IF;
END;
$$;

-- 16. Drop deprecated legacy function if present
DROP FUNCTION IF EXISTS public.admin_create_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
