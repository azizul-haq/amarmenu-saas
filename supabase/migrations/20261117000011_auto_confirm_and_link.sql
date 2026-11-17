-- ==============================================================================
-- AmarMenu Migration: Auto-confirm test users & auto-link restaurant staff
-- Version: 20261117000011_auto_confirm_and_link.sql
-- ==============================================================================

-- 1. Trigger to auto-confirm test emails
CREATE OR REPLACE FUNCTION auto_confirm_test_users()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email LIKE '%@amarmenu.com' OR NEW.email LIKE '%@foodorder.com' THEN
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_confirm_test_users ON auth.users;
CREATE TRIGGER trg_auto_confirm_test_users
BEFORE INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION auto_confirm_test_users();

-- 2. Trigger to automatically link auth.users.id into restaurant_staff and platform_admins
CREATE OR REPLACE FUNCTION auto_link_staff_auth()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE restaurant_staff
  SET auth_user_id = NEW.id
  WHERE email = NEW.email AND (auth_user_id IS NULL OR auth_user_id <> NEW.id);

  UPDATE platform_admins
  SET auth_user_id = NEW.id
  WHERE email = NEW.email AND (auth_user_id IS NULL OR auth_user_id <> NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_link_staff_auth ON auth.users;
CREATE TRIGGER trg_auto_link_staff_auth
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION auto_link_staff_auth();

-- 3. Confirm all existing users right now
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;
