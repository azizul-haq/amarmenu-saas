-- ============================================================================
-- Migration: 20261117000007_tenant_rls.sql
-- Description: Tenant-Scoped Row Level Security (RLS) & Admin RPC Revocation
-- ============================================================================

-- 1. Helper function: Get current user's restaurant_id
CREATE OR REPLACE FUNCTION current_restaurant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id
  FROM restaurant_staff
  WHERE auth_user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

-- 2. Helper function: Check if current user is a super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_admins
    WHERE auth_user_id = auth.uid()
      AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION current_restaurant_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, anon;

-- 3. Drop all legacy blanket policies
DROP POLICY IF EXISTS "Allow public select on restaurants" ON restaurants;
DROP POLICY IF EXISTS "Allow public update on restaurants" ON restaurants;
DROP POLICY IF EXISTS "Allow public insert on restaurants" ON restaurants;

DROP POLICY IF EXISTS "Allow public select on restaurant_staff" ON restaurant_staff;
DROP POLICY IF EXISTS "Allow public modify on restaurant_staff" ON restaurant_staff;

DROP POLICY IF EXISTS "Allow public select on platform_admins" ON platform_admins;

DROP POLICY IF EXISTS "Allow public all on menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "Allow public all on menu_items" ON menu_items;
DROP POLICY IF EXISTS "Allow public all on orders" ON orders;

DROP POLICY IF EXISTS "Allow public select on subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Allow public modify on subscriptions" ON subscriptions;

DROP POLICY IF EXISTS "Allow public insert on registration_requests" ON registration_requests;
DROP POLICY IF EXISTS "Allow public select on registration_requests" ON registration_requests;
DROP POLICY IF EXISTS "Allow public update on registration_requests" ON registration_requests;

DROP POLICY IF EXISTS "Allow read on users" ON users;

-- ============================================================================
-- 4. RESTAURANTS Policies
-- ============================================================================
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

-- Anyone can view active restaurants (for public storefront & customer ordering)
CREATE POLICY "restaurants_public_read_active"
ON restaurants FOR SELECT
USING (is_active = true OR is_super_admin() OR id = current_restaurant_id());

-- Restaurant owners/staff can update their own restaurant profile
CREATE POLICY "restaurants_staff_update_own"
ON restaurants FOR UPDATE
USING (id = current_restaurant_id() OR is_super_admin())
WITH CHECK (id = current_restaurant_id() OR is_super_admin());

-- Only super admins can insert or delete restaurants
CREATE POLICY "restaurants_admin_insert"
ON restaurants FOR INSERT
WITH CHECK (is_super_admin());

CREATE POLICY "restaurants_admin_delete"
ON restaurants FOR DELETE
USING (is_super_admin());

-- ============================================================================
-- 5. RESTAURANT_STAFF Policies
-- ============================================================================
ALTER TABLE restaurant_staff ENABLE ROW LEVEL SECURITY;

-- Staff can view other staff in their restaurant; Super admins can view all
CREATE POLICY "staff_read_own_restaurant"
ON restaurant_staff FOR SELECT
USING (
  restaurant_id = current_restaurant_id() 
  OR auth_user_id = auth.uid()
  OR is_super_admin()
);

-- Owners and managers can invite or manage staff in their restaurant; Super admins can manage all
CREATE POLICY "staff_insert_own_restaurant"
ON restaurant_staff FOR INSERT
WITH CHECK (
  (restaurant_id = current_restaurant_id() AND EXISTS (
    SELECT 1 FROM restaurant_staff s 
    WHERE s.auth_user_id = auth.uid() 
      AND s.restaurant_id = restaurant_staff.restaurant_id 
      AND s.role IN ('owner', 'manager')
      AND s.is_active = true
  ))
  OR is_super_admin()
);

CREATE POLICY "staff_update_own_restaurant"
ON restaurant_staff FOR UPDATE
USING (
  (restaurant_id = current_restaurant_id() AND EXISTS (
    SELECT 1 FROM restaurant_staff s 
    WHERE s.auth_user_id = auth.uid() 
      AND s.restaurant_id = restaurant_staff.restaurant_id 
      AND s.role IN ('owner', 'manager')
      AND s.is_active = true
  ))
  OR auth_user_id = auth.uid()
  OR is_super_admin()
)
WITH CHECK (
  (restaurant_id = current_restaurant_id()) OR is_super_admin()
);

