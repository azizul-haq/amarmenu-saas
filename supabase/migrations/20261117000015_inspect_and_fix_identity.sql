-- ==============================================================================
-- AmarMenu Migration: Replicate testowner identity format for ownerb
-- Version: 20261117000015_inspect_and_fix_identity.sql
-- ==============================================================================

DO $$
DECLARE
  v_testowner_id UUID;
  v_owner_b_id UUID;
  v_ident_provider TEXT;
BEGIN
  SELECT id INTO v_testowner_id FROM auth.users WHERE email = 'testowner@amarmenu.com';
  SELECT id INTO v_owner_b_id FROM auth.users WHERE email = 'ownerb@amarmenu.com';

  IF v_testowner_id IS NOT NULL AND v_owner_b_id IS NOT NULL THEN
    SELECT provider INTO v_ident_provider 
    FROM auth.identities 
    WHERE user_id = v_testowner_id 
    LIMIT 1;

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
      v_owner_b_id,
      v_owner_b_id,
      json_build_object('sub', v_owner_b_id::text, 'email', 'ownerb@amarmenu.com', 'email_verified', true)::jsonb,
      COALESCE(v_ident_provider, 'email'),
      v_owner_b_id::text,
      NOW(),
      NOW(),
      NOW()
    );
  END IF;
END $$;
