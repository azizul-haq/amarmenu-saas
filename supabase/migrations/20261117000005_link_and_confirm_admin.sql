-- ==============================================================================
-- AmarMenu Migration: Confirm Admin & Link Profiles
-- Version: 20261117000005_link_and_confirm_admin.sql
-- ==============================================================================

-- 1. Confirm all emails in auth.users so users can sign in immediately
UPDATE auth.users 
SET email_confirmed_at = NOW() 
WHERE email_confirmed_at IS NULL;

-- 2. Link platform_admins to admin@foodorder.com
UPDATE platform_admins pa
SET auth_user_id = u.id
FROM auth.users u
WHERE pa.email = u.email AND u.email = 'admin@foodorder.com';

-- 3. If demorestaurant@gmail.com does not exist in auth.users yet, clone password hash from admin
DO $$
DECLARE
  v_pwd TEXT;
  v_demo_id UUID := gen_random_uuid();
  v_rest_id UUID;
BEGIN
  SELECT encrypted_password INTO v_pwd FROM auth.users WHERE email = 'admin@foodorder.com' LIMIT 1;
  
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'demorestaurant@gmail.com') AND v_pwd IS NOT NULL THEN
    INSERT INTO auth.users (
      id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at
    ) VALUES (
      v_demo_id, 'demorestaurant@gmail.com', v_pwd, NOW(), 
      '{"provider":"email","providers":["email"]}'::jsonb, 
      '{"full_name":"Demo Restaurant Owner"}'::jsonb, 
      'authenticated', 'authenticated', NOW(), NOW()
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_demo_id, 
      json_build_object('sub', v_demo_id::text, 'email', 'demorestaurant@gmail.com')::jsonb, 
      'email', v_demo_id::text, NOW(), NOW(), NOW()
    );
  END IF;

  SELECT id INTO v_rest_id FROM restaurants WHERE slug = 'demo-restaurant' OR email = 'demorestaurant@gmail.com' LIMIT 1;
  SELECT id INTO v_demo_id FROM auth.users WHERE email = 'demorestaurant@gmail.com';

  IF v_rest_id IS NOT NULL AND v_demo_id IS NOT NULL THEN
    UPDATE restaurant_staff 
    SET auth_user_id = v_demo_id 
    WHERE email = 'demorestaurant@gmail.com';
  END IF;
END $$;
