-- Migration 43: Fix get_active_cash_shift payment status filter (support 'completed' and 'paid')

CREATE OR REPLACE FUNCTION get_active_cash_shift(
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_shift RECORD;
  v_opener_name TEXT;
  v_cash_sales NUMERIC(10,2) := 0.00;
  v_digital_sales NUMERIC(10,2) := 0.00;
  v_completed_orders INT := 0;
  v_voided_orders INT := 0;
  v_expected_cash NUMERIC(10,2) := 0.00;
BEGIN
  SELECT * INTO v_shift
  FROM cash_shifts
  WHERE restaurant_id = p_restaurant_id
    AND status = 'open'
  ORDER BY opening_time DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('has_active_shift', false);
  END IF;

  -- Get opener name
  SELECT full_name INTO v_opener_name
  FROM restaurant_staff
  WHERE auth_user_id = v_shift.opened_by
  LIMIT 1;

  -- Calculate live sales during shift (match both 'completed' and 'paid')
  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method != 'cash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00)
  INTO v_cash_sales, v_digital_sales
  FROM payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= v_shift.opening_time;

  -- Live order counts
  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled')
  INTO v_completed_orders, v_voided_orders
  FROM orders
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= v_shift.opening_time;

  v_expected_cash := v_shift.opening_float + v_cash_sales;

  RETURN jsonb_build_object(
    'has_active_shift', true,
    'shift_id', v_shift.id,
    'restaurant_id', v_shift.restaurant_id,
    'opened_by_name', COALESCE(v_opener_name, 'Cashier'),
    'opening_float', v_shift.opening_float,
    'opening_time', v_shift.opening_time,
    'status', v_shift.status,
    'live_cash_sales', v_cash_sales,
    'live_digital_sales', v_digital_sales,
    'live_total_sales', (v_cash_sales + v_digital_sales),
    'live_expected_cash', v_expected_cash,
    'live_completed_orders', v_completed_orders,
    'live_voided_orders', v_voided_orders
  );
END;
$$;
