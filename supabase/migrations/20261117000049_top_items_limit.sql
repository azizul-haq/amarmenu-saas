-- ==============================================================================
-- AmarMenu Migration: Increase top selling items limit to 50 in get_restaurant_sales_analytics
-- Version: 20261117000049_top_items_limit.sql
-- ==============================================================================

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

  -- Financial & order metrics
  v_gross_sales NUMERIC(10,2) := 0.00;
  v_net_sales NUMERIC(10,2) := 0.00;
  v_total_vat NUMERIC(10,2) := 0.00;
  v_total_discount NUMERIC(10,2) := 0.00;
  v_total_orders INT := 0;
  v_avg_order_value NUMERIC(10,2) := 0.00;
  v_voided_orders INT := 0;

  -- Payment breakdowns
  v_cash_sales NUMERIC(10,2) := 0.00;
  v_bkash_sales NUMERIC(10,2) := 0.00;
  v_nagad_sales NUMERIC(10,2) := 0.00;
  v_card_sales NUMERIC(10,2) := 0.00;
  v_other_sales NUMERIC(10,2) := 0.00;

  -- JSON aggregates
  v_payment_methods JSONB := '[]'::jsonb;
  v_order_types JSONB := '[]'::jsonb;
  v_daily_sales JSONB := '[]'::jsonb;
  v_top_items JSONB := '[]'::jsonb;
BEGIN
  -- 1. Security Check: Authenticated caller must belong to tenant or be super_admin
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
  END IF;

  -- 2. Fetch Restaurant Details
  SELECT id, name, name_bn, vat_bin_no, trade_license_no, default_vat_rate, currency, currency_symbol
  INTO v_restaurant
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = 'P0004';
  END IF;

  -- 3. Completed Orders Financial Metrics
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

  -- 4. Count Voided Orders in period
  SELECT COUNT(*)
  INTO v_voided_orders
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND status = 'cancelled'
    AND COALESCE(cancelled_at, updated_at, created_at) >= p_start_date
    AND COALESCE(cancelled_at, updated_at, created_at) <= p_end_date;

  -- 5. Payment Methods Breakdown (from completed payments)
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

  -- Payment methods array for charts
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

  -- 6. Order Type Distribution
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

  -- 7. Daily Sales Time-Series (Bangladesh Asia/Dhaka time zone)
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

  -- 8. Top Selling Items (from normalized order_items, up to 50 items)
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

  -- 9. Construct and Return Result
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

GRANT EXECUTE ON FUNCTION get_restaurant_sales_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
