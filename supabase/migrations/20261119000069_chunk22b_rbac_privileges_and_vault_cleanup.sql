-- ==============================================================================
-- AmarMenu Migration: Chunk 22b - RBAC Privileges, Vault Cleanup & Role Enforcement
-- Migration: 20261119000069_chunk22b_rbac_privileges_and_vault_cleanup.sql
-- ==============================================================================

-- 1. DROP diagnostic helper functions returning secrets
DROP FUNCTION IF EXISTS public.get_vault_secrets();

-- 2. REVOKE TRUNCATE and TRIGGER from PUBLIC, anon, and authenticated on all public tables
REVOKE TRUNCATE, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Configure ALTER DEFAULT PRIVILEGES for future tables created by postgres in schema public
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

-- 3. Harden and Split Restaurants Policies
DROP POLICY IF EXISTS restaurants_public_read_active ON public.restaurants;
DROP POLICY IF EXISTS restaurants_staff_read_own ON public.restaurants;
DROP POLICY IF EXISTS restaurants_staff_update_own ON public.restaurants;
DROP POLICY IF EXISTS restaurants_admin_insert ON public.restaurants;
DROP POLICY IF EXISTS restaurants_admin_delete ON public.restaurants;
DROP POLICY IF EXISTS restaurants_anon_read_active ON public.restaurants;
DROP POLICY IF EXISTS restaurants_authenticated_read ON public.restaurants;

-- Anon read: strictly active restaurants
CREATE POLICY restaurants_anon_read_active ON public.restaurants
  FOR SELECT TO anon
  USING (is_active = true);

-- Authenticated read: active restaurants, OR super admin, OR staff of that restaurant
CREATE POLICY restaurants_authenticated_read ON public.restaurants
  FOR SELECT TO authenticated
  USING (is_active = true OR is_super_admin() OR id = current_restaurant_id());

-- Authenticated update: USING checks tenant boundary, WITH CHECK strictly enforces change_settings (42501 on failure)
CREATE POLICY restaurants_staff_update_own ON public.restaurants
  FOR UPDATE TO authenticated
  USING (
    id = current_restaurant_id() OR is_super_admin()
  )
  WITH CHECK (
    (id = current_restaurant_id() AND has_permission(id, 'change_settings'))
    OR is_super_admin()
  );

-- Super admin only for insert & delete
CREATE POLICY restaurants_admin_insert ON public.restaurants
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin());

CREATE POLICY restaurants_admin_delete ON public.restaurants
  FOR DELETE TO authenticated
  USING (is_super_admin());

-- 4. Harden and Retarget Restaurant Tables Policies
DROP POLICY IF EXISTS tables_insert ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_update ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_delete ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_select ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_select_authenticated ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_insert_authenticated ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_update_authenticated ON public.restaurant_tables;
DROP POLICY IF EXISTS tables_delete_authenticated ON public.restaurant_tables;

CREATE POLICY tables_select_authenticated ON public.restaurant_tables
  FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY tables_insert_authenticated ON public.restaurant_tables
  FOR INSERT TO authenticated
  WITH CHECK (
    (restaurant_id = current_restaurant_id() AND has_permission(restaurant_id, 'change_settings'))
    OR is_super_admin()
  );

CREATE POLICY tables_update_authenticated ON public.restaurant_tables
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = current_restaurant_id() OR is_super_admin()
  )
  WITH CHECK (
    (restaurant_id = current_restaurant_id() AND has_permission(restaurant_id, 'change_settings'))
    OR is_super_admin()
  );

CREATE POLICY tables_delete_authenticated ON public.restaurant_tables
  FOR DELETE TO authenticated
  USING (
    restaurant_id = current_restaurant_id() OR is_super_admin()
  );

-- Trigger to guarantee 42501 on unauthorized table DELETE attempts
CREATE OR REPLACE FUNCTION public.enforce_table_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF session_user = 'postgres' AND (current_setting('role', true) IS NULL OR current_setting('role', true) = 'none') THEN
    RETURN OLD;
  END IF;
  IF current_setting('role', true) = 'service_role' OR is_super_admin() THEN
    RETURN OLD;
  END IF;

  IF NOT has_permission(OLD.restaurant_id, 'change_settings') THEN
    RAISE EXCEPTION 'Permission denied: Your role cannot delete tables' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_table_permissions ON public.restaurant_tables;
CREATE TRIGGER trg_enforce_table_permissions
BEFORE DELETE ON public.restaurant_tables
FOR EACH ROW EXECUTE FUNCTION public.enforce_table_permissions();

-- 5. Harden and Retarget Menu Categories Policies
DROP POLICY IF EXISTS categories_insert_own ON public.menu_categories;
DROP POLICY IF EXISTS categories_update_own ON public.menu_categories;
DROP POLICY IF EXISTS categories_delete_own ON public.menu_categories;
DROP POLICY IF EXISTS categories_insert_authenticated ON public.menu_categories;
DROP POLICY IF EXISTS categories_update_authenticated ON public.menu_categories;
DROP POLICY IF EXISTS categories_delete_authenticated ON public.menu_categories;

