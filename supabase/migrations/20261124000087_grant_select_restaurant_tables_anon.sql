-- Migration 20261124000087: Grant SELECT on restaurant_tables to anon & authenticated, and ensure public SELECT RLS policy
-- Resolves permission denied for table restaurant_tables and infinite spinner in Customer Menu

-- 1. Grant SELECT privilege to anon and authenticated roles
GRANT SELECT ON public.restaurant_tables TO anon, authenticated;

-- 2. Grant safe execute on helper functions to anon to prevent 42501 during RLS evaluation
GRANT EXECUTE ON FUNCTION public.current_restaurant_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- 3. Ensure public SELECT policy allows guests to read active, non-deleted tables for active restaurants
DROP POLICY IF EXISTS tables_select_public ON public.restaurant_tables;
CREATE POLICY tables_select_public ON public.restaurant_tables
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND COALESCE(is_active, true) = true
    AND EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_tables.restaurant_id
        AND r.is_active = true
    )
  );
