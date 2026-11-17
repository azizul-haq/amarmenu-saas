-- ==============================================================================
-- AmarMenu Migration: Link testowner as Demo Restaurant Owner
-- Version: 20261117000006_link_testowner.sql
-- ==============================================================================

DO $$
DECLARE
  v_user_id UUID;
  v_rest_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'testowner@amarmenu.com' LIMIT 1;
  SELECT id INTO v_rest_id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1;

  IF v_user_id IS NOT NULL AND v_rest_id IS NOT NULL THEN
    INSERT INTO restaurant_staff (
      auth_user_id, restaurant_id, full_name, phone, email, role, is_active
    ) VALUES (
      v_user_id, v_rest_id, 'Demo Restaurant Owner', '+8801711112222', 'testowner@amarmenu.com', 'owner', TRUE
    )
    ON CONFLICT DO NOTHING;

    UPDATE restaurant_staff
    SET auth_user_id = v_user_id, role = 'owner', is_active = TRUE
    WHERE email = 'testowner@amarmenu.com';
  END IF;
END $$;
