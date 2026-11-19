-- ==============================================================================
-- Migration: 20261118000059_chunk20c_rbac_hardening.sql
-- Description:
-- 1. Create restaurant_admin_notes table with super-admin-only RLS
-- 2. Migrate internal_notes, block_reason, registration_request_id from restaurants to restaurant_admin_notes
-- 3. Drop sensitive platform-admin columns from restaurants table
-- 4. Update administrative stored procedures (admin_toggle_restaurant_status, admin_override_subscription,
--    evaluate_subscription_grace_and_lock, verify_subscription_payment) to write to restaurant_admin_notes
-- 5. Revoke ALL table-level INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER on all public tables from anon,
--    granting INSERT only on registration_requests
-- 6. Replace table-level SELECT on restaurants for anon with explicit customer-safe column grants
--    (omitting email, owner_name, trade_license_no, vat_bin_no, subscription_plan, trial_ends_at)
-- 7. Revoke direct SELECT on restaurant_tables from anon (verify_table_qr_token is used)
-- 8. Restrict role_permissions SELECT to authenticated staff
-- 9. Restrict get_table_policies to service_role
-- 10. Revoke EXECUTE on internal trigger helper functions from PUBLIC, anon, authenticated
-- ==============================================================================

-- 1. Create restaurant_admin_notes table
CREATE TABLE IF NOT EXISTS public.restaurant_admin_notes (
  restaurant_id UUID PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  internal_notes TEXT,
  block_reason TEXT,
  registration_request_id UUID REFERENCES public.registration_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.restaurant_admin_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notes_super_admin" ON public.restaurant_admin_notes;
CREATE POLICY "admin_notes_super_admin"
  ON public.restaurant_admin_notes
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Migrate existing data if columns exist in restaurants
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'restaurants' AND column_name = 'internal_notes'
  ) THEN
    INSERT INTO public.restaurant_admin_notes (restaurant_id, internal_notes, block_reason, registration_request_id)
    SELECT id, internal_notes, block_reason, registration_request_id
    FROM public.restaurants
    ON CONFLICT (restaurant_id) DO UPDATE
    SET internal_notes = EXCLUDED.internal_notes,
        block_reason = EXCLUDED.block_reason,
        registration_request_id = EXCLUDED.registration_request_id;
  END IF;
END $$;

-- 2. Drop sensitive admin columns from restaurants
ALTER TABLE public.restaurants DROP COLUMN IF EXISTS internal_notes CASCADE;
ALTER TABLE public.restaurants DROP COLUMN IF EXISTS block_reason CASCADE;
ALTER TABLE public.restaurants DROP COLUMN IF EXISTS registration_request_id CASCADE;

-- 3. Update Stored Procedures to write to restaurant_admin_notes

