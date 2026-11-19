-- ==============================================================================
-- Migration: 20261118000060_chunk20d_privilege_gaps.sql
-- Description:
-- 1. ALTER DEFAULT PRIVILEGES so future tables in public do not grant to anon
-- 2. Restrict 'authenticated' role to safe customer columns on restaurants
-- 3. Deploy get_my_restaurant() RPC (checks change_settings for private fields)
-- 4. Deploy admin_list_restaurants() RPC (checks is_super_admin)
-- 5. Deploy protect_restaurant_billing_fields trigger (SECURITY INVOKER)
--    protecting: id, slug, created_at, qr_code_url, subscription_plan, status, is_active, trial_ends_at
-- 6. Revoke direct write (INSERT/UPDATE/DELETE/TRUNCATE) on restaurant_staff from authenticated
-- 7. Revoke direct write on subscriptions, plans, subscription_invoices from authenticated
-- 8. Revoke SELECT from anon on all public tables except safe customer ones:
--    restaurants (safe columns), menu_items, menu_categories, plans
--    registration_requests (INSERT only)
-- 9. Drop legacy unused admin_users table (plain DROP, not CASCADE)
-- ==============================================================================

-- 1. Prevent future tables from auto-granting privileges to anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

-- 2. Restrict 'authenticated' on restaurants to safe customer columns (matches anon)
DROP POLICY IF EXISTS "Restaurant owners can view their restaurant" ON public.restaurants;
DROP POLICY IF EXISTS "Restaurant owners can update their restaurant" ON public.restaurants;
DROP POLICY IF EXISTS "Public can view active restaurants" ON public.restaurants;
REVOKE SELECT ON public.restaurants FROM authenticated;
GRANT SELECT (
  id,
  name,
  name_bn,
  slug,
  address,
  city,
  phone,
  restaurant_type,
  logo_url,
  qr_code_url,
  currency,
  currency_symbol,
  default_vat_rate,
  service_charge_rate,
  status,
  is_active,
  created_at,
  updated_at
) ON public.restaurants TO authenticated;

-- 3. Safe Stored Procedure: get_my_restaurant()
-- Derives restaurant strictly from caller's staff row via current_restaurant_id().
-- Returns full private fields only if caller has 'change_settings' permission (owner/manager).
-- Otherwise returns only safe operational columns (cashier/kitchen/waiter).
CREATE OR REPLACE FUNCTION get_my_restaurant()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_restaurant_id UUID;
  v_has_settings BOOLEAN;
  v_row RECORD;
BEGIN
  v_restaurant_id := current_restaurant_id();
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: Caller is not active staff of any restaurant' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM restaurants WHERE id = v_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0002';
  END IF;

  v_has_settings := has_permission(v_restaurant_id, 'change_settings');

  IF v_has_settings THEN
    -- Owner / Manager: full details including private billing/compliance fields
    RETURN jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'name_bn', v_row.name_bn,
      'slug', v_row.slug,
      'owner_name', v_row.owner_name,
      'phone', v_row.phone,
      'email', v_row.email,
      'city', v_row.city,
      'address', v_row.address,
      'restaurant_type', v_row.restaurant_type,
      'logo_url', v_row.logo_url,
      'qr_code_url', v_row.qr_code_url,
      'subscription_plan', v_row.subscription_plan,
      'status', v_row.status,
      'is_active', v_row.is_active,
      'trial_ends_at', v_row.trial_ends_at,
      'trade_license_no', v_row.trade_license_no,
      'vat_bin_no', v_row.vat_bin_no,
      'default_vat_rate', v_row.default_vat_rate,
      'service_charge_rate', v_row.service_charge_rate,
      'currency', v_row.currency,
      'currency_symbol', v_row.currency_symbol,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    );
  ELSE
    -- Cashier / Kitchen / Waiter: safe operational columns only
    RETURN jsonb_build_object(
      'id', v_row.id,
      'name', v_row.name,
      'name_bn', v_row.name_bn,
      'slug', v_row.slug,
      'phone', v_row.phone,
      'city', v_row.city,
      'address', v_row.address,
      'restaurant_type', v_row.restaurant_type,
      'logo_url', v_row.logo_url,
      'qr_code_url', v_row.qr_code_url,
      'status', v_row.status,
      'is_active', v_row.is_active,
      'default_vat_rate', v_row.default_vat_rate,
      'service_charge_rate', v_row.service_charge_rate,
      'currency', v_row.currency,
      'currency_symbol', v_row.currency_symbol,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION get_my_restaurant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_restaurant() TO authenticated, service_role;

-- 4. Super Admin Stored Procedure: admin_list_restaurants()
CREATE OR REPLACE FUNCTION admin_list_restaurants()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'name_bn', r.name_bn,
      'slug', r.slug,
      'owner_name', r.owner_name,
      'phone', r.phone,
      'email', r.email,
      'city', r.city,
      'address', r.address,
      'restaurant_type', r.restaurant_type,
      'logo_url', r.logo_url,
      'qr_code_url', r.qr_code_url,
      'subscription_plan', r.subscription_plan,
      'status', r.status,
      'is_active', r.is_active,
      'trial_ends_at', r.trial_ends_at,
      'trade_license_no', r.trade_license_no,
      'vat_bin_no', r.vat_bin_no,
      'default_vat_rate', r.default_vat_rate,
      'service_charge_rate', r.service_charge_rate,
      'currency', r.currency,
      'currency_symbol', r.currency_symbol,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'internal_notes', n.internal_notes,
      'block_reason', n.block_reason,
      'registration_request_id', n.registration_request_id
    ) ORDER BY r.created_at DESC
  ) INTO v_res
  FROM restaurants r
  LEFT JOIN restaurant_admin_notes n ON n.restaurant_id = r.id;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION admin_list_restaurants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_list_restaurants() TO authenticated, service_role;

