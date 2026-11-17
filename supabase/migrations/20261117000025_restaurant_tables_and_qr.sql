-- ==============================================================================
-- AmarMenu Migration: Restaurant Tables, QR Tokens & Verification Flow
-- Version: 20261117000025_restaurant_tables_and_qr.sql
-- ==============================================================================

-- 1. Create restaurant_tables table
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_number TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4 CHECK (capacity > 0),
  qr_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for fast lookups & unique active table numbers per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_active_number 
ON restaurant_tables(restaurant_id, table_number) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tables_restaurant_deleted 
ON restaurant_tables(restaurant_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_tables_qr_token 
ON restaurant_tables(qr_token);

-- 3. Add table_id reference to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES restaurant_tables(id) ON DELETE SET NULL;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;

-- 5. Staff & Admin RLS policies
DROP POLICY IF EXISTS "tables_select" ON restaurant_tables;
CREATE POLICY "tables_select"
ON restaurant_tables FOR SELECT
USING (restaurant_id = current_restaurant_id() OR is_super_admin());

DROP POLICY IF EXISTS "tables_insert" ON restaurant_tables;
CREATE POLICY "tables_insert"
ON restaurant_tables FOR INSERT
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

DROP POLICY IF EXISTS "tables_update" ON restaurant_tables;
CREATE POLICY "tables_update"
ON restaurant_tables FOR UPDATE
USING (restaurant_id = current_restaurant_id() OR is_super_admin())
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

DROP POLICY IF EXISTS "tables_delete" ON restaurant_tables;
CREATE POLICY "tables_delete"
ON restaurant_tables FOR DELETE
USING (is_super_admin());

-- 6. Secure verification function for customer QR detection
CREATE OR REPLACE FUNCTION verify_table_qr_token(p_slug TEXT, p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id UUID;
  v_restaurant_active BOOLEAN;
  v_table RECORD;
BEGIN
  -- 1. Find restaurant by slug
  SELECT id, is_active INTO v_restaurant_id, v_restaurant_active
  FROM restaurants
  WHERE slug = p_slug;

  IF v_restaurant_id IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Restaurant not found');
  END IF;

  IF NOT v_restaurant_active THEN
    RETURN json_build_object('valid', false, 'error', 'Restaurant is currently inactive');
  END IF;

  -- 2. Find active table by qr_token and restaurant_id
  SELECT id, table_number, capacity, is_active, deleted_at
  INTO v_table
  FROM restaurant_tables
  WHERE restaurant_id = v_restaurant_id
    AND qr_token = p_token;

  IF v_table.id IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid table QR token');
  END IF;

  IF v_table.deleted_at IS NOT NULL THEN
    RETURN json_build_object('valid', false, 'error', 'This table is no longer active');
  END IF;

  IF NOT v_table.is_active THEN
    RETURN json_build_object('valid', false, 'error', 'This table is temporarily closed');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'table', json_build_object(
      'id', v_table.id,
      'table_number', v_table.table_number,
      'capacity', v_table.capacity
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_table_qr_token(TEXT, TEXT) TO anon, authenticated;

-- 7. Helper function to regenerate QR token
CREATE OR REPLACE FUNCTION regenerate_table_qr_token(p_table_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  v_new_token := encode(gen_random_bytes(16), 'hex');

  UPDATE restaurant_tables
  SET qr_token = v_new_token, updated_at = NOW()
  WHERE id = p_table_id;

  RETURN v_new_token;
END;
$$;

GRANT EXECUTE ON FUNCTION regenerate_table_qr_token(UUID) TO authenticated;
