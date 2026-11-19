-- ==============================================================================
-- AmarMenu Migration: Supabase Auth Provisioning & Linking
-- Version: 20261117000002_auth_setup.sql
-- Description:
--   1. Schema DDL: Subscription plan check constraint
--   2. Test fixtures moved to supabase/seed-staging/seed.ts
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Allow 'growth' in restaurants.subscription_plan check constraint
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subscription_plan_check;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_subscription_plan_check 
  CHECK (subscription_plan IN ('free_trial', 'starter', 'growth', 'pro', 'enterprise'));

-- Fixtures removed: Production db push creates zero users and zero restaurants.
-- Demo restaurant and test users are provisioned via supabase/seed-staging/seed.ts.
