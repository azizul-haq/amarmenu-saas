-- Temporary helper function to inspect table policies
CREATE OR REPLACE FUNCTION get_table_policies(p_table TEXT)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT json_agg(row_to_json(p))
  FROM pg_policies p
  WHERE tablename = p_table;
$$;

GRANT EXECUTE ON FUNCTION get_table_policies(TEXT) TO anon, authenticated;
