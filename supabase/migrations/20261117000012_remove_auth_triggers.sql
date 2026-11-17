-- ==============================================================================
-- AmarMenu Migration: Remove triggers from auth.users to prevent GoTrue auth conflicts
-- Version: 20261117000012_remove_auth_triggers.sql
-- ==============================================================================

DROP TRIGGER IF EXISTS trg_auto_confirm_test_users ON auth.users;
DROP FUNCTION IF EXISTS auto_confirm_test_users();

DROP TRIGGER IF EXISTS trg_auto_link_staff_auth ON auth.users;
DROP FUNCTION IF EXISTS auto_link_staff_auth();