CREATE POLICY "staff_delete_own_restaurant"
ON restaurant_staff FOR DELETE
USING (
  (restaurant_id = current_restaurant_id() AND EXISTS (
    SELECT 1 FROM restaurant_staff s 
    WHERE s.auth_user_id = auth.uid() 
      AND s.restaurant_id = restaurant_staff.restaurant_id 
      AND s.role = 'owner'
      AND s.is_active = true
  ))
  OR is_super_admin()
);

-- ============================================================================
-- 6. PLATFORM_ADMINS Policies
-- ============================================================================
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admins_read"
ON platform_admins FOR SELECT
USING (auth_user_id = auth.uid() OR is_super_admin());

CREATE POLICY "platform_admins_all"
ON platform_admins FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- ============================================================================
-- 7. MENU_CATEGORIES Policies
-- ============================================================================
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;

-- Customers can view active categories of active restaurants; Staff can view all in their restaurant
CREATE POLICY "categories_read"
ON menu_categories FOR SELECT
USING (
  restaurant_id = current_restaurant_id()
  OR is_super_admin()
  OR EXISTS (
    SELECT 1 FROM restaurants r
    WHERE r.id = menu_categories.restaurant_id AND r.is_active = true
  )
);

-- Staff can create, update, delete categories only in their own restaurant
CREATE POLICY "categories_insert_own"
ON menu_categories FOR INSERT
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY "categories_update_own"
ON menu_categories FOR UPDATE
USING (restaurant_id = current_restaurant_id() OR is_super_admin())
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY "categories_delete_own"
ON menu_categories FOR DELETE
USING (restaurant_id = current_restaurant_id() OR is_super_admin());

-- ============================================================================
-- 8. MENU_ITEMS Policies
-- ============================================================================
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- Customers can view available menu items for active restaurants; Staff can view all items in their restaurant
CREATE POLICY "menu_items_read"
ON menu_items FOR SELECT
USING (
  restaurant_id = current_restaurant_id()
  OR is_super_admin()
  OR (
    is_available = true 
    AND EXISTS (
      SELECT 1 FROM restaurants r
      WHERE r.id = menu_items.restaurant_id AND r.is_active = true
    )
  )
);

-- Staff can create, update, delete menu items only in their own restaurant
CREATE POLICY "menu_items_insert_own"
ON menu_items FOR INSERT
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY "menu_items_update_own"
ON menu_items FOR UPDATE
USING (restaurant_id = current_restaurant_id() OR is_super_admin())
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY "menu_items_delete_own"
ON menu_items FOR DELETE
USING (restaurant_id = current_restaurant_id() OR is_super_admin());

-- ============================================================================
-- 9. ORDERS Policies
-- ============================================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Staff can view orders only for their restaurant; Super admins can view all
CREATE POLICY "orders_read_staff"
ON orders FOR SELECT
USING (restaurant_id = current_restaurant_id() OR is_super_admin());

-- Customers (anon or authenticated) can place orders
CREATE POLICY "orders_customer_insert"
ON orders FOR INSERT
WITH CHECK (
  restaurant_id IS NOT NULL 
  AND EXISTS (
    SELECT 1 FROM restaurants r 
    WHERE r.id = orders.restaurant_id AND r.is_active = true
  )
);

-- Staff can update order status for their restaurant; Customers cannot alter placed orders
CREATE POLICY "orders_staff_update"
ON orders FOR UPDATE
USING (restaurant_id = current_restaurant_id() OR is_super_admin())
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

-- Deleting orders is restricted to super admins
CREATE POLICY "orders_delete_admin"
ON orders FOR DELETE
USING (is_super_admin());

-- ============================================================================
-- 10. SUBSCRIPTIONS Policies
-- ============================================================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Staff can view their own restaurant's subscription; Super admins can view all
CREATE POLICY "subscriptions_read"
ON subscriptions FOR SELECT
USING (restaurant_id = current_restaurant_id() OR is_super_admin());

