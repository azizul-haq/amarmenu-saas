-- Migration 20261123000083: Custom Restaurant Logo Storage Bucket & RLS Policies

-- 1. Ensure logo_url column exists on public.restaurants
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Create public storage bucket for restaurant logos (2MB limit, PNG/JPG/WEBP)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'restaurant-logos',
  'restaurant-logos',
  TRUE,
  2097152, -- 2MB
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

-- 3. Security Helper: Validate if the authenticated caller can manage the logo for the restaurant folder
CREATE OR REPLACE FUNCTION public.can_manage_restaurant_logo(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_folder_text TEXT;
  v_restaurant_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Super admin can manage logos for all restaurants
  IF public.is_super_admin() THEN
    RETURN TRUE;
  END IF;

  -- Extract the root folder which represents the restaurant_id
  v_folder_text := split_part(p_object_name, '/', 1);
  IF v_folder_text IS NULL OR v_folder_text = '' THEN
    RETURN FALSE;
  END IF;

  -- Validate UUID format to prevent casting exceptions
  IF v_folder_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;

  v_restaurant_id := v_folder_text::uuid;

  -- Caller must be an active owner or manager of this restaurant
  RETURN EXISTS (
    SELECT 1 FROM restaurant_staff
    WHERE auth_user_id = v_caller_id
      AND restaurant_id = v_restaurant_id
      AND role IN ('owner', 'manager')
      AND is_active = TRUE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_restaurant_logo(TEXT) TO authenticated, anon;

-- 4. Storage RLS Policies for restaurant-logos bucket

-- Public Read: Anyone (including unauthenticated guests on Customer QR Menu) can view logos
DROP POLICY IF EXISTS "Public Read Restaurant Logos" ON storage.objects;
CREATE POLICY "Public Read Restaurant Logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'restaurant-logos');

-- Authenticated Insert: Owner, Manager, or Super Admin can upload to their restaurant folder
DROP POLICY IF EXISTS "Manage Restaurant Logos Insert" ON storage.objects;
CREATE POLICY "Manage Restaurant Logos Insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'restaurant-logos'
  AND public.can_manage_restaurant_logo(name)
);

-- Authenticated Update: Owner, Manager, or Super Admin can replace logo in their restaurant folder
DROP POLICY IF EXISTS "Manage Restaurant Logos Update" ON storage.objects;
CREATE POLICY "Manage Restaurant Logos Update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'restaurant-logos'
  AND public.can_manage_restaurant_logo(name)
)
WITH CHECK (
  bucket_id = 'restaurant-logos'
  AND public.can_manage_restaurant_logo(name)
);

-- Authenticated Delete: Owner, Manager, or Super Admin can remove logo in their restaurant folder
DROP POLICY IF EXISTS "Manage Restaurant Logos Delete" ON storage.objects;
CREATE POLICY "Manage Restaurant Logos Delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'restaurant-logos'
  AND public.can_manage_restaurant_logo(name)
);
