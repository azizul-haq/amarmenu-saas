-- ==============================================================================
-- Migration: 20261118000063_fix_verification_permissions_and_analytics.sql
-- Description:
-- 1. Grant SELECT, INSERT, UPDATE, DELETE on restaurant_admin_notes to authenticated (RLS enforced)
-- 2. Grant DELETE on audit_logs to authenticated so trigger prevent_audit_log_mutation triggers
-- 3. Grant UPDATE on restaurants to authenticated and add RLS update policy for own restaurant / super admin
-- 4. Update get_restaurant_sales_analytics to output both avg_order_value and average_order_value
-- 5. Update approve_registration_request to provision active subscription and link restaurant_admin_notes
-- ==============================================================================

-- 1. Table Grants for restaurant_admin_notes (RLS restricts to is_super_admin)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_admin_notes TO authenticated;

-- 2. Table Grant for audit_logs DELETE (RLS and BEFORE DELETE trigger enforce immutability)
GRANT DELETE ON public.audit_logs TO authenticated;

-- 3. Table Grant and RLS Policy for restaurants UPDATE
GRANT UPDATE ON public.restaurants TO authenticated;

DROP POLICY IF EXISTS "restaurants_staff_update_own" ON public.restaurants;
CREATE POLICY "restaurants_staff_update_own"
  ON public.restaurants
  FOR UPDATE
  TO authenticated
  USING (
    (id = current_restaurant_id() AND has_permission(id, 'change_settings'))
    OR is_super_admin()
  )
  WITH CHECK (
    (id = current_restaurant_id() AND has_permission(id, 'change_settings'))
    OR is_super_admin()
  );

