-- ==============================================================================
-- AmarMenu Migration: Inspect and enforce clean menu_items policies
-- Version: 20261117000022_clean_menu_policies.sql
-- ==============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'menu_items'
  ) LOOP
    EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON menu_items';
  END LOOP;
END $$;

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- 1. SELECT: Only active, non-deleted items for active restaurants, or staff/admin
CREATE POLICY "menu_items_select"
ON menu_items FOR SELECT
USING (
  (restaurant_id = current_restaurant_id() AND deleted_at IS NULL)
  OR is_super_admin()
  OR (
    deleted_at IS NULL 
    AND is_available = true 
    AND EXISTS (
      SELECT 1 FROM restaurants r 
      WHERE r.id = menu_items.restaurant_id AND r.is_active = true
    )
  )
);

-- 2. INSERT: Staff for own restaurant or super admin
CREATE POLICY "menu_items_insert"
ON menu_items FOR INSERT
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

-- 3. UPDATE: Staff for own restaurant or super admin
CREATE POLICY "menu_items_update"
ON menu_items FOR UPDATE
USING (restaurant_id = current_restaurant_id() OR is_super_admin())
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

-- 4. DELETE: Super admin only (soft-delete via UPDATE is used by staff)
CREATE POLICY "menu_items_delete"
ON menu_items FOR DELETE
USING (is_super_admin());
