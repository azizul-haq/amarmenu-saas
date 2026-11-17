CREATE OR REPLACE FUNCTION get_vault_secrets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res JSONB;
BEGIN
  BEGIN
    SELECT jsonb_agg(jsonb_build_object('name', name, 'secret', decrypted_secret))
    INTO v_res
    FROM vault.decrypted_secrets;
  EXCEPTION WHEN OTHERS THEN
    v_res := jsonb_build_object('error', SQLERRM);
  END;
  RETURN v_res;
END;
$$;
