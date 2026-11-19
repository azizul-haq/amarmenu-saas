-- ==============================================================================
-- Migration: 20261118000065_fix_admin_reject_request_parameter.sql
-- Description:
-- Fix parameter name conflict on admin_reject_request.
-- DROP function first to prevent SQLSTATE 42P13 (cannot change name of input parameter).
-- Supports both p_rejection_reason and p_reason with defaults.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_reject_request(UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_reject_request(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_reject_request(
  p_request_id UUID,
  p_rejection_reason TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_final_reason TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required' USING ERRCODE = 'P0002';
  END IF;

  v_final_reason := COALESCE(p_rejection_reason, p_reason, 'Rejected by platform admin');

  UPDATE registration_requests
  SET
    status = 'rejected',
    reviewed_at = NOW(),
    rejection_reason = v_final_reason
  WHERE id = p_request_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reject_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_request(UUID, TEXT, TEXT) TO authenticated, service_role;
