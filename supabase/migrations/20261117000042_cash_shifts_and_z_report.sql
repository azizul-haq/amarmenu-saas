-- ==============================================================================
-- Migration 42: Cash Drawer Shifts, End-of-Day (EOD) Z-Report & Cash Reconciliation
-- ==============================================================================

-- 1. Create cash_shifts table
CREATE TABLE IF NOT EXISTS cash_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_float NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (opening_float >= 0),
  opening_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closing_time TIMESTAMPTZ,
  closing_count NUMERIC(10,2) CHECK (closing_count IS NULL OR closing_count >= 0),
  expected_cash NUMERIC(10,2),
  discrepancy NUMERIC(10,2),
  total_sales NUMERIC(10,2) DEFAULT 0.00,
  cash_sales NUMERIC(10,2) DEFAULT 0.00,
  digital_sales NUMERIC(10,2) DEFAULT 0.00,
  tax_collected NUMERIC(10,2) DEFAULT 0.00,
  discount_total NUMERIC(10,2) DEFAULT 0.00,
  total_orders INT DEFAULT 0,
  voided_orders INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_shifts_restaurant ON cash_shifts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_status ON cash_shifts(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_opening_time ON cash_shifts(restaurant_id, opening_time DESC);

-- 2. Row Level Security on cash_shifts
ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_shifts_select_staff" ON cash_shifts;
CREATE POLICY "cash_shifts_select_staff" ON cash_shifts
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "cash_shifts_insert_staff" ON cash_shifts;
CREATE POLICY "cash_shifts_insert_staff" ON cash_shifts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "cash_shifts_update_staff" ON cash_shifts;
CREATE POLICY "cash_shifts_update_staff" ON cash_shifts
  FOR UPDATE
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- 3. Procedure: Open Cash Shift
CREATE OR REPLACE FUNCTION open_cash_shift(
  p_opening_float NUMERIC(10,2) DEFAULT 0.00,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_caller_staff RECORD;
  v_existing_shift RECORD;
  v_new_shift_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_float NUMERIC(10,2) := COALESCE(p_opening_float, 0.00);
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to open cash shift';
  END IF;

  -- Resolve staff & restaurant
  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND is_active = TRUE;

  IF NOT FOUND AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You are not active staff at any restaurant';
  END IF;

  IF v_float < 0 THEN
    RAISE EXCEPTION 'Opening float cannot be negative';
  END IF;

  -- Check for existing active open shift
  SELECT * INTO v_existing_shift
  FROM cash_shifts
  WHERE restaurant_id = v_caller_staff.restaurant_id
    AND status = 'open'
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'An open shift is already active for this restaurant (opened at %). Please close it before opening a new one.',
      v_existing_shift.opening_time;
  END IF;

  INSERT INTO cash_shifts (
    restaurant_id,
    opened_by,
    status,
    opening_float,
    opening_time,
    notes,
    created_at,
    updated_at
  ) VALUES (
    v_caller_staff.restaurant_id,
    v_caller_auth_id,
    'open',
    v_float,
    v_now,
    p_notes,
    v_now,
    v_now
  )
  RETURNING id INTO v_new_shift_id;

  RETURN jsonb_build_object(
    'success', true,
    'shift_id', v_new_shift_id,
    'restaurant_id', v_caller_staff.restaurant_id,
    'opening_float', v_float,
    'opening_time', v_now,
    'status', 'open'
  );
END;
$$;

-- 4. Procedure: Get Active Cash Shift (With Real-Time Metrics)
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

  -- Calculate live sales during shift
  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status = 'paid' THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method != 'cash' AND status = 'paid' THEN amount ELSE 0 END), 0.00)
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

