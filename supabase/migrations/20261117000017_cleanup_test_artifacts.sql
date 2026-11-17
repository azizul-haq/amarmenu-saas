-- ==============================================================================
-- AmarMenu Migration: Clean up temporary test artifacts
-- Version: 20261117000009_cleanup_test_artifacts.sql
-- ==============================================================================

DELETE FROM auth.identities WHERE identity_data->>'email' = 'ownerb@amarmenu.com';
DELETE FROM auth.users WHERE email = 'ownerb@amarmenu.com';
DELETE FROM restaurant_staff WHERE email = 'ownerb@amarmenu.com';
