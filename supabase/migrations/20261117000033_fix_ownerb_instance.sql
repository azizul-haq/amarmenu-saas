-- ==============================================================================
-- AmarMenu Migration: Align Owner B Instance ID with working testowner
-- Version: 20261117000033_fix_ownerb_instance.sql
-- ==============================================================================

DO $$
DECLARE
  v_src_inst UUID;
BEGIN
  SELECT instance_id INTO v_src_inst FROM auth.users WHERE email = 'testowner@amarmenu.com' LIMIT 1;

  UPDATE auth.users
  SET instance_id = v_src_inst
  WHERE email = 'ownerb@amarmenu.com';
END $$;
