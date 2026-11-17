-- ==============================================================================
-- AmarMenu Migration: Fix search_path on regenerate_table_qr_token
-- Version: 20261117000026_fix_qr_regen_function.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION regenerate_table_qr_token(p_table_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_new_token TEXT;
BEGIN
  -- Check caller is staff for this table's restaurant or super admin
  IF NOT EXISTS (
    SELECT 1 FROM restaurant_tables t
    WHERE t.id = p_table_id
      AND (t.restaurant_id = current_restaurant_id() OR is_super_admin())
  ) THEN
    RAISE EXCEPTION 'Not authorized to regenerate QR token for this table';
  END IF;

  -- Generate 32-char unguessable hex token
  v_new_token := encode(extensions.gen_random_bytes(16), 'hex');

  UPDATE restaurant_tables
  SET qr_token = v_new_token, updated_at = NOW()
  WHERE id = p_table_id;

  RETURN v_new_token;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_table_qr_token(UUID) TO authenticated;
