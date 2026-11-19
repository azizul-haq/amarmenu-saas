-- ==============================================================================
-- AmarMenu Migration: Chunk 22c Privilege Hardening & Column-Level Security
-- Version: 20261119000070_chunk22c_privilege_hardening.sql
-- Description:
-- 1. Orders, Payments, Order Items, Cash Shifts write lockdown:
--    REVOKE INSERT, UPDATE, DELETE, TRUNCATE from authenticated, anon, PUBLIC.
--    All money mutations, bill settlements, voids, transitions MUST occur via RPCs.
-- 2. Restaurant Staff column-level security:
--    REVOKE ALL on restaurant_staff from authenticated, anon, PUBLIC.
--    GRANT SELECT on safe operational columns only:
--      (id, auth_user_id, restaurant_id, full_name, phone, email, role, is_active, created_at, updated_at)
--    manager_pin_hash, failed_pin_attempts, pin_locked_until are strictly hidden.
-- 3. Retarget policies on restaurant_staff to authenticated.
-- ==============================================================================

-- 1. Orders, Payments, Order Items, Cash Shifts write lockdown
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payments FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_items FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cash_shifts FROM authenticated, anon, PUBLIC;

-- Ensure SELECT remains permitted for authenticated
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.order_items TO authenticated;
GRANT SELECT ON public.cash_shifts TO authenticated;

-- Ensure anon has NO permissions on orders, payments, order_items, cash_shifts
REVOKE ALL ON public.orders FROM anon;
REVOKE ALL ON public.payments FROM anon;
REVOKE ALL ON public.order_items FROM anon;
REVOKE ALL ON public.cash_shifts FROM anon;

-- 2. Restaurant Staff Column-Level Security & Write Lockdown
REVOKE ALL ON public.restaurant_staff FROM authenticated, anon, PUBLIC;

-- Column-level SELECT for safe operational columns required by AuthContext, policies, and UI
GRANT SELECT (
  id,
  auth_user_id,
  restaurant_id,
  full_name,
  phone,
  email,
  role,
  is_active,
  created_at,
  updated_at
) ON public.restaurant_staff TO authenticated;

-- 3. Retarget policies on restaurant_staff to authenticated
DROP POLICY IF EXISTS "staff_insert_own_restaurant" ON public.restaurant_staff;
DROP POLICY IF EXISTS "staff_update_own_restaurant" ON public.restaurant_staff;
DROP POLICY IF EXISTS "staff_delete_own_restaurant" ON public.restaurant_staff;
DROP POLICY IF EXISTS "staff_read_own_restaurant" ON public.restaurant_staff;

CREATE POLICY "staff_read_own_restaurant"
  ON public.restaurant_staff
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

CREATE POLICY "staff_insert_own_restaurant"
  ON public.restaurant_staff
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      restaurant_id = current_restaurant_id()
      AND EXISTS (
        SELECT 1 FROM restaurant_staff s
        WHERE s.auth_user_id = auth.uid()
          AND s.restaurant_id = restaurant_staff.restaurant_id
          AND s.role = 'owner'
          AND s.is_active = true
      )
    )
    OR is_super_admin()
  );

CREATE POLICY "staff_update_own_restaurant"
  ON public.restaurant_staff
  FOR UPDATE
  TO authenticated
  USING (
    (
      restaurant_id = current_restaurant_id()
      AND EXISTS (
        SELECT 1 FROM restaurant_staff s
        WHERE s.auth_user_id = auth.uid()
          AND s.restaurant_id = restaurant_staff.restaurant_id
          AND s.role = 'owner'
          AND s.is_active = true
      )
    )
    OR auth_user_id = auth.uid()
    OR is_super_admin()
  )
  WITH CHECK (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

CREATE POLICY "staff_delete_own_restaurant"
  ON public.restaurant_staff
  FOR DELETE
  TO authenticated
  USING (
    (
      restaurant_id = current_restaurant_id()
      AND EXISTS (
        SELECT 1 FROM restaurant_staff s
        WHERE s.auth_user_id = auth.uid()
          AND s.restaurant_id = restaurant_staff.restaurant_id
          AND s.role = 'owner'
          AND s.is_active = true
      )
    )
    OR is_super_admin()
  );
