-- ==============================================================================
-- AmarMenu Migration: Secure Admin Registration Approval Procedure
-- Version: 20261117000018_approve_registration_rpc.sql
-- Description: Server-side procedure for Super Admin approval without temp passwords
-- ==============================================================================

CREATE OR REPLACE FUNCTION approve_registration_request(
  p_request_id UUID,
  p_subscription_plan TEXT DEFAULT 'free_trial',
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req registration_requests%ROWTYPE;
  v_slug TEXT;
  v_base_slug TEXT;
  v_restaurant_id UUID;
  v_plan_id UUID;
  v_staff_id UUID;
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

  -- 3. Generate unique slug
  v_base_slug := lower(regexp_replace(trim(v_req.restaurant_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  v_slug := v_base_slug;

  IF EXISTS (SELECT 1 FROM restaurants WHERE slug = v_slug) THEN
    v_slug := v_base_slug || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  -- 4. Create Restaurant Record
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
    v_req.email,
    v_req.city,
    v_req.address,
    v_req.restaurant_type,
    COALESCE(p_subscription_plan, 'free_trial'),
    true,
    '৳',
    0.05
  )
  RETURNING id INTO v_restaurant_id;

  -- 5. Look up plan and provision subscription
  SELECT id INTO v_plan_id FROM plans WHERE slug = p_subscription_plan LIMIT 1;

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

  -- 6. Create Restaurant Staff entry (role: owner)
  -- Note: auth_user_id will be linked when owner registers or signs in
  INSERT INTO restaurant_staff (
    restaurant_id,
    full_name,
    phone,
    email,
    role,
    is_active
  ) VALUES (
    v_restaurant_id,
    v_req.owner_name,
    v_req.phone,
    v_req.email,
    'owner',
    true
  )
  RETURNING id INTO v_staff_id;

  -- 7. Update Registration Request
  UPDATE registration_requests
  SET
    status = 'approved',
    reviewed_at = NOW(),
    internal_notes = p_internal_notes
  WHERE id = p_request_id;

  v_result := jsonb_build_object(
    'success', true,
    'restaurant_id', v_restaurant_id,
    'restaurant_name', v_req.restaurant_name,
    'slug', v_slug,
    'owner_name', v_req.owner_name,
    'email', v_req.email,
    'staff_id', v_staff_id
  );

  RETURN v_result;
END;
$$;

-- Revoke from public and anon
REVOKE EXECUTE ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;

-- Grant to authenticated (internal is_super_admin() will reject non-admins)
GRANT EXECUTE ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) TO authenticated;