-- 4. Update get_restaurant_sales_analytics with both avg_order_value and average_order_value
CREATE OR REPLACE FUNCTION get_restaurant_sales_analytics(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_restaurant RECORD;

  v_gross_sales NUMERIC(10,2) := 0.00;
  v_net_sales NUMERIC(10,2) := 0.00;
  v_total_vat NUMERIC(10,2) := 0.00;
  v_total_discount NUMERIC(10,2) := 0.00;
  v_total_orders INT := 0;
  v_avg_order_value NUMERIC(10,2) := 0.00;
  v_voided_orders INT := 0;

  v_cash_sales NUMERIC(10,2) := 0.00;
  v_bkash_sales NUMERIC(10,2) := 0.00;
  v_nagad_sales NUMERIC(10,2) := 0.00;
  v_card_sales NUMERIC(10,2) := 0.00;
  v_other_sales NUMERIC(10,2) := 0.00;

  v_payment_methods JSONB := '[]'::jsonb;
  v_order_types JSONB := '[]'::jsonb;
  v_daily_sales JSONB := '[]'::jsonb;
  v_top_items JSONB := '[]'::jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  v_is_super := is_super_admin();
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM restaurant_staff
      WHERE auth_user_id = v_caller_id
        AND restaurant_id = p_restaurant_id
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'Access denied: You do not have permission to view analytics for this restaurant' USING ERRCODE = 'P0002';
    END IF;

    IF NOT has_permission(p_restaurant_id, 'view_reports') THEN
      RAISE EXCEPTION 'Permission denied: Your role cannot view reports' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, name, name_bn, vat_bin_no, trade_license_no, default_vat_rate, currency, currency_symbol
  INTO v_restaurant
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0004';
  END IF;

  SELECT
    COALESCE(SUM(total), 0.00),
    COALESCE(SUM(subtotal - COALESCE(discount, 0.00)), 0.00),
    COALESCE(SUM(tax), 0.00),
    COALESCE(SUM(discount), 0.00),
    COUNT(*)
  INTO
    v_gross_sales,
    v_net_sales,
    v_total_vat,
    v_total_discount,
    v_total_orders
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND status = 'completed'
    AND COALESCE(completed_at, created_at) >= p_start_date
    AND COALESCE(completed_at, created_at) <= p_end_date;

  IF v_total_orders > 0 THEN
    v_avg_order_value := ROUND(v_gross_sales / v_total_orders, 2);
  ELSE
    v_avg_order_value := 0.00;
  END IF;

  SELECT COUNT(*)
  INTO v_voided_orders
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND status = 'cancelled'
    AND COALESCE(cancelled_at, updated_at, created_at) >= p_start_date
    AND COALESCE(cancelled_at, updated_at, created_at) <= p_end_date;

  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'bkash' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'nagad' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method NOT IN ('cash', 'bkash', 'nagad', 'card') THEN amount ELSE 0 END), 0.00)
  INTO
    v_cash_sales,
    v_bkash_sales,
    v_nagad_sales,
    v_card_sales,
    v_other_sales
  FROM payments
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('completed', 'paid')
    AND created_at >= p_start_date
    AND created_at <= p_end_date;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'method', method,
        'amount', amount,
        'count', count
      )
    ),
    '[]'::jsonb
  ) INTO v_payment_methods
  FROM (
    SELECT
      payment_method AS method,
      COALESCE(SUM(amount), 0.00) AS amount,
      COUNT(*) AS count
    FROM payments
    WHERE restaurant_id = p_restaurant_id
      AND status IN ('completed', 'paid')
      AND created_at >= p_start_date
      AND created_at <= p_end_date
    GROUP BY payment_method
    ORDER BY amount DESC
  ) pm;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', order_type,
        'count', count,
        'revenue', total_rev
      )
    ),
    '[]'::jsonb
  ) INTO v_order_types
  FROM (
    SELECT
      order_type,
      COUNT(*) AS count,
      COALESCE(SUM(total), 0.00) AS total_rev
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND status = 'completed'
      AND COALESCE(completed_at, created_at) >= p_start_date
      AND COALESCE(completed_at, created_at) <= p_end_date
    GROUP BY order_type
    ORDER BY count DESC
  ) ot;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', day_str,
        'label', day_label,
        'gross_sales', day_gross,
        'net_sales', day_net,
        'vat_collected', day_vat,
        'orders_count', day_orders
      ) ORDER BY day_str ASC
    ),
    '[]'::jsonb
  ) INTO v_daily_sales
  FROM (
    SELECT
      TO_CHAR(COALESCE(completed_at, created_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day_str,
      TO_CHAR(COALESCE(completed_at, created_at) AT TIME ZONE 'Asia/Dhaka', 'Mon DD') AS day_label,
      COALESCE(SUM(total), 0.00) AS day_gross,
      COALESCE(SUM(subtotal - COALESCE(discount, 0.00)), 0.00) AS day_net,
      COALESCE(SUM(tax), 0.00) AS day_vat,
      COUNT(*) AS day_orders
    FROM orders
    WHERE restaurant_id = p_restaurant_id
      AND status = 'completed'
      AND COALESCE(completed_at, created_at) >= p_start_date
      AND COALESCE(completed_at, created_at) <= p_end_date
    GROUP BY day_str, day_label
    ORDER BY day_str ASC
  ) daily;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name', item_name,
        'quantity', qty,
        'revenue', rev
      )
    ),
    '[]'::jsonb
  ) INTO v_top_items
  FROM (
    SELECT
      oi.item_name,
      SUM(oi.quantity) AS qty,
      COALESCE(SUM(oi.item_total), 0.00) AS rev
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.restaurant_id = p_restaurant_id
      AND o.status = 'completed'
      AND COALESCE(o.completed_at, o.created_at) >= p_start_date
      AND COALESCE(o.completed_at, o.created_at) <= p_end_date
    GROUP BY oi.item_name
    ORDER BY rev DESC, qty DESC
    LIMIT 50
  ) top;

  RETURN jsonb_build_object(
    'success', TRUE,
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no,
      'currency_symbol', COALESCE(v_restaurant.currency_symbol, '৳')
    ),
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'summary', jsonb_build_object(
      'gross_sales', v_gross_sales,
      'net_sales', v_net_sales,
      'vat_collected', v_total_vat,
      'discount_total', v_total_discount,
      'total_orders', v_total_orders,
      'avg_order_value', v_avg_order_value,
      'average_order_value', v_avg_order_value,
      'voided_orders', v_voided_orders
    ),
    'payment_breakdown', jsonb_build_object(
      'cash_sales', v_cash_sales,
      'bkash_sales', v_bkash_sales,
      'nagad_sales', v_nagad_sales,
      'card_sales', v_card_sales,
      'other_sales', v_other_sales,
      'methods', v_payment_methods
    ),
    'order_types', v_order_types,
    'daily_sales', v_daily_sales,
    'top_items', v_top_items
  );
