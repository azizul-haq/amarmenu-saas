-- ==============================================================================
-- AmarMenu Migration: Chunk 22e Replay Hardening
-- Migration: 20261119000071_chunk22e_replay_hardening.sql
-- ==============================================================================

-- 1. Drop insecure legacy password setup function
DROP FUNCTION IF EXISTS public.set_initial_owner_password(TEXT, TEXT);

-- 2. Restrict authenticated UPDATE on restaurants table via column-level grants
-- Revoke table-level update from authenticated
REVOKE UPDATE ON public.restaurants FROM authenticated;

-- Grant UPDATE solely on non-billing, settings & profile columns
GRANT UPDATE (
  name,
  name_bn,
  phone,
  address,
  city,
  logo_url,
  default_vat_rate,
  service_charge_rate,
  vat_bin_no,
  trade_license_no,
  restaurant_type
) ON public.restaurants TO authenticated;

-- 3. Enable RLS on sequence tables (no policies -> service_role & security definer only)
ALTER TABLE public.restaurant_invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_order_sequences ENABLE ROW LEVEL SECURITY;

-- 4. Harden set_staff_manager_pin RPC with strict non-trivial PIN validation
CREATE OR REPLACE FUNCTION public.set_staff_manager_pin(
  p_staff_id UUID,
  p_new_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_target_staff RECORD;
  v_caller_staff RECORD;
  v_trimmed_pin TEXT;
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_trimmed_pin := trim(p_new_pin);

  -- Numeric check & length constraint (4 to 6 digits)
  IF v_trimmed_pin IS NULL OR v_trimmed_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'Manager PIN must be between 4 and 6 numeric digits' USING ERRCODE = 'P0002';
  END IF;

  -- Disallow repeating digits (0000, 1111, 2222, etc.)
  IF v_trimmed_pin ~ '^(\d)\1+$' THEN
    RAISE EXCEPTION 'Manager PIN cannot consist of repeating digits (e.g. 0000, 1111)' USING ERRCODE = 'P0002';
  END IF;

  -- Disallow trivial ascending or descending sequential patterns
  IF v_trimmed_pin IN (
    '1234', '2345', '3456', '4567', '5678', '6789', '0123',
    '4321', '5432', '6543', '7654', '8765', '9876', '3210',
    '12345', '23456', '34567', '45678', '56789',
    '54321', '65432', '76543', '87654', '98765',
    '123456', '234567', '345678', '456789',
    '654321', '765432', '876543', '987654'
  ) THEN
    RAISE EXCEPTION 'Manager PIN cannot be a sequential sequence (e.g. 1234, 4321)' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_target_staff
  FROM restaurant_staff
  WHERE id = p_staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found' USING ERRCODE = 'P0002';
  END IF;

  -- Caller must be owner of that restaurant or super admin
  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = v_target_staff.restaurant_id
    AND role = 'owner'
    AND is_active = TRUE;

  IF NOT FOUND AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only the restaurant owner can set or update manager PINs' USING ERRCODE = '42501';
  END IF;

  -- Hash with bcrypt and reset lockout counters
  UPDATE restaurant_staff
  SET manager_pin_hash = extensions.crypt(v_trimmed_pin, extensions.gen_salt('bf', 10)),
      failed_pin_attempts = 0,
      pin_locked_until = NULL,
      updated_at = NOW()
  WHERE id = p_staff_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Manager PIN updated successfully'
  );
END;
$$;

-- Revoke execute from PUBLIC and anon; grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) TO authenticated, service_role;
