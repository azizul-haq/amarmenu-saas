-- ==============================================================================
-- AmarMenu Migration: Audit SECURITY DEFINER Functions for search_path
-- Version: 20261117000052_audit_secdef_functions.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION audit_security_definer_functions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_missing JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb)
  INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosecdef = TRUE
    AND (p.proconfig IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
    ));

  RETURN v_missing;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_security_definer_functions() TO anon, authenticated, service_role;