CREATE POLICY categories_insert_authenticated ON public.menu_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    (restaurant_id = current_restaurant_id() AND has_permission(restaurant_id, 'edit_menu'))
    OR is_super_admin()
  );

CREATE POLICY categories_update_authenticated ON public.menu_categories
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = current_restaurant_id() OR is_super_admin()
  )
  WITH CHECK (
    (restaurant_id = current_restaurant_id() AND has_permission(restaurant_id, 'edit_menu'))
    OR is_super_admin()
  );

CREATE POLICY categories_delete_authenticated ON public.menu_categories
  FOR DELETE TO authenticated
  USING (
    restaurant_id = current_restaurant_id() OR is_super_admin()
  );

-- Trigger to guarantee 42501 on unauthorized category DELETE attempts
CREATE OR REPLACE FUNCTION public.enforce_category_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF session_user = 'postgres' AND (current_setting('role', true) IS NULL OR current_setting('role', true) = 'none') THEN
    RETURN OLD;
  END IF;
  IF current_setting('role', true) = 'service_role' OR is_super_admin() THEN
    RETURN OLD;
  END IF;

  IF NOT has_permission(OLD.restaurant_id, 'delete_menu') THEN
    RAISE EXCEPTION 'Permission denied: Only restaurant owner can delete categories' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_category_permissions ON public.menu_categories;
CREATE TRIGGER trg_enforce_category_permissions
BEFORE DELETE ON public.menu_categories
FOR EACH ROW EXECUTE FUNCTION public.enforce_category_permissions();

-- 6. Harden and Retarget Menu Items Policies
DROP POLICY IF EXISTS menu_items_insert ON public.menu_items;
DROP POLICY IF EXISTS menu_items_update ON public.menu_items;
DROP POLICY IF EXISTS menu_items_delete ON public.menu_items;
DROP POLICY IF EXISTS menu_items_insert_authenticated ON public.menu_items;
DROP POLICY IF EXISTS menu_items_update_authenticated ON public.menu_items;
DROP POLICY IF EXISTS menu_items_delete_authenticated ON public.menu_items;

CREATE POLICY menu_items_insert_authenticated ON public.menu_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (restaurant_id = current_restaurant_id() AND has_permission(restaurant_id, 'edit_menu'))
    OR is_super_admin()
  );

CREATE POLICY menu_items_update_authenticated ON public.menu_items
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = current_restaurant_id() OR is_super_admin()
  )
  WITH CHECK (
    (restaurant_id = current_restaurant_id() AND (
      has_permission(restaurant_id, 'edit_menu') OR has_permission(restaurant_id, 'toggle_availability')
    ))
    OR is_super_admin()
  );

CREATE POLICY menu_items_delete_authenticated ON public.menu_items
  FOR DELETE TO authenticated
  USING (
    restaurant_id = current_restaurant_id() OR is_super_admin()
  );

-- 7. Column-specific Trigger on menu_items for granular availability & soft-delete rules
CREATE OR REPLACE FUNCTION public.enforce_menu_item_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Direct pg admin connection bypass (migrations, seeds)
  IF session_user = 'postgres' AND (current_setting('role', true) IS NULL OR current_setting('role', true) = 'none') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Service role bypass for Edge Functions / backend operations
  IF current_setting('role', true) = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Super admin bypass
  IF is_super_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 1. INSERT: requires edit_menu
  IF TG_OP = 'INSERT' THEN
    IF NOT has_permission(NEW.restaurant_id, 'edit_menu') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot add menu items' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 2. UPDATE:
  IF TG_OP = 'UPDATE' THEN
    -- Soft-delete: OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      IF NOT has_permission(NEW.restaurant_id, 'delete_menu') THEN
        RAISE EXCEPTION 'Permission denied: Only restaurant owner can delete menu items' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;

    -- Availability-only update: compare to_jsonb(NEW) vs to_jsonb(OLD) excluding is_available and updated_at
    IF (to_jsonb(NEW) - 'is_available' - 'updated_at') = (to_jsonb(OLD) - 'is_available' - 'updated_at') THEN
      IF NOT has_permission(NEW.restaurant_id, 'toggle_availability') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot toggle item availability' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;

    -- General edit (prices, names, sizes, addons, description, etc.): requires edit_menu
    IF NOT has_permission(NEW.restaurant_id, 'edit_menu') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot modify menu items' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- 3. Hard DELETE: requires delete_menu
  IF TG_OP = 'DELETE' THEN
    IF NOT has_permission(OLD.restaurant_id, 'delete_menu') THEN
      RAISE EXCEPTION 'Permission denied: Only restaurant owner can delete menu items' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_menu_item_permissions ON public.menu_items;
CREATE TRIGGER trg_enforce_menu_item_permissions
BEFORE INSERT OR UPDATE OR DELETE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_menu_item_permissions();