-- Only super admins can insert, update, or delete subscriptions
CREATE POLICY "subscriptions_admin_manage"
ON subscriptions FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- ============================================================================
-- 11. REGISTRATION_REQUESTS Policies
-- ============================================================================
ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can submit a registration request
CREATE POLICY "registration_requests_insert_public"
ON registration_requests FOR INSERT
WITH CHECK (true);

-- Super admins can view, update, and manage all requests
CREATE POLICY "registration_requests_admin_all"
ON registration_requests FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Public can check pending status
CREATE POLICY "registration_requests_status_check"
ON registration_requests FOR SELECT
USING (status = 'pending');

-- ============================================================================
-- 12. NOTIFICATIONS Policies
-- ============================================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_read_staff"
ON notifications FOR SELECT
USING (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY "notifications_update_staff"
ON notifications FOR UPDATE
USING (restaurant_id = current_restaurant_id() OR is_super_admin())
WITH CHECK (restaurant_id = current_restaurant_id() OR is_super_admin());

CREATE POLICY "notifications_insert_all"
ON notifications FOR INSERT
WITH CHECK (restaurant_id IS NOT NULL);

-- ============================================================================
-- 13. USERS (Legacy table) Lockdown
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_super_admin_only"
ON users FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- ============================================================================
-- 14. Drop obsolete login RPCs & Secure admin functions
-- ============================================================================
DROP FUNCTION IF EXISTS admin_login(TEXT, TEXT);
DROP FUNCTION IF EXISTS restaurant_login(TEXT, TEXT);

-- Drop existing admin functions before recreating with security checks
DROP FUNCTION IF EXISTS admin_create_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS admin_toggle_restaurant_status(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS admin_reject_request(UUID, TEXT);

CREATE OR REPLACE FUNCTION admin_create_restaurant(
  p_request_id UUID,
  p_restaurant_name TEXT,
  p_slug TEXT,
  p_owner_name TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_city TEXT,
  p_address TEXT DEFAULT NULL,
  p_subscription_plan TEXT DEFAULT 'free_trial',
  p_password_hash TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  restaurant_id UUID,
  user_id UUID,
  success BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id UUID;
  v_user_id UUID;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  INSERT INTO restaurants (
    name,
    slug,
    phone,
    email,
    city,
    address,
    subscription_plan,
    is_active
  ) VALUES (
    p_restaurant_name,
    p_slug,
    p_phone,
    p_email,
    p_city,
    p_address,
    p_subscription_plan,
    true
  )
  RETURNING id INTO v_restaurant_id;

  INSERT INTO users (
    restaurant_id,
    email,
    password_hash,
    role,
    full_name
  ) VALUES (
    v_restaurant_id,
    p_email,
    p_password_hash,
    'owner',
    p_owner_name
  )
  RETURNING id INTO v_user_id;

  UPDATE registration_requests
  SET
    status = 'approved',
    reviewed_at = NOW(),
    internal_notes = p_internal_notes
  WHERE id = p_request_id;

  RETURN QUERY SELECT v_restaurant_id, v_user_id, true;
END;
$$;

CREATE OR REPLACE FUNCTION admin_toggle_restaurant_status(
  p_restaurant_id UUID,
  p_is_active BOOLEAN,
  p_block_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  UPDATE restaurants
  SET is_active = p_is_active
  WHERE id = p_restaurant_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION admin_reject_request(
  p_request_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  UPDATE registration_requests
  SET
    status = 'rejected',
    reviewed_at = NOW(),
    rejection_reason = p_reason
  WHERE id = p_request_id;

  RETURN true;
END;
$$;

-- Revoke execute from anon and PUBLIC on admin functions
REVOKE EXECUTE ON FUNCTION admin_create_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION admin_reject_request(UUID, TEXT) FROM PUBLIC, anon;

-- Grant execute to authenticated users (internal checks will enforce super_admin)
GRANT EXECUTE ON FUNCTION admin_create_restaurant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_toggle_restaurant_status(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_request(UUID, TEXT) TO authenticated;
