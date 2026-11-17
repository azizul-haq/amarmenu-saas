-- ==============================================================================
-- AmarMenu Migration: Function Privilege Inspection Helper
-- Version: 20261117000051_test_privilege_helpers.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION check_function_privilege(p_role TEXT, p_func TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN has_function_privilege(p_role, p_func, 'EXECUTE');
END;
$$;

GRANT EXECUTE ON FUNCTION check_function_privilege(TEXT, TEXT) TO anon, authenticated, service_role;

-- Helper to safely execute settlement under service role in test/simulation environments
CREATE OR REPLACE FUNCTION test_execute_settlement_as_service_role(
  p_session_id TEXT,
  p_gateway_trx_id TEXT,
  p_val_id TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_super BOOLEAN;
BEGIN
  -- Strict guard: Only Super Admin or service_role can call this test helper
  SELECT is_super_admin() INTO v_is_super;
  IF NOT v_is_super THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = '42501';
  END IF;

  RETURN complete_online_payment(p_session_id, p_gateway_trx_id, p_val_id, p_payload);
END;
$$;

-- Helper to safely execute fail under service role in test/simulation environments
CREATE OR REPLACE FUNCTION test_execute_fail_as_service_role(
  p_session_id TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_super BOOLEAN;
BEGIN
  -- Strict guard: Only Super Admin or service_role can call this test helper
  SELECT is_super_admin() INTO v_is_super;
  IF NOT v_is_super THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = '42501';
  END IF;

  RETURN fail_online_payment(p_session_id, p_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION test_execute_settlement_as_service_role(TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION test_execute_fail_as_service_role(TEXT, TEXT) TO authenticated, service_role;
