-- ==============================================================================
-- AmarMenu Migration: Fix soft-delete RLS policies for menu_items & menu_categories
-- Version: 20261117000024_fix_soft_delete_policies.sql
-- ==============================================================================

-- 1. Fix menu_items_select:
-- Staff and super admins can view all items belonging to their restaurant
-- (allowing UPDATE ... RETURNING when setting deleted_at).
-- Public/anon users can only view non-deleted, available items of active restaurants.
DROP POLICY IF EXISTS "menu_items_select" ON menu_items;
CREATE POLICY "menu_items_select"
ON menu_items FOR SELECT
USING (
  restaurant_id = current_restaurant_id()
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

-- 2. Fix categories_read:
-- Staff and super admins can view all categories belonging to their restaurant.
-- Public/anon users can only view non-deleted categories of active restaurants.
DROP POLICY IF EXISTS "categories_read" ON menu_categories;
CREATE POLICY "categories_read"
ON menu_categories FOR SELECT
USING (
  restaurant_id = current_restaurant_id()
  OR is_super_admin()
  OR (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = menu_categories.restaurant_id AND r.is_active = true
    )
  )
);
