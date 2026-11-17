-- ==============================================================================
-- AmarMenu Migration: Confirm emails and clean up auth
-- Version: 20261117000004_confirm_emails.sql
-- ==============================================================================

-- Remove manual test rows so GoTrue can sign them up with its native password hasher
DELETE FROM auth.identities WHERE email IN ('admin@foodorder.com', 'demorestaurant@gmail.com');
DELETE FROM auth.users WHERE email IN ('admin@foodorder.com', 'demorestaurant@gmail.com');

-- Confirm testowner
UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = 'testowner@amarmenu.com';
