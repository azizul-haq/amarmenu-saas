-- ==============================================================================
-- AmarMenu Migration: Fix Owner B GoTrue Identity & Password
-- Version: 20261117000009_fix_ownerb_auth.sql
-- ==============================================================================

DO $$
DECLARE
  v_owner_b_id UUID;
  v_pwd TEXT;
BEGIN
  SELECT id INTO v_owner_b_id FROM auth.users WHERE email = 'ownerb@amarmenu.com';
  SELECT encrypted_password INTO v_pwd FROM auth.users WHERE email = 'testowner@amarmenu.com';

  IF v_owner_b_id IS NOT NULL AND v_pwd IS NOT NULL THEN
    -- Update password and confirmation
    UPDATE auth.users
    SET encrypted_password = v_pwd,
        email_confirmed_at = NOW()
    WHERE id = v_owner_b_id;

    -- Fix identities
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
  END IF;
END $$;
