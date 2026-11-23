-- Migration 20261123000086: Fix permissions on restaurants table & add update_restaurant_logo RPC
-- Resolves "permission denied for table restaurants" error for owners and managers

-- 1. Table-level privileges for authenticated and anon roles
GRANT SELECT, UPDATE ON public.restaurants TO authenticated;
GRANT SELECT ON public.restaurants TO anon;

-- 2. Ensure RLS UPDATE policy on public.restaurants allows owner/manager and super_admin
DROP POLICY IF EXISTS restaurants_staff_update_own ON public.restaurants;
CREATE POLICY restaurants_staff_update_own ON public.restaurants
  FOR UPDATE
  TO authenticated
  USING (
    is_super_admin()
    OR id = current_restaurant_id()
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = public.restaurants.id
        AND role IN ('owner', 'manager')
        AND is_active = true
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      (id = current_restaurant_id() AND has_permission(id, 'change_settings'::text))
      OR EXISTS (
        SELECT 1 FROM public.restaurant_staff
        WHERE auth_user_id = auth.uid()
          AND restaurant_id = public.restaurants.id
          AND role IN ('owner', 'manager')
          AND is_active = true
      )
    )
  );

-- 3. Dedicated SECURITY DEFINER RPC for updating or removing restaurant logo
CREATE OR REPLACE FUNCTION public.update_restaurant_logo(
  p_restaurant_id UUID,
  p_logo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_is_authorized BOOLEAN;
  v_cleaned_url TEXT;
  v_restaurant RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT is_super_admin() INTO v_is_super;

  -- Verify caller is active owner, manager, or super_admin for this restaurant
  IF NOT COALESCE(v_is_super, FALSE) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.restaurant_staff
      WHERE auth_user_id = v_caller_id
        AND restaurant_id = p_restaurant_id
        AND role IN ('owner', 'manager')
        AND is_active = true
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RAISE EXCEPTION 'Unauthorized: only owners or managers can update the restaurant logo' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_cleaned_url := NULLIF(trim(p_logo_url), '');

  UPDATE public.restaurants
  SET
    logo_url = v_cleaned_url,
    updated_at = NOW()
  WHERE id = p_restaurant_id
  RETURNING id, name, slug, logo_url INTO v_restaurant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0002';
  END IF;

  -- Optional audit log in staff_activity_logs
  BEGIN
    INSERT INTO public.staff_activity_logs (
      restaurant_id,
      actor_user_id,
      actor_name,
      actor_role,
      action,
      entity_type,
      entity_id,
      summary,
      metadata
    )
    SELECT
      p_restaurant_id,
      v_caller_id,
      COALESCE(rs.full_name, 'Staff Member'),
      COALESCE(rs.role, 'manager'),
      CASE WHEN v_cleaned_url IS NOT NULL THEN 'restaurant_logo_updated' ELSE 'restaurant_logo_removed' END,
      'restaurant',
      p_restaurant_id,
      CASE WHEN v_cleaned_url IS NOT NULL THEN 'Updated restaurant official logo' ELSE 'Removed restaurant logo' END,
      jsonb_build_object('logo_url', v_cleaned_url)
    FROM public.restaurant_staff rs
    WHERE rs.auth_user_id = v_caller_id AND rs.restaurant_id = p_restaurant_id
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    -- Suppress logging failure so logo update always succeeds
  END;

  RETURN jsonb_build_object(
    'success', true,
    'restaurant_id', v_restaurant.id,
    'logo_url', v_restaurant.logo_url
  );
END;
$function$;

-- 4. Grant execution permissions
GRANT EXECUTE ON FUNCTION public.update_restaurant_logo(UUID, TEXT) TO authenticated, service_role;