-- 5. Trigger: protect_restaurant_billing_fields (SECURITY INVOKER)
-- Protects id, slug, created_at, qr_code_url, subscription_plan, status, is_active, trial_ends_at
CREATE OR REPLACE FUNCTION protect_restaurant_billing_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  -- Super admin and service_role are permitted to update all fields
  IF is_super_admin() OR current_user IN ('service_role', 'postgres') THEN
    RETURN NEW;
  END IF;

  -- Block immutable or platform-controlled fields
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Permission denied: id cannot be modified' USING ERRCODE = '42501';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Permission denied: created_at cannot be modified' USING ERRCODE = '42501';
  END IF;

  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'Permission denied: slug can only be modified by Super Admin' USING ERRCODE = '42501';
  END IF;

  IF NEW.qr_code_url IS DISTINCT FROM OLD.qr_code_url THEN
    RAISE EXCEPTION 'Permission denied: qr_code_url can only be modified by Super Admin' USING ERRCODE = '42501';
  END IF;

  IF NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan THEN
    RAISE EXCEPTION 'Permission denied: subscription_plan can only be modified by Super Admin' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Permission denied: status can only be modified by Super Admin' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Permission denied: is_active can only be modified by Super Admin' USING ERRCODE = '42501';
  END IF;

  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
    RAISE EXCEPTION 'Permission denied: trial_ends_at can only be modified by Super Admin' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_restaurant_billing_fields ON public.restaurants;
CREATE TRIGGER trg_protect_restaurant_billing_fields
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION protect_restaurant_billing_fields();

-- 6. Revoke direct write on restaurant_staff from authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.restaurant_staff FROM authenticated;
DROP POLICY IF EXISTS "staff_manage_own" ON public.restaurant_staff;
DROP POLICY IF EXISTS "Staff members can view their restaurant's staff" ON public.restaurant_staff;

-- Re-establish strict read-only policy for authenticated staff
DROP POLICY IF EXISTS "staff_read_own_restaurant" ON public.restaurant_staff;
CREATE POLICY "staff_read_own_restaurant"
  ON public.restaurant_staff FOR SELECT
  TO authenticated
  USING (restaurant_id = current_restaurant_id() OR is_super_admin());

-- 7. Revoke direct write on subscriptions, plans, subscription_invoices from authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscriptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.plans FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscription_invoices FROM authenticated;

-- 8. Blanket revoke SELECT from anon on all public tables
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;

-- Re-grant ONLY permitted public customer-facing reads:
GRANT SELECT (
  id,
  name,
  name_bn,
  slug,
  address,
  city,
  phone,
  restaurant_type,
  logo_url,
  qr_code_url,
  currency,
  currency_symbol,
  default_vat_rate,
  service_charge_rate,
  status,
  is_active,
  created_at,
  updated_at
) ON public.restaurants TO anon;

GRANT SELECT ON public.menu_items TO anon;
GRANT SELECT ON public.menu_categories TO anon;
GRANT SELECT ON public.plans TO anon;
GRANT INSERT ON public.registration_requests TO anon;

-- 9. Drop legacy unused admin_users table (plain DROP, not CASCADE)
DROP TABLE IF EXISTS public.admin_users;
