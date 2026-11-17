-- ==============================================================================
-- AmarMenu Migration: Ensure Owner B exists and has working auth
-- Version: 20261117000010_ensure_ownerb.sql
-- ==============================================================================

DO $$
DECLARE
  v_admin_pwd TEXT;
  v_owner_b_id UUID := 'b1111111-1111-1111-1111-111111111111';
  v_rest_b_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  -- Get working password hash from admin
  SELECT encrypted_password INTO v_admin_pwd FROM auth.users WHERE email = 'admin@foodorder.com' LIMIT 1;

  -- 1. Ensure auth user exists with known working password (admin123)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'ownerb@amarmenu.com') THEN
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
      v_owner_b_id,
      'ownerb@amarmenu.com',
      v_admin_pwd,
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Owner Restaurant B"}'::jsonb,
      'authenticated',
      'authenticated',
      NOW(),
      NOW()
    );
  ELSE
    SELECT id INTO v_owner_b_id FROM auth.users WHERE email = 'ownerb@amarmenu.com';
    UPDATE auth.users
    SET encrypted_password = v_admin_pwd,
        email_confirmed_at = NOW(),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
        raw_user_meta_data = '{"full_name":"Owner Restaurant B"}'::jsonb
    WHERE id = v_owner_b_id;
  END IF;

  -- 2. Ensure identity exists
  DELETE FROM auth.identities WHERE user_id = v_owner_b_id;

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_owner_b_id,
    json_build_object('sub', v_owner_b_id::text, 'email', 'ownerb@amarmenu.com')::jsonb,
    'email',
    v_owner_b_id::text,
    NOW(),
    NOW(),
    NOW()
  );

  -- 3. Ensure restaurant B exists
  INSERT INTO restaurants (
    id, name, slug, phone, email, city, address, subscription_plan, is_active
  ) VALUES (
    v_rest_b_id,
    'Dhanmondi Treat (Rest B)',
    'dhanmondi-treat',
    '+8801722223333',
    'contact@dhanmonditreat.com',
    'Dhaka',
    'Road 27, Dhanmondi, Dhaka',
    'growth',
    true
  )
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  -- 4. Ensure staff entry exists
  DELETE FROM restaurant_staff WHERE email = 'ownerb@amarmenu.com';

  INSERT INTO restaurant_staff (
    auth_user_id,
    restaurant_id,
    full_name,
    phone,
    email,
    role,
    is_active
  ) VALUES (
    v_owner_b_id,
    v_rest_b_id,
    'Owner Restaurant B',
    '+8801722223333',
    'ownerb@amarmenu.com',
    'owner',
    true
  );

END $$;
