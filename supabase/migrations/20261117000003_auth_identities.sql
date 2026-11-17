-- ==============================================================================
-- AmarMenu Migration: GoTrue Auth Identities & Password Hash Alignment
-- Version: 20261117000003_auth_identities.sql
-- Description:
--   Creates identities in auth.identities for GoTrue authentication compatibility
-- ==============================================================================

DO $$
DECLARE
  v_admin_id UUID;
  v_demo_id UUID;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@foodorder.com';
  SELECT id INTO v_demo_id FROM auth.users WHERE email = 'demorestaurant@gmail.com';

  -- Update email_confirmed_at and encrypted_password
  IF v_admin_id IS NOT NULL THEN
    UPDATE auth.users 
    SET email_confirmed_at = NOW(),
        encrypted_password = crypt('admin123', gen_salt('bf'))
    WHERE id = v_admin_id;

    -- Add identity for admin
    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_admin_id) THEN
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
        v_admin_id,
        json_build_object('sub', v_admin_id::text, 'email', 'admin@foodorder.com')::jsonb,
        'email',
        v_admin_id::text,
        NOW(),
        NOW(),
        NOW()
      );
    END IF;
  END IF;

  IF v_demo_id IS NOT NULL THEN
    UPDATE auth.users 
    SET email_confirmed_at = NOW(),
        encrypted_password = crypt('demo123', gen_salt('bf'))
    WHERE id = v_demo_id;

    -- Add identity for demo restaurant
    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_demo_id) THEN
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
        v_demo_id,
        json_build_object('sub', v_demo_id::text, 'email', 'demorestaurant@gmail.com')::jsonb,
        'email',
        v_demo_id::text,
        NOW(),
        NOW(),
        NOW()
      );
    END IF;
  END IF;

END $$;