END;
$$;

REVOKE ALL ON FUNCTION get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- 5. Stored Procedure: approve_registration_request
CREATE OR REPLACE FUNCTION approve_registration_request(
  p_request_id UUID,
  p_subscription_plan TEXT DEFAULT 'growth',
  p_internal_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req registration_requests%ROWTYPE;
  v_slug TEXT;
  v_base_slug TEXT;
  v_restaurant_id UUID;
  v_plan_id UUID;
  v_plan_name TEXT;
  v_staff_id UUID;
  v_period_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
BEGIN
  -- 1. Security Check: Caller must be an active super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin privilege required' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Fetch Registration Request
  SELECT * INTO v_req FROM registration_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Registration request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status = 'approved' THEN
    RAISE EXCEPTION 'Registration request has already been approved' USING ERRCODE = '22023';
  END IF;

  -- 3. Resolve plan name and ID
  v_plan_name := lower(trim(COALESCE(p_subscription_plan, 'growth')));
  SELECT id INTO v_plan_id FROM plans WHERE name = v_plan_name LIMIT 1;
  IF v_plan_id IS NULL THEN
    SELECT id, name INTO v_plan_id, v_plan_name FROM plans WHERE name = 'growth' LIMIT 1;
  END IF;
  IF v_plan_id IS NULL THEN
    SELECT id, name INTO v_plan_id, v_plan_name FROM plans WHERE is_active = TRUE ORDER BY price_monthly ASC LIMIT 1;
  END IF;

  -- 4. Generate unique slug
  v_base_slug := lower(regexp_replace(trim(v_req.restaurant_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'restaurant';
  END IF;
  v_slug := v_base_slug;

  IF EXISTS (SELECT 1 FROM restaurants WHERE slug = v_slug) THEN
    v_slug := v_base_slug || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  -- 5. Create Restaurant Record (Status: 'active')
  INSERT INTO restaurants (
    name,
    slug,
    phone,
    email,
    city,
    address,
    restaurant_type,
    subscription_plan,
    status,
    is_active,
    currency,
    currency_symbol,
    default_vat_rate
  ) VALUES (
    v_req.restaurant_name,
    v_slug,
    v_req.phone,
    v_req.email,
    v_req.city,
    v_req.address,
    COALESCE(v_req.restaurant_type, 'Restaurant'),
    v_plan_name,
    'active',
    true,
    'BDT',
    '৳',
    5.00
  )
  RETURNING id INTO v_restaurant_id;

  -- 6. Provision Subscription Record (status: 'active', 30 days)
  INSERT INTO subscriptions (
    restaurant_id,
    plan_id,
    plan_code,
    status,
    current_period_start,
    current_period_end
  ) VALUES (
    v_restaurant_id,
    v_plan_id,
    v_plan_name,
    'active',
    NOW(),
    v_period_end
  );

  -- 7. Create Restaurant Staff entry (role: owner)
  INSERT INTO restaurant_staff (
    restaurant_id,
    full_name,
    phone,
    email,
    role,
    is_active
  ) VALUES (
    v_restaurant_id,
    v_req.owner_name,
    v_req.phone,
    v_req.email,
    'owner',
    true
  )
  RETURNING id INTO v_staff_id;

  -- 8. Record platform admin notes
  IF p_internal_notes IS NOT NULL AND trim(p_internal_notes) != '' THEN
    INSERT INTO restaurant_admin_notes (
      restaurant_id, registration_request_id, internal_notes
    ) VALUES (
      v_restaurant_id, p_request_id, trim(p_internal_notes)
    )
    ON CONFLICT (restaurant_id) DO UPDATE SET
      internal_notes = EXCLUDED.internal_notes,
      registration_request_id = EXCLUDED.registration_request_id;
  END IF;

  -- 9. Update Registration Request
  UPDATE registration_requests
  SET
    status = 'approved',
    reviewed_at = NOW(),
    internal_notes = p_internal_notes
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'restaurant_id', v_restaurant_id,
    'restaurant_name', v_req.restaurant_name,
    'slug', v_slug,
    'owner_name', v_req.owner_name,
    'email', v_req.email,
    'plan', v_plan_name,
    'staff_id', v_staff_id
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_registration_request(UUID, TEXT, TEXT) TO authenticated, service_role;
