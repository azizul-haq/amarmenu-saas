-- ==============================================================================
-- AmarMenu Migration: Bilingual Menu Support & Soft Delete
-- Version: 20261117000021_bilingual_menu_soft_delete.sql
-- ==============================================================================

-- 1. Add bilingual and soft-delete columns to menu_categories
ALTER TABLE menu_categories
ADD COLUMN IF NOT EXISTS name_bn TEXT,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Add bilingual and soft-delete columns to menu_items
ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS name_bn TEXT,
ADD COLUMN IF NOT EXISTS description_bn TEXT,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Create indexes for performance on soft-delete queries
CREATE INDEX IF NOT EXISTS idx_menu_categories_rest_deleted 
ON menu_categories(restaurant_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_menu_items_rest_deleted 
ON menu_items(restaurant_id, deleted_at);

-- 4. Update RLS policies to respect soft delete
DROP POLICY IF EXISTS "categories_read" ON menu_categories;
CREATE POLICY "categories_read"
ON menu_categories FOR SELECT
USING (
  (restaurant_id = current_restaurant_id() AND deleted_at IS NULL)
  OR is_super_admin()
  OR (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = menu_categories.restaurant_id AND r.is_active = true
    )
  )
);

DROP POLICY IF EXISTS "menu_items_read" ON menu_items;
CREATE POLICY "menu_items_read"
ON menu_items FOR SELECT
USING (
  (restaurant_id = current_restaurant_id() AND deleted_at IS NULL)
  OR is_super_admin()
  OR (
    is_available = true 
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = menu_items.restaurant_id AND r.is_active = true
    )
  )
);
