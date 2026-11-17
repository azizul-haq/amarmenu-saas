-- =====================================================
-- FIX RLS POLICIES FOR FOOD ORDERING SAAS
-- Run this ONCE in Supabase SQL Editor
-- =====================================================

-- 1. Drop existing conflicting policies
DROP POLICY IF EXISTS "Public can view available menu items" ON menu_items;
DROP POLICY IF EXISTS "Public can view active restaurants" ON restaurants;
DROP POLICY IF EXISTS "Public can create orders" ON orders;
DROP POLICY IF EXISTS "Restaurant owners can view their restaurant" ON restaurants;
DROP POLICY IF EXISTS "Restaurant owners can update their restaurant" ON restaurants;
DROP POLICY IF EXISTS "Restaurant owners can manage menu" ON menu_items;
DROP POLICY IF EXISTS "Restaurant owners can manage orders" ON orders;
DROP POLICY IF EXISTS "Allow public read on registration_requests" ON registration_requests;
DROP POLICY IF EXISTS "Allow public insert on registration_requests" ON registration_requests;
DROP POLICY IF EXISTS "Allow public select on registration_requests" ON registration_requests;
DROP POLICY IF EXISTS "Allow public update on registration_requests" ON registration_requests;
DROP POLICY IF EXISTS "Allow public read on restaurants" ON restaurants;
DROP POLICY IF EXISTS "Allow public select on restaurants" ON restaurants;
DROP POLICY IF EXISTS "Allow public update on restaurants" ON restaurants;
DROP POLICY IF EXISTS "Allow public insert on restaurants" ON restaurants;
DROP POLICY IF EXISTS "Allow public all on menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "Allow public read on menu_items" ON menu_items;
DROP POLICY IF EXISTS "Allow public all on menu_items" ON menu_items;
DROP POLICY IF EXISTS "Allow public insert on orders" ON orders;
DROP POLICY IF EXISTS "Allow public read on orders" ON orders;
DROP POLICY IF EXISTS "Allow public all on orders" ON orders;
DROP POLICY IF EXISTS "Allow read on users" ON users;

-- 2. Registration Requests policies
CREATE POLICY "Allow public insert on registration_requests"
  ON registration_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public select on registration_requests"
  ON registration_requests FOR SELECT
  USING (true);

CREATE POLICY "Allow public update on registration_requests"
  ON registration_requests FOR UPDATE
  USING (true);

-- 3. Restaurants policies
CREATE POLICY "Allow public select on restaurants"
  ON restaurants FOR SELECT
  USING (true);

CREATE POLICY "Allow public update on restaurants"
  ON restaurants FOR UPDATE
  USING (true);

CREATE POLICY "Allow public insert on restaurants"
  ON restaurants FOR INSERT
  WITH CHECK (true);

-- 4. Menu Categories policies
CREATE POLICY "Allow public all on menu_categories"
  ON menu_categories FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Menu Items policies
CREATE POLICY "Allow public all on menu_items"
  ON menu_items FOR ALL
  USING (true)
  WITH CHECK (true);

-- 6. Orders policies
CREATE POLICY "Allow public all on orders"
  ON orders FOR ALL
  USING (true)
  WITH CHECK (true);

-- 7. Users policies
CREATE POLICY "Allow read on users"
  ON users FOR SELECT
  USING (true);
