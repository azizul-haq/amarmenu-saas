-- ==============================================================================
-- AmarMenu Migration: Supabase Auth Provisioning & Linking
-- Version: 20261117000002_auth_setup.sql
-- Description:
--   1. Provisions default Super Admin into auth.users (admin@foodorder.com / admin123)
--   2. Provisions Demo Restaurant Owner into auth.users (demorestaurant@gmail.com / demo123)
--   3. Links auth_user_id foreign keys in platform_admins & restaurant_staff
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Allow 'growth' in restaurants.subscription_plan check constraint
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subscription_plan_check;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_subscription_plan_check 
  CHECK (subscription_plan IN ('free_trial', 'starter', 'growth', 'pro', 'enterprise'));

DO $$
DECLARE
  v_admin_id UUID := '2dc7f21c-ab40-424d-94e6-5f3518b60fe1';
  v_demo_id UUID := '3ec8f32d-bc51-435e-a5f7-6f4629c71ff2';
  v_rest_id UUID;
BEGIN
  -- 1. Create or update Super Admin in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@foodorder.com') THEN
    INSERT INTO auth.users (
      id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      role,
      aud,
      created_at,
      updated_at
    ) VALUES (
      v_admin_id,
      'admin@foodorder.com',
      crypt('admin123', gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"System Admin"}'::jsonb,
      'authenticated',
      'authenticated',
      NOW(),
      NOW()
    );
  ELSE
    UPDATE auth.users 
    SET encrypted_password = crypt('admin123', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW())
    WHERE email = 'admin@foodorder.com';
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@foodorder.com';
  END IF;

  -- Ensure platform_admins entry exists and links auth_user_id
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE email = 'admin@foodorder.com') THEN
    INSERT INTO platform_admins (auth_user_id, email, full_name, role, is_active)
    VALUES (v_admin_id, 'admin@foodorder.com', 'System Admin', 'super_admin', TRUE);
  ELSE
    UPDATE platform_admins 
    SET auth_user_id = v_admin_id, role = 'super_admin', is_active = TRUE
    WHERE email = 'admin@foodorder.com';
  END IF;

  -- 2. Create or update Demo Restaurant Owner in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'demorestaurant@gmail.com') THEN
    INSERT INTO auth.users (
      id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      role,
      aud,
      created_at,
      updated_at
    ) VALUES (
      v_demo_id,
      'demorestaurant@gmail.com',
      crypt('demo123', gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Demo Restaurant Owner"}'::jsonb,
      'authenticated',
      'authenticated',
      NOW(),
      NOW()
    );
  ELSE
    UPDATE auth.users 
    SET encrypted_password = crypt('demo123', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW())
    WHERE email = 'demorestaurant@gmail.com';
    SELECT id INTO v_demo_id FROM auth.users WHERE email = 'demorestaurant@gmail.com';
  END IF;

  -- Ensure demo restaurant exists
  SELECT id INTO v_rest_id FROM restaurants WHERE slug = 'demo-restaurant' OR email = 'demorestaurant@gmail.com' LIMIT 1;
  IF v_rest_id IS NULL THEN
    INSERT INTO restaurants (
      name, name_bn, slug, owner_name, phone, email, city, address, 
      subscription_plan, status, is_active, default_vat_rate, currency, currency_symbol
    ) VALUES (
      'Demo Restaurant', 'ডেমো রেস্তোরাঁ', 'demo-restaurant', 'Demo Owner', '+8801711112222', 
      'demorestaurant@gmail.com', 'Dhaka', 'Dhanmondi, Dhaka',
      'growth', 'active', TRUE, 5.00, 'BDT', '৳'
    ) RETURNING id INTO v_rest_id;
  END IF;

  -- Ensure demo restaurant has a subscription
  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE restaurant_id = v_rest_id) THEN
    INSERT INTO subscriptions (
      restaurant_id, plan_code, amount, status, current_period_start, current_period_end
    ) VALUES (
      v_rest_id, 'growth', 2999.00, 'active', NOW(), NOW() + INTERVAL '30 days'
    );
  END IF;

  -- Ensure restaurant_staff record exists and links auth_user_id
  IF NOT EXISTS (SELECT 1 FROM restaurant_staff WHERE email = 'demorestaurant@gmail.com') THEN
    INSERT INTO restaurant_staff (
      auth_user_id, restaurant_id, full_name, phone, email, role, is_active
    ) VALUES (
      v_demo_id, v_rest_id, 'Demo Restaurant Owner', '+8801711112222', 'demorestaurant@gmail.com', 'owner', TRUE
    );
  ELSE
    UPDATE restaurant_staff 
    SET auth_user_id = v_demo_id,
        restaurant_id = v_rest_id,
        role = 'owner',
        is_active = TRUE
    WHERE email = 'demorestaurant@gmail.com';
  END IF;

END $$;