-- admin_toggle_restaurant_status
CREATE OR REPLACE FUNCTION admin_toggle_restaurant_status(
  p_restaurant_id UUID,
  p_is_active BOOLEAN,
  p_block_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  UPDATE restaurants
  SET is_active = p_is_active,
      status = CASE WHEN p_is_active THEN 'active' ELSE 'blocked' END,
      updated_at = NOW()
  WHERE id = p_restaurant_id;

  INSERT INTO restaurant_admin_notes (restaurant_id, block_reason, updated_at)
  VALUES (
    p_restaurant_id,
    CASE WHEN NOT p_is_active THEN COALESCE(p_block_reason, 'Blocked by Super Admin') ELSE NULL END,
    NOW()
  )
  ON CONFLICT (restaurant_id) DO UPDATE
  SET block_reason = EXCLUDED.block_reason, updated_at = NOW();

  RETURN true;
END;
$$;

-- admin_override_subscription
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
    updated_at = v_now
  WHERE id = p_restaurant_id;

  INSERT INTO restaurant_admin_notes (restaurant_id, block_reason, updated_at)
  VALUES (
    p_restaurant_id,
    CASE WHEN p_status = 'suspended' THEN 'Suspended by Super Admin' ELSE NULL END,
    v_now
  )
  ON CONFLICT (restaurant_id) DO UPDATE
  SET block_reason = EXCLUDED.block_reason, updated_at = EXCLUDED.updated_at;

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

-- evaluate_subscription_grace_and_lock
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
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  -- 1. Check Expired Trials
  FOR v_sub IN
    SELECT s.id, s.restaurant_id, s.trial_ends_at, s.status
    FROM subscriptions s
    WHERE s.status IN ('trial', 'grace_period')
      AND s.trial_ends_at IS NOT NULL
      AND s.trial_ends_at < v_now
  LOOP
    IF v_now - v_sub.trial_ends_at <= INTERVAL '7 days' THEN
      IF v_sub.status != 'grace_period' THEN
        UPDATE subscriptions SET status = 'grace_period', updated_at = v_now WHERE id = v_sub.id;
        v_grace_count := v_grace_count + 1;
      END IF;
    ELSE
      UPDATE subscriptions SET status = 'suspended', updated_at = v_now WHERE id = v_sub.id;
      UPDATE restaurants
      SET
        status = 'blocked',
        is_active = FALSE,
        updated_at = v_now
      WHERE id = v_sub.restaurant_id;

      INSERT INTO restaurant_admin_notes (restaurant_id, block_reason, updated_at)
      VALUES (v_sub.restaurant_id, 'Trial expired without subscription payment (Grace period exceeded)', v_now)
      ON CONFLICT (restaurant_id) DO UPDATE
      SET block_reason = EXCLUDED.block_reason, updated_at = EXCLUDED.updated_at;

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
    IF v_now - v_sub.current_period_end <= INTERVAL '7 days' THEN
      IF v_sub.status != 'grace_period' THEN
        UPDATE subscriptions SET status = 'grace_period', updated_at = v_now WHERE id = v_sub.id;
        v_grace_count := v_grace_count + 1;
      END IF;
    ELSE
      UPDATE subscriptions SET status = 'suspended', updated_at = v_now WHERE id = v_sub.id;
      UPDATE restaurants
      SET
        status = 'blocked',
        is_active = FALSE,
        updated_at = v_now
      WHERE id = v_sub.restaurant_id;

      INSERT INTO restaurant_admin_notes (restaurant_id, block_reason, updated_at)
      VALUES (v_sub.restaurant_id, 'Subscription renewal overdue (Grace period exceeded)', v_now)
      ON CONFLICT (restaurant_id) DO UPDATE
      SET block_reason = EXCLUDED.block_reason, updated_at = EXCLUDED.updated_at;

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

-- verify_subscription_payment
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
      updated_at = NOW()
    WHERE id = v_invoice.restaurant_id;

    UPDATE restaurant_admin_notes
    SET block_reason = NULL, updated_at = NOW()
    WHERE restaurant_id = v_invoice.restaurant_id;

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
      'message', 'Subscription payment rejected.'
    );

  ELSE
    RAISE EXCEPTION 'Invalid action: %. Allowed actions are approve or reject', p_action;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_override_subscription(UUID, TEXT, TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION verify_subscription_payment(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION evaluate_subscription_grace_and_lock() TO service_role;

-- 4. REVOKE INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER on all public tables from anon
-- Revoke all table-level write privileges
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;

-- Re-grant ONLY intended public operations:
GRANT INSERT ON public.registration_requests TO anon;

-- 5. Hardened Column Privileges on restaurants for anon
-- Replace table-level SELECT on restaurants with explicit customer-safe columns
REVOKE SELECT ON public.restaurants FROM anon;
GRANT SELECT (
  id,
  name,
  name_bn,
  slug,
  address,
  city,
  phone,
  restaurant_type,
  logo_url,
  qr_code_url,
  currency,
  currency_symbol,
  default_vat_rate,
  service_charge_rate,
  status,
  is_active,
  created_at,
  updated_at
) ON public.restaurants TO anon;

-- 6. Direct SELECT on restaurant_tables is forbidden for anon (verify_table_qr_token RPC is used)
REVOKE SELECT ON public.restaurant_tables FROM anon;

-- 7. role_permissions SELECT is restricted to authenticated users
REVOKE SELECT ON public.role_permissions FROM anon;
GRANT SELECT ON public.role_permissions TO authenticated;

-- 8. Restrict get_table_policies to service_role only
REVOKE ALL ON FUNCTION get_table_policies(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_table_policies(text) TO service_role;

-- 9. Revoke EXECUTE on internal trigger helper functions from PUBLIC, anon, authenticated
REVOKE ALL ON FUNCTION generate_order_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prevent_audit_log_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION validate_order_status_transition() FROM PUBLIC, anon, authenticated;

-- 10. Fix validate_staff_management for service_role and super_admin
CREATE OR REPLACE FUNCTION validate_staff_management()
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
  IF current_user IN ('service_role', 'postgres') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    v_current_role := current_setting('role', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_role := NULL;
  END;

  IF v_current_role IN ('service_role', 'postgres') THEN
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

    IF (OLD.role <> NEW.role OR OLD.is_active <> NEW.is_active) THEN
      IF NOT has_permission(NEW.restaurant_id, 'manage_staff') THEN
        RAISE EXCEPTION 'Access denied: Only restaurant owner can change staff roles' USING ERRCODE = '42501';
      END IF;
    END IF;

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

    RETURN NEW;
  END IF;

  -- 3. DELETE Validation
  IF TG_OP = 'DELETE' THEN
    IF OLD.auth_user_id = auth.uid() THEN
      RAISE EXCEPTION 'A user can never delete their own staff record' USING ERRCODE = 'P0001';
    END IF;

    IF NOT has_permission(OLD.restaurant_id, 'manage_staff') THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner can delete staff members' USING ERRCODE = '42501';
    END IF;

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

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION validate_staff_management() FROM PUBLIC, anon, authenticated;
