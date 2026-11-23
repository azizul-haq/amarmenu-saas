-- Migration: 20261123000081_standardize_saas_subscription_plans.sql
-- Description: Standardize 3-tier SaaS Subscription Plans (starter, growth, enterprise)
-- with exact quota limits and structured JSONB feature flags.

-- 1. Upsert Starter Plan (৳1,499/mo, ৳14,388/yr | 15 tables, 5 staff)
INSERT INTO public.plans (
  name,
  display_name,
  description,
  price_monthly,
  price_yearly,
  max_tables,
  max_staff,
  features,
  is_active
)
VALUES (
  'starter',
  'Starter',
  'Ideal for small cafes, fast food shops, and food carts.',
  1499.00,
  14388.00,
  15,
  5,
  '{
    "custom_logo": true,
    "kds": false,
    "delivery_role": false,
    "vat_reports": false,
    "cash_shifts": false,
    "activity_history": false,
    "pin_void": false,
    "audit_logs": false,
    "csv_export": false
  }'::jsonb,
  TRUE
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_tables = 15,
  max_staff = 5,
  features = '{
    "custom_logo": true,
    "kds": false,
    "delivery_role": false,
    "vat_reports": false,
    "cash_shifts": false,
    "activity_history": false,
    "pin_void": false,
    "audit_logs": false,
    "csv_export": false
  }'::jsonb,
  is_active = TRUE;

-- 2. Upsert Growth Plan (৳2,999/mo, ৳28,788/yr | 50 tables, 15 staff)
INSERT INTO public.plans (
  name,
  display_name,
  description,
  price_monthly,
  price_yearly,
  max_tables,
  max_staff,
  features,
  is_active
)
VALUES (
  'growth',
  'Growth',
  'Full features for busy dine-in restaurants, biryani houses, and eateries.',
  2999.00,
  28788.00,
  50,
  15,
  '{
    "custom_logo": true,
    "kds": true,
    "delivery_role": true,
    "vat_reports": true,
    "cash_shifts": true,
    "activity_history": true,
    "pin_void": false,
    "audit_logs": false,
    "csv_export": false
  }'::jsonb,
  TRUE
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_tables = 50,
  max_staff = 15,
  features = '{
    "custom_logo": true,
    "kds": true,
    "delivery_role": true,
    "vat_reports": true,
    "cash_shifts": true,
    "activity_history": true,
    "pin_void": false,
    "audit_logs": false,
    "csv_export": false
  }'::jsonb,
  is_active = TRUE;

-- 3. Upsert Enterprise Plan (৳5,999/mo, ৳57,588/yr | Unlimited tables & staff)
INSERT INTO public.plans (
  name,
  display_name,
  description,
  price_monthly,
  price_yearly,
  max_tables,
  max_staff,
  features,
  is_active
)
VALUES (
  'enterprise',
  'Enterprise',
  'Advanced operations for multi-branch chains, cloud kitchens, and fine dining.',
  5999.00,
  57588.00,
  NULL,
  NULL,
  '{
    "custom_logo": true,
    "kds": true,
    "delivery_role": true,
    "vat_reports": true,
    "cash_shifts": true,
    "activity_history": true,
    "pin_void": true,
    "audit_logs": true,
    "csv_export": true
  }'::jsonb,
  TRUE
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_tables = NULL,
  max_staff = NULL,
  features = '{
    "custom_logo": true,
    "kds": true,
    "delivery_role": true,
    "vat_reports": true,
    "cash_shifts": true,
    "activity_history": true,
    "pin_void": true,
    "audit_logs": true,
    "csv_export": true
  }'::jsonb,
  is_active = TRUE;

-- 4. Link subscriptions missing plan_id to their respective plans
UPDATE public.subscriptions s
SET plan_id = p.id
FROM public.plans p
WHERE s.plan_code = p.name
  AND (s.plan_id IS NULL OR s.plan_id <> p.id);

-- 5. Ensure anon and authenticated can SELECT from plans
GRANT SELECT ON public.plans TO authenticated, anon;
