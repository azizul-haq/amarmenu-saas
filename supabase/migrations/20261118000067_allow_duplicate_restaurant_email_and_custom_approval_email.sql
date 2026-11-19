-- ==============================================================================
-- AmarMenu Migration: Remove Duplicate Email Restriction on Restaurants & Enhance Approval RPC
-- Migration: 20261118000067_allow_duplicate_restaurant_email_and_custom_approval_email.sql
-- ==============================================================================

-- 1. Remove artificial global unique constraint on restaurants.email.
-- Multiple restaurant branches or separate brands can legitimately share the same
-- merchant contact email while maintaining distinct UUIDs and unique slugs.
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_email_key;

-- 2. Drop old approve_registration_request signature to avoid ambiguity
DROP FUNCTION IF EXISTS public.approve_registration_request(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.approve_registration_request(UUID, TEXT, TEXT, TEXT);

-- 3. Recreate approve_registration_request accepting custom p_email and auto-linking existing auth accounts
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
BEGIN
  -- 1. Security Check: Caller must be an active super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin privilege required';
  END IF;

  -- 2. Fetch Registration Request
  SELECT * INTO v_req FROM registration_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Registration request not found';
  END IF;

  IF v_req.status = 'approved' THEN
    RAISE EXCEPTION 'Registration request has already been approved';
  END IF;

  -- 3. Determine owner email (prefer super admin override, fallback to request email)
  v_email := lower(trim(COALESCE(NULLIF(p_email, ''), v_req.email)));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'A valid email address is required to approve the restaurant';
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

-- Revoke default PUBLIC privileges
REVOKE ALL ON FUNCTION public.approve_registration_request(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

-- Grant EXECUTE to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.approve_registration_request(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
