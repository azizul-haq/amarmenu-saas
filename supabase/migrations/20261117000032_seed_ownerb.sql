-- ==============================================================================
-- AmarMenu Migration: Seed Permanent Confirmed Owner B for Multi-Tenant Testing
-- Version: 20261117000032_seed_ownerb.sql
-- ==============================================================================

DO $$
DECLARE
  v_owner_b_id UUID := 'b1111111-1111-1111-1111-111111111111';
  v_rest_b_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_pwd TEXT;
BEGIN
  SELECT encrypted_password INTO v_pwd FROM auth.users WHERE email = 'testowner@amarmenu.com';

  -- Clean old if any
  DELETE FROM auth.identities WHERE user_id = v_owner_b_id OR identity_data->>'email' = 'ownerb@amarmenu.com';
  DELETE FROM restaurant_staff WHERE email = 'ownerb@amarmenu.com' OR auth_user_id = v_owner_b_id;
  DELETE FROM auth.users WHERE id = v_owner_b_id OR email = 'ownerb@amarmenu.com';

  -- 1. Insert auth.users
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    created_at,
    updated_at
  ) VALUES (
    v_owner_b_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'ownerb@amarmenu.com',
    v_pwd,
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    json_build_object('sub', v_owner_b_id::text, 'email', 'ownerb@amarmenu.com', 'email_verified', true, 'phone_verified', false)::jsonb,
    false,
    NOW(),
    NOW()
  );

  -- 2. Insert auth.identities
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
    v_owner_b_id,
    v_owner_b_id,
    json_build_object('sub', v_owner_b_id::text, 'email', 'ownerb@amarmenu.com')::jsonb,
    'email',
    v_owner_b_id::text,
    NOW(),
    NOW(),
    NOW()
  );

  -- 3. Link to restaurant_staff as owner of Restaurant B
  INSERT INTO restaurant_staff (
    id,
    restaurant_id,
    auth_user_id,
    full_name,
    email,
    role,
    is_active
  ) VALUES (
    v_owner_b_id,
    v_rest_b_id,
    v_owner_b_id,
    'Owner B (Dhanmondi Treat)',
    'ownerb@amarmenu.com',
    'owner',
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    restaurant_id = EXCLUDED.restaurant_id,
    auth_user_id = EXCLUDED.auth_user_id,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = true;

END $$;
