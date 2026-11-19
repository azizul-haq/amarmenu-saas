-- Migration 72: Chunk 22e Manager PIN Hardening & Algorithm Validation
-- Purpose:
-- 1. Redefine set_staff_manager_pin RPC with algorithmic sequential check (covers 01234, 43210, 7890, 234567).
-- 2. Use distinct SQLSTATE error code 'P0009' for all PIN validation rejections.
-- 3. Block common keypad and repeating patterns ('1212', '2580', '1122').
-- 4. Re-state REVOKE ALL from PUBLIC, anon and GRANT EXECUTE to authenticated, service_role.

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
  v_restaurant_id UUID;
  v_target_role TEXT;
  v_caller_name TEXT;
  v_actor_role TEXT;
  v_is_super_admin BOOLEAN := FALSE;
  v_trimmed_pin TEXT;
  v_pin_len INT;
  v_is_asc BOOLEAN := TRUE;
  v_is_desc BOOLEAN := TRUE;
  v_d1 INT;
  v_d2 INT;
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_trimmed_pin := trim(p_new_pin);

  -- 1. Numeric check & length constraint (4 to 6 numeric digits)
  IF v_trimmed_pin IS NULL OR v_trimmed_pin !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'Manager PIN must be between 4 and 6 numeric digits' USING ERRCODE = 'P0009';
  END IF;

  v_pin_len := length(v_trimmed_pin);

  -- 2. Disallow repeating identical digits (0000, 1111, 2222, etc.)
  IF v_trimmed_pin ~ '^(\d)\1+$' THEN
    RAISE EXCEPTION 'Manager PIN cannot consist of repeating digits (e.g. 0000, 1111)' USING ERRCODE = 'P0009';
  END IF;

  -- 3. Reject any strictly ascending or descending digit run computed algorithmically
  -- Checks linear adjacent differences (+1 or -1) as well as modular keyboard wrap (e.g. 7890, 0987).
  FOR i IN 1..(v_pin_len - 1) LOOP
    v_d1 := (substr(v_trimmed_pin, i, 1))::INT;
    v_d2 := (substr(v_trimmed_pin, i + 1, 1))::INT;

    IF NOT (v_d2 - v_d1 = 1 OR (v_d1 = 9 AND v_d2 = 0)) THEN
      v_is_asc := FALSE;
    END IF;

    IF NOT (v_d2 - v_d1 = -1 OR (v_d1 = 0 AND v_d2 = 9)) THEN
      v_is_desc := FALSE;
    END IF;
  END LOOP;

  IF v_is_asc OR v_is_desc THEN
    RAISE EXCEPTION 'Manager PIN cannot be a sequential sequence (e.g. 1234, 4321, 01234, 7890)' USING ERRCODE = 'P0009';
  END IF;

  -- 4. Disallow short blocklist of common keypad or paired patterns
  IF v_trimmed_pin IN ('1212', '2580', '1122', '121212', '112233') THEN
    RAISE EXCEPTION 'Manager PIN is on the blocklist of common or trivial patterns' USING ERRCODE = 'P0009';
  END IF;

  -- 5. Retrieve target staff member
  SELECT * INTO v_target_staff
  FROM restaurant_staff
  WHERE id = p_staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found' USING ERRCODE = 'P0002';
  END IF;

  v_restaurant_id := v_target_staff.restaurant_id;
  v_target_role := v_target_staff.role;

  -- 6. Check if caller is Super Admin
  v_is_super_admin := is_super_admin();

  IF v_is_super_admin THEN
    v_caller_name := 'Super Admin';
    v_actor_role := 'super_admin';
  ELSE
    -- 7. If not Super Admin, caller must be active owner of the target staff's restaurant
    SELECT * INTO v_caller_staff
    FROM restaurant_staff
    WHERE auth_user_id = v_caller_auth_id
      AND restaurant_id = v_restaurant_id
      AND role = 'owner'
      AND is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access denied: Only restaurant owner or super admin can set manager PIN'
        USING ERRCODE = '42501';
    END IF;

    v_caller_name := COALESCE(v_caller_staff.full_name, 'Owner');
    v_actor_role := 'owner';
  END IF;

  -- 8. Hash and persist the PIN
  UPDATE restaurant_staff
  SET manager_pin_hash = extensions.crypt(v_trimmed_pin, extensions.gen_salt('bf')),
      failed_pin_attempts = 0,
      pin_locked_until = NULL,
      updated_at = NOW()
  WHERE id = p_staff_id;

  -- 9. Record non-sensitive audit event (without PIN or hash)
  INSERT INTO audit_logs (
    restaurant_id,
    actor_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    new_values,
    reason
  )
  VALUES (
    v_restaurant_id,
    v_caller_auth_id,
    v_caller_name,
    v_actor_role,
    'manager_pin_set',
    'restaurant_staff',
    p_staff_id,
    jsonb_build_object('staff_id', p_staff_id, 'staff_role', v_target_role),
    'Manager PIN successfully configured/updated'
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'staff_id', p_staff_id,
    'message', 'Manager PIN updated successfully'
  );
END;
$$;

-- Re-state explicit privilege revocations and grants
REVOKE ALL ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.set_staff_manager_pin(UUID, TEXT) IS
  'Securely sets a 4-6 digit manager PIN with algorithmic sequential detection, blocklist check, and P0009 error code.';