-- 5. Procedure: Close Cash Shift & Generate Comprehensive Z-Report
CREATE OR REPLACE FUNCTION close_cash_shift(
  p_shift_id UUID,
  p_closing_count NUMERIC(10,2),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_caller_staff RECORD;
  v_shift RECORD;
  v_restaurant RECORD;
  v_opener_name TEXT;
  v_closer_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  
  -- Financial totals during shift
  v_total_sales NUMERIC(10,2) := 0.00;
  v_cash_sales NUMERIC(10,2) := 0.00;
  v_digital_sales NUMERIC(10,2) := 0.00;
  v_bkash_sales NUMERIC(10,2) := 0.00;
  v_nagad_sales NUMERIC(10,2) := 0.00;
  v_card_sales NUMERIC(10,2) := 0.00;
  v_tax_collected NUMERIC(10,2) := 0.00;
  v_discount_total NUMERIC(10,2) := 0.00;
  v_expected_cash NUMERIC(10,2) := 0.00;
  v_discrepancy NUMERIC(10,2) := 0.00;
  
  -- Order counts during shift
  v_total_orders INT := 0;
  v_voided_orders INT := 0;
  v_dine_in_orders INT := 0;
  v_takeaway_orders INT := 0;
BEGIN
  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to close cash shift';
  END IF;

  IF p_closing_count IS NULL OR p_closing_count < 0 THEN
    RAISE EXCEPTION 'Closing cash count cannot be negative';
  END IF;

  -- Lock shift row
  SELECT * INTO v_shift
  FROM cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash shift not found';
  END IF;

  IF v_shift.status = 'closed' THEN
    RAISE EXCEPTION 'Shift is already closed (closed at %)', v_shift.closing_time;
  END IF;

  -- Verify caller authorization
  SELECT * INTO v_caller_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = v_shift.restaurant_id
    AND is_active = TRUE;

  IF NOT FOUND AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You do not belong to this restaurant';
  END IF;

  v_closer_name := COALESCE(v_caller_staff.full_name, 'Cashier');

  -- Get Opener name
  SELECT full_name INTO v_opener_name
  FROM restaurant_staff
  WHERE auth_user_id = v_shift.opened_by
  LIMIT 1;

  -- Get restaurant details for fiscal Z-report
  SELECT * INTO v_restaurant
  FROM restaurants
  WHERE id = v_shift.restaurant_id;

  -- Calculate payments summary in shift window [v_shift.opening_time, v_now]
  SELECT
    COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method != 'cash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'bkash' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'nagad' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN payment_method = 'card' AND status IN ('completed', 'paid') THEN amount ELSE 0 END), 0.00)
  INTO
    v_cash_sales,
    v_digital_sales,
    v_bkash_sales,
    v_nagad_sales,
    v_card_sales
  FROM payments
  WHERE restaurant_id = v_shift.restaurant_id
    AND created_at >= v_shift.opening_time
    AND created_at <= v_now;

  -- Calculate order metrics in shift window
  SELECT
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'completed' AND order_type IN ('table', 'qr')),
    COUNT(*) FILTER (WHERE status = 'completed' AND order_type = 'counter'),
    COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN status = 'completed' THEN tax ELSE 0 END), 0.00),
    COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(discount, 0) ELSE 0 END), 0.00)
  INTO
    v_total_orders,
    v_voided_orders,
    v_dine_in_orders,
    v_takeaway_orders,
    v_total_sales,
    v_tax_collected,
    v_discount_total
  FROM orders
  WHERE restaurant_id = v_shift.restaurant_id
    AND created_at >= v_shift.opening_time
    AND created_at <= v_now;

  -- Calculate cash drawer reconciliation
  v_expected_cash := v_shift.opening_float + v_cash_sales;
  v_discrepancy := p_closing_count - v_expected_cash;

  -- Update shift record to closed
  UPDATE cash_shifts
  SET
    closed_by = v_caller_auth_id,
    status = 'closed',
    closing_time = v_now,
    closing_count = p_closing_count,
    expected_cash = v_expected_cash,
    discrepancy = v_discrepancy,
    total_sales = v_total_sales,
    cash_sales = v_cash_sales,
    digital_sales = v_digital_sales,
    tax_collected = v_tax_collected,
    discount_total = v_discount_total,
    total_orders = v_total_orders,
    voided_orders = v_voided_orders,
    notes = p_notes,
    updated_at = v_now
  WHERE id = p_shift_id;

  -- Return complete Z-Report payload
  RETURN jsonb_build_object(
    'success', true,
    'z_report_number', 'Z-' || TO_CHAR(v_now, 'YYYYMMDD') || '-' || SUBSTRING(p_shift_id::TEXT, 1, 8),
    'shift_id', p_shift_id,
    'status', 'closed',
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no
    ),
    'timings', jsonb_build_object(
      'opened_at', v_shift.opening_time,
      'closed_at', v_now,
      'opened_by', COALESCE(v_opener_name, 'Cashier'),
      'closed_by', v_closer_name
    ),
    'cash_reconciliation', jsonb_build_object(
      'opening_float', v_shift.opening_float,
      'cash_sales', v_cash_sales,
      'expected_cash', v_expected_cash,
      'actual_cash_counted', p_closing_count,
      'discrepancy', v_discrepancy,
      'is_balanced', (v_discrepancy = 0),
      'has_shortage', (v_discrepancy < 0),
      'has_overage', (v_discrepancy > 0)
    ),
    'sales_summary', jsonb_build_object(
      'gross_sales', v_total_sales,
      'cash_sales', v_cash_sales,
      'digital_sales', v_digital_sales,
      'bkash_sales', v_bkash_sales,
      'nagad_sales', v_nagad_sales,
      'card_sales', v_card_sales,
      'tax_collected', v_tax_collected,
      'discount_total', v_discount_total,
      'completed_orders_count', v_total_orders,
      'dine_in_orders_count', v_dine_in_orders,
      'takeaway_orders_count', v_takeaway_orders,
      'voided_orders_count', v_voided_orders
    ),
    'notes', p_notes
  );
END;
$$;

REVOKE ALL ON FUNCTION open_cash_shift(NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_cash_shift(NUMERIC, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION get_active_cash_shift(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_cash_shift(UUID) TO authenticated;

REVOKE ALL ON FUNCTION close_cash_shift(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_cash_shift(UUID, NUMERIC, TEXT) TO authenticated;
