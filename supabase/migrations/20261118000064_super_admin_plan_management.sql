-- ==============================================================================
-- Migration: 20261118000063_super_admin_plan_management.sql
-- Description:
-- 1. Super Admin RPC: admin_list_plans() with subscriber counts
-- 2. Super Admin RPC: admin_save_plan() for creating/updating plans
-- 3. Super Admin RPC: admin_toggle_plan_status() for archiving/activating plans
-- 4. Update approve_registration_request to provision 14-day Growth trial and link restaurant_admin_notes
-- 5. Explicit GRANT SELECT ON plans TO authenticated
-- ==============================================================================

-- 1. Ensure authenticated role has SELECT on plans
GRANT SELECT ON public.plans TO authenticated, anon;

-- 2. Super Admin RPC: admin_list_plans()
CREATE OR REPLACE FUNCTION admin_list_plans()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'display_name', p.display_name,
      'description', p.description,
      'price_monthly', p.price_monthly,
      'price_yearly', p.price_yearly,
      'max_tables', p.max_tables,
      'max_staff', p.max_staff,
      'features', p.features,
      'is_active', p.is_active,
      'active_subscribers', (
        SELECT COUNT(*) FROM subscriptions s
        WHERE s.plan_id = p.id AND s.status IN ('active', 'trial', 'grace_period')
      ),
      'created_at', p.created_at,
      'updated_at', p.updated_at
    ) ORDER BY p.price_monthly ASC
  ) INTO v_res
  FROM plans p;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION admin_list_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_list_plans() TO authenticated, service_role;

-- 3. Super Admin RPC: admin_save_plan()
CREATE OR REPLACE FUNCTION admin_save_plan(
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
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Plan name is required' USING ERRCODE = '22023';
  END IF;

  v_plan_name := lower(trim(p_name));

  IF p_id IS NOT NULL THEN
    -- Update existing plan
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
    -- Insert new plan
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

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'message', 'Plan saved successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_save_plan(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INT, INT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_save_plan(UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INT, INT, JSONB, BOOLEAN) TO authenticated, service_role;

-- 4. Super Admin RPC: admin_toggle_plan_status()
CREATE OR REPLACE FUNCTION admin_toggle_plan_status(
  p_plan_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  UPDATE plans
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', p_plan_id,
    'is_active', p_is_active
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_toggle_plan_status(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_toggle_plan_status(UUID, BOOLEAN) TO authenticated, service_role;

-- 5. Updated approve_registration_request with 14-day Growth trial and restaurant_admin_notes
CREATE OR REPLACE FUNCTION approve_registration_request(
  p_request_id UUID,
  p_subscription_plan TEXT DEFAULT 'growth',
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req registration_requests%ROWTYPE;
  v_slug TEXT;
  v_base_slug TEXT;
  v_restaurant_id UUID;
  v_plan_id UUID;
  v_plan_name TEXT;
  v_staff_id UUID;
  v_trial_end TIMESTAMPTZ := NOW() + INTERVAL '14 days';
BEGIN
  -- 1. Security Check: Caller must be an active super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin privilege required' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Fetch Registration Request
  SELECT * INTO v_req FROM registration_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Registration request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status = 'approved' THEN
    RAISE EXCEPTION 'Registration request has already been approved' USING ERRCODE = '22023';
  END IF;

  -- 3. Resolve plan name and ID
  v_plan_name := lower(trim(COALESCE(p_subscription_plan, 'growth')));
  SELECT id INTO v_plan_id FROM plans WHERE name = v_plan_name LIMIT 1;
  IF v_plan_id IS NULL THEN
    -- Fallback to growth plan
    SELECT id, name INTO v_plan_id, v_plan_name FROM plans WHERE name = 'growth' LIMIT 1;
  END IF;
  IF v_plan_id IS NULL THEN
    -- Ultimate fallback to any active plan
    SELECT id, name INTO v_plan_id, v_plan_name FROM plans WHERE is_active = TRUE ORDER BY price_monthly ASC LIMIT 1;
  END IF;

  -- 4. Generate unique slug
  v_base_slug := lower(regexp_replace(trim(v_req.restaurant_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'restaurant';
  END IF;
  v_slug := v_base_slug;

  IF EXISTS (SELECT 1 FROM restaurants WHERE slug = v_slug) THEN
    v_slug := v_base_slug || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  -- 5. Create Restaurant Record (Status: 'trial', trial_ends_at: 14 days)
  INSERT INTO restaurants (
    name,
    slug,
    phone,
    email,
    city,
    address,
    restaurant_type,
    subscription_plan,
    status,
    is_active,
    trial_ends_at,
    currency,
    currency_symbol,
    default_vat_rate
  ) VALUES (
    v_req.restaurant_name,
    v_slug,
    v_req.phone,
    v_req.email,
    v_req.city,
    v_req.address,
    COALESCE(v_req.restaurant_type, 'Restaurant'),
    v_plan_name,
    'trial',
    true,
    v_trial_end,
    'BDT',
    '৳',
    5.00
  )
  RETURNING id INTO v_restaurant_id;

  -- 6. Provision Subscription Record (status: 'trial', 14 days)
  INSERT INTO subscriptions (
    restaurant_id,
    plan_id,
    status,
    trial_ends_at,
    current_period_start,
    current_period_end
  ) VALUES (
    v_restaurant_id,
    v_plan_id,
    'trial',
    v_trial_end,
    NOW(),
    v_trial_end
  );

  -- 7. Create Restaurant Staff entry (role: owner)
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

  -- 8. Record platform admin notes
  IF p_internal_notes IS NOT NULL AND trim(p_internal_notes) != '' THEN
    INSERT INTO restaurant_admin_notes (
      restaurant_id, registration_request_id, internal_notes
    ) VALUES (
      v_restaurant_id, p_request_id, trim(p_internal_notes)
    )
    ON CONFLICT (restaurant_id) DO UPDATE SET
      internal_notes = EXCLUDED.internal_notes,
      registration_request_id = EXCLUDED.registration_request_id;
  END IF;

  -- 9. Update Registration Request
  UPDATE registration_requests
  SET
    status = 'approved',
    reviewed_at = NOW(),
    internal_notes = p_internal_notes
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'restaurant_id', v_restaurant_id,
    'restaurant_name', v_req.restaurant_name,
    'slug', v_slug,
    'owner_name', v_req.owner_name,
    'email', v_req.email,
    'plan', v_plan_name,
    'trial_ends_at', v_trial_end,
    'staff_id', v_staff_id
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) TO authenticated, service_role;
