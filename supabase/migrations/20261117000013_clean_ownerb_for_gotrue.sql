-- ==============================================================================
-- AmarMenu Migration: Clean Owner B manual rows for GoTrue native signup
-- Version: 20261117000013_clean_ownerb_for_gotrue.sql
-- ==============================================================================

DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'ownerb@amarmenu.com');
DELETE FROM auth.users WHERE email = 'ownerb@amarmenu.com';
