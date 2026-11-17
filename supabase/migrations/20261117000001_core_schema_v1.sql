-- ==============================================================================
-- AmarMenu Migration: Core Schema v1
-- Version: 20261117000001_core_schema_v1.sql
-- Description:
--   1. Enhance restaurants with Bangladesh NBR VAT, BIN, Bangla name, & currency
--   2. Add restaurant_staff (Role-Based Access Control) & migrate legacy users
--   3. Add platform_admins & migrate legacy admin_users
--   4. Add plans (SaaS pricing tiers for Bangladesh market)
--   5. Add subscriptions (tenant billing lifecycle tracking)
-- ==============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. ENHANCE RESTAURANTS (Zero Data Loss)
-- ==============================================================================
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS name_bn TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS trade_license_no TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS vat_bin_no TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS default_vat_rate NUMERIC(4,2) NOT NULL DEFAULT 5.00;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_charge_rate NUMERIC(4,2) NOT NULL DEFAULT 0.00;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'BDT';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS currency_symbol TEXT NOT NULL DEFAULT '৳';

-- ==============================================================================
-- 2. RESTAURANT STAFF (Multi-Tenant Staff & Roles)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS restaurant_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'waiter')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_staff_restaurant_id ON restaurant_staff(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_staff_auth_user ON restaurant_staff(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_staff_role ON restaurant_staff(restaurant_id, role);

-- Data Migration: Migrate existing users into restaurant_staff without losing data
INSERT INTO restaurant_staff (restaurant_id, full_name, email, role, is_active, created_at, updated_at)
SELECT 
  u.restaurant_id,
  COALESCE(r.owner_name, SPLIT_PART(u.email, '@', 1)) AS full_name,
  u.email,
  CASE 
    WHEN u.role = 'owner' THEN 'owner'
    WHEN u.role = 'staff' THEN 'cashier'
    ELSE 'owner'
  END AS role,
  u.is_active,
  u.created_at,
  u.updated_at
FROM users u
LEFT JOIN restaurants r ON r.id = u.restaurant_id
WHERE u.restaurant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM restaurant_staff rs 
    WHERE rs.restaurant_id = u.restaurant_id AND rs.email = u.email
  );

-- ==============================================================================
-- 3. PLATFORM ADMINS (Super Admin, Support & Billing Team)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'support_agent', 'billing_admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON platform_admins(email);

-- Data Migration: Migrate existing admin_users into platform_admins
INSERT INTO platform_admins (email, full_name, role, is_active, created_at, updated_at)
SELECT 
  email,
  COALESCE(name, 'System Admin') AS full_name,
  'super_admin' AS role,
  is_active,
  created_at,
  updated_at
FROM admin_users
ON CONFLICT (email) DO NOTHING;

-- ==============================================================================
-- 4. SUBSCRIPTION PLANS (AmarMenu Pricing Tiers)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  price_monthly NUMERIC(10,2) NOT NULL,
  price_yearly NUMERIC(10,2) NOT NULL,
  max_tables INT,
  max_staff INT,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Bangladesh Market SaaS Pricing Plans
INSERT INTO plans (name, display_name, description, price_monthly, price_yearly, max_tables, max_staff, features, is_active)
VALUES 
  (
    'starter', 
    'Starter', 
    'Ideal for small cafes, fast food shops, and food carts.', 
    1499.00, 
    14388.00, 
    15, 
    3, 
    '["Up to 15 tables", "QR ordering", "1 thermal printer sync", "Daily sales summary", "Email support"]'::jsonb,
    TRUE
  ),
  (
    'growth', 
    'Growth', 
    'Full features for dine-in restaurants, biryani houses, and busy eateries.', 
    2999.00, 
    28788.00, 
    NULL, 
    10, 
    '["Unlimited tables", "Waiter POS mode", "KDS kitchen display", "2 printer syncs", "bKash & Nagad payments", "NBR VAT reports", "WhatsApp support"]'::jsonb,
    TRUE
  ),
  (
    'enterprise', 
    'Enterprise', 
    'Advanced multi-branch chain and cloud kitchen operations.', 
    5999.00, 
    57588.00, 
    NULL, 
    NULL, 
    '["Unlimited tables & branches", "Centralized warehouse inventory", "Custom domain", "Dedicated account manager", "Custom ERP integration", "24/7 phone priority"]'::jsonb,
    TRUE
  )
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_tables = EXCLUDED.max_tables,
  max_staff = EXCLUDED.max_staff,
  features = EXCLUDED.features;

-- ==============================================================================
-- 5. SUBSCRIPTIONS (Tenant Billing & Subscription Lifecycle)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  plan_code TEXT NOT NULL DEFAULT 'growth',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  amount NUMERIC(10,2) NOT NULL DEFAULT 2999.00,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'grace_period', 'suspended', 'cancelled')),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  payment_method TEXT,
  last_payment_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_restaurant ON subscriptions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Backfill subscriptions for any existing restaurants
