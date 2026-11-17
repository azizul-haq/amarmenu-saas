-- ==============================================================================
-- AmarMenu Migration: Clone testowner credentials into ownerb for testing
-- Version: 20261117000014_clone_testowner_to_ownerb.sql
-- ==============================================================================

DO $$
DECLARE
  v_src_user auth.users%ROWTYPE;
  v_new_id UUID := gen_random_uuid();
  v_rest_b_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  -- Read working testowner row
  SELECT * INTO v_src_user FROM auth.users WHERE email = 'testowner@amarmenu.com' LIMIT 1;
  
  IF v_src_user.id IS NOT NULL THEN
    -- Delete any previous ownerb records
    DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'ownerb@amarmenu.com');
    DELETE FROM auth.users WHERE email = 'ownerb@amarmenu.com';

    -- Insert ownerb with identical working attributes (password: password123)
    INSERT INTO auth.users (
      id,
      instance_id,
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
      v_new_id,
      v_src_user.instance_id,
      'ownerb@amarmenu.com',
      v_src_user.encrypted_password,
      NOW(),
      v_src_user.raw_app_meta_data,
      '{"full_name":"Owner Restaurant B"}'::jsonb,
      'authenticated',
      'authenticated',
      NOW(),
      NOW()
    );

    -- Insert matching identity
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
      v_new_id,
      v_new_id,
      json_build_object('sub', v_new_id::text, 'email', 'ownerb@amarmenu.com')::jsonb,
      'email',
      v_new_id::text,
      NOW(),
      NOW(),
      NOW()
    );

    -- Link in restaurant_staff
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
      v_new_id,
      v_rest_b_id,
      'Owner Restaurant B',
      '+8801722223333',
      'ownerb@amarmenu.com',
      'owner',
      true
    );
  END IF;
END $$;
