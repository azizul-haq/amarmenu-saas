-- Migration 73: Prioritize owner in verify_manager_pin
-- When both owner and manager have manager PIN configured, prioritize owner
-- so owner-level authorizations (e.g. voiding settled bills) succeed.

CREATE OR REPLACE FUNCTION verify_manager_pin(
  p_restaurant_id UUID,
  p_pin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller RECORD;
  v_manager_id UUID;
  v_failed_count INT;
  v_lock_until TIMESTAMPTZ;
  v_is_super BOOLEAN;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Manager PIN must be at least 4 digits';
  END IF;

  SELECT is_super_admin() INTO v_is_super;

  -- Lookup caller in restaurant_staff
  SELECT id, restaurant_id, full_name, role, failed_pin_attempts, pin_locked_until
  INTO v_caller
  FROM restaurant_staff
  WHERE auth_user_id = auth.uid()
    AND is_active = TRUE
    AND (restaurant_id = p_restaurant_id OR v_is_super);

  IF v_caller.id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Unauthorized: Active staff member profile required' USING ERRCODE = '42501';
  END IF;

  -- Check if caller is currently locked out
  IF v_caller.pin_locked_until IS NOT NULL AND v_caller.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'Manager PIN verification locked out until %. Try again later.', v_caller.pin_locked_until USING ERRCODE = 'P0008';
  END IF;

  -- Check PIN against active managers/owners in the restaurant, preferring owner
  SELECT id INTO v_manager_id
  FROM restaurant_staff
  WHERE restaurant_id = p_restaurant_id
    AND role IN ('owner', 'manager')
    AND is_active = TRUE
    AND manager_pin_hash IS NOT NULL
    AND manager_pin_hash = extensions.crypt(p_pin, manager_pin_hash)
  ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, id
  LIMIT 1;

  IF v_manager_id IS NULL THEN
    -- PIN failed! Increment failed attempts and evaluate lockout
    IF v_caller.id IS NOT NULL THEN
      v_failed_count := COALESCE(v_caller.failed_pin_attempts, 0) + 1;
      IF v_failed_count >= 5 THEN
        v_lock_until := NOW() + INTERVAL '15 minutes';
      ELSE
        v_lock_until := NULL;
      END IF;

      UPDATE restaurant_staff
      SET failed_pin_attempts = v_failed_count,
          pin_locked_until = v_lock_until
      WHERE id = v_caller.id;

      -- Log failed attempt to audit_logs
      INSERT INTO audit_logs (
        restaurant_id,
        actor_id,
        actor_name,
        actor_role,
        action,
        entity_type,
        entity_id,
        reason
      )
      VALUES (
        p_restaurant_id,
        auth.uid(),
        v_caller.full_name,
        v_caller.role,
        'manager_pin_failed',
        'orders',
        p_restaurant_id,
        'Failed manager PIN attempt (' || v_failed_count || '/5)'
      );
    END IF;

    RETURN NULL;
  END IF;

  -- PIN verified! Reset failed attempts counter
  IF v_caller.id IS NOT NULL AND v_caller.failed_pin_attempts > 0 THEN
    UPDATE restaurant_staff
    SET failed_pin_attempts = 0,
        pin_locked_until = NULL
    WHERE id = v_caller.id;
  END IF;

  RETURN v_manager_id;
END;
$$;