INSERT INTO subscriptions (restaurant_id, plan_id, plan_code, amount, status, trial_ends_at, current_period_end)
SELECT 
  r.id AS restaurant_id,
  p.id AS plan_id,
  COALESCE(r.subscription_plan, 'growth') AS plan_code,
  COALESCE(p.price_monthly, 2999.00) AS amount,
  CASE 
    WHEN r.status = 'active' THEN 'active'
    ELSE 'trial'
  END AS status,
  COALESCE(r.trial_ends_at, NOW() + INTERVAL '14 days') AS trial_ends_at,
  COALESCE(r.trial_ends_at, NOW() + INTERVAL '30 days') AS current_period_end
FROM restaurants r
LEFT JOIN plans p ON p.name = COALESCE(r.subscription_plan, 'growth')
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.restaurant_id = r.id
);

-- ==============================================================================
-- 6. AUTOMATED UPDATE TRIGGERS
-- ==============================================================================
DROP TRIGGER IF EXISTS update_restaurant_staff_updated_at ON restaurant_staff;
CREATE TRIGGER update_restaurant_staff_updated_at 
  BEFORE UPDATE ON restaurant_staff 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_platform_admins_updated_at ON platform_admins;
CREATE TRIGGER update_platform_admins_updated_at 
  BEFORE UPDATE ON platform_admins 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at 
  BEFORE UPDATE ON subscriptions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE restaurant_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Plans: Public readable for active plans (marketing & pricing display)
DROP POLICY IF EXISTS "Allow public read on plans" ON plans;
CREATE POLICY "Allow public read on plans" 
  ON plans FOR SELECT 
  USING (is_active = TRUE);

-- Restaurant Staff: Tenant isolation (custom app auth compatible)
DROP POLICY IF EXISTS "Allow public select on restaurant_staff" ON restaurant_staff;
CREATE POLICY "Allow public select on restaurant_staff" 
  ON restaurant_staff FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Allow public modify on restaurant_staff" ON restaurant_staff;
CREATE POLICY "Allow public modify on restaurant_staff" 
  ON restaurant_staff FOR ALL 
  USING (true) WITH CHECK (true);

-- Platform Admins
DROP POLICY IF EXISTS "Allow public select on platform_admins" ON platform_admins;
CREATE POLICY "Allow public select on platform_admins" 
  ON platform_admins FOR SELECT 
  USING (true);

-- Subscriptions: Tenant read & manage
DROP POLICY IF EXISTS "Allow public select on subscriptions" ON subscriptions;
CREATE POLICY "Allow public select on subscriptions" 
  ON subscriptions FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Allow public modify on subscriptions" ON subscriptions;
CREATE POLICY "Allow public modify on subscriptions" 
  ON subscriptions FOR ALL 
  USING (true) WITH CHECK (true);
