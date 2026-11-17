-- ==============================================================================
-- AmarMenu Migration: Super Admin Platform Analytics
-- Version: 20261117000046_platform_analytics.sql
-- Description:
--   1. get_platform_analytics: Platform-wide GMV (Gross Merchandise Volume),
--      order volume, daily time-series, top performing restaurants, city distributions,
--      payment channels, and SaaS subscription revenue vs food GMV.
--   2. Strict Super Admin security enforcement (P0002 for unauthorized callers).
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_platform_analytics(
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

  -- Platform KPI summary
  v_total_gmv NUMERIC(12,2) := 0.00;
  v_total_orders INT := 0;
  v_total_all_orders INT := 0;
  v_avg_order_value NUMERIC(10,2) := 0.00;
  v_total_vat NUMERIC(12,2) := 0.00;
  v_total_discounts NUMERIC(12,2) := 0.00;
  v_total_voided INT := 0;

  -- SaaS revenue & Tenant metrics
  v_saas_revenue NUMERIC(12,2) := 0.00;
  v_active_tenants INT := 0;
  v_total_tenants INT := 0;

  -- Aggregates
  v_daily_trend JSONB := '[]'::jsonb;
  v_top_restaurants JSONB := '[]'::jsonb;
  v_city_distribution JSONB := '[]'::jsonb;
  v_order_types JSONB := '[]'::jsonb;
  v_payment_methods JSONB := '[]'::jsonb;
BEGIN
  -- 1. Security Check: Caller MUST be Super Admin
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin authorization required' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Platform GMV & Order Volume
  SELECT
    COALESCE(SUM(total), 0.00),
    COUNT(*),
    COALESCE(SUM(tax), 0.00),
    COALESCE(SUM(discount), 0.00)
  INTO
    v_total_gmv,
    v_total_orders,
    v_total_vat,
    v_total_discounts
  FROM orders
  WHERE status = 'completed'
    AND COALESCE(completed_at, created_at) >= p_start_date
    AND COALESCE(completed_at, created_at) <= p_end_date;

  IF v_total_orders > 0 THEN
    v_avg_order_value := ROUND(v_total_gmv / v_total_orders, 2);
  ELSE
    v_avg_order_value := 0.00;
  END IF;

  -- All orders count (including pending, preparing, etc.)
  SELECT COUNT(*) INTO v_total_all_orders
  FROM orders
  WHERE created_at >= p_start_date AND created_at <= p_end_date;

  -- Voided / Cancelled orders
  SELECT COUNT(*) INTO v_total_voided
  FROM orders
  WHERE status = 'cancelled'
    AND COALESCE(cancelled_at, updated_at, created_at) >= p_start_date
    AND COALESCE(cancelled_at, updated_at, created_at) <= p_end_date;

  -- 3. SaaS Subscription Revenue Collected
  SELECT COALESCE(SUM(amount), 0.00)
  INTO v_saas_revenue
  FROM subscription_invoices
  WHERE status = 'paid'
    AND created_at >= p_start_date
    AND created_at <= p_end_date;

  -- Active and total tenants
  SELECT
    COUNT(*) FILTER (WHERE is_active = TRUE),
    COUNT(*)
  INTO
    v_active_tenants,
    v_total_tenants
  FROM restaurants;

  -- 4. Daily Time-Series (in Asia/Dhaka time zone)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', day_str,
        'label', day_label,
        'gmv', day_gmv,
        'orders_count', day_orders,
        'vat_collected', day_vat
      ) ORDER BY day_str ASC
    ),
    '[]'::jsonb
  ) INTO v_daily_trend
  FROM (
    SELECT
      TO_CHAR(COALESCE(completed_at, created_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day_str,
      TO_CHAR(COALESCE(completed_at, created_at) AT TIME ZONE 'Asia/Dhaka', 'Mon DD') AS day_label,
      COALESCE(SUM(total), 0.00) AS day_gmv,
      COUNT(*) AS day_orders,
      COALESCE(SUM(tax), 0.00) AS day_vat
    FROM orders
    WHERE status = 'completed'
      AND COALESCE(completed_at, created_at) >= p_start_date
      AND COALESCE(completed_at, created_at) <= p_end_date
    GROUP BY day_str, day_label
    ORDER BY day_str ASC
  ) dt;

  -- 5. Top Performing Restaurants Ranked by GMV
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'restaurant_id', r_id,
        'restaurant_name', r_name,
        'city', r_city,
        'plan_code', r_plan,
        'status', r_status,
        'completed_orders', r_orders,
        'total_gmv', r_gmv
      )
    ),
    '[]'::jsonb
  ) INTO v_top_restaurants
  FROM (
    SELECT
      r.id AS r_id,
      r.name AS r_name,
      COALESCE(r.city, 'Dhaka') AS r_city,
      COALESCE(s.plan_code, r.subscription_plan, 'growth') AS r_plan,
      r.status AS r_status,
      COUNT(o.id) AS r_orders,
      COALESCE(SUM(o.total), 0.00) AS r_gmv
    FROM restaurants r
    LEFT JOIN subscriptions s ON s.restaurant_id = r.id
    JOIN orders o ON o.restaurant_id = r.id AND o.status = 'completed'
      AND COALESCE(o.completed_at, o.created_at) >= p_start_date
      AND COALESCE(o.completed_at, o.created_at) <= p_end_date
    GROUP BY r.id, r.name, r.city, s.plan_code, r.subscription_plan, r.status
    ORDER BY r_gmv DESC, r_orders DESC
    LIMIT 10
  ) top_r;

  -- 6. Geographic Distribution (Cities/Divisions)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'city', city_name,
        'restaurant_count', rest_count,
        'orders_count', orders_count,
        'gmv', total_city_gmv
      ) ORDER BY total_city_gmv DESC
    ),
    '[]'::jsonb
  ) INTO v_city_distribution
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(r.city), ''), 'Dhaka') AS city_name,
      COUNT(DISTINCT r.id) AS rest_count,
      COUNT(o.id) FILTER (WHERE o.status = 'completed') AS orders_count,
      COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0.00) AS total_city_gmv
    FROM restaurants r
    LEFT JOIN orders o ON o.restaurant_id = r.id
      AND COALESCE(o.completed_at, o.created_at) >= p_start_date
      AND COALESCE(o.completed_at, o.created_at) <= p_end_date
    GROUP BY city_name
    ORDER BY total_city_gmv DESC
  ) cities;

  -- 7. Order Types Split Platform-Wide
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', order_type,
        'count', count,
        'gmv', total_rev
      ) ORDER BY total_rev DESC
    ),
    '[]'::jsonb
  ) INTO v_order_types
  FROM (
    SELECT
      order_type,
      COUNT(*) AS count,
      COALESCE(SUM(total), 0.00) AS total_rev
    FROM orders
    WHERE status = 'completed'
      AND COALESCE(completed_at, created_at) >= p_start_date
      AND COALESCE(completed_at, created_at) <= p_end_date
    GROUP BY order_type
    ORDER BY total_rev DESC
  ) ot;

  -- 8. Payment Channels Distribution Platform-Wide
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'method', payment_method,
        'amount', amount,
        'count', count
      ) ORDER BY amount DESC
    ),
    '[]'::jsonb
  ) INTO v_payment_methods
  FROM (
    SELECT
      payment_method,
      COALESCE(SUM(amount), 0.00) AS amount,
      COUNT(*) AS count
    FROM payments
    WHERE status IN ('completed', 'paid')
      AND created_at >= p_start_date
      AND created_at <= p_end_date
    GROUP BY payment_method
    ORDER BY amount DESC
  ) pm;

  -- 9. Construct and Return Result
  RETURN jsonb_build_object(
    'success', TRUE,
    'period', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date
    ),
    'overview', jsonb_build_object(
      'total_gmv', v_total_gmv,
      'total_orders', v_total_orders,
      'total_all_orders', v_total_all_orders,
      'avg_order_value', v_avg_order_value,
      'total_vat', v_total_vat,
      'total_discounts', v_total_discounts,
      'total_voided', v_total_voided,
      'saas_revenue', v_saas_revenue,
      'active_tenants', v_active_tenants,
      'total_tenants', v_total_tenants
    ),
    'daily_trend', v_daily_trend,
    'top_restaurants', v_top_restaurants,
    'city_distribution', v_city_distribution,
    'order_types', v_order_types,
    'payment_methods', v_payment_methods
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_platform_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
