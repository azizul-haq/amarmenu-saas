-- Migration 20261124000088: Drop legacy place_order overload
-- Fixes "Could not choose the best candidate function between: public.place_order(...)"

-- 1. Drop the legacy 10-parameter place_order overload
DROP FUNCTION IF EXISTS public.place_order(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  numeric,
  numeric
);

-- 2. Ensure execution privileges on the remaining 11-parameter place_order function
GRANT EXECUTE ON FUNCTION public.place_order(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  numeric,
  numeric,
  uuid
) TO anon, authenticated, service_role;

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
