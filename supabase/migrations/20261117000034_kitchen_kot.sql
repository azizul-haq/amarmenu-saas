-- ==============================================================================
-- AmarMenu Migration: Kitchen KDS & KOT Print Tracking
-- Version: 20261117000034_kitchen_kot.sql
-- ==============================================================================

-- 1. Add KOT tracking columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS kot_printed_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS kot_print_count INT NOT NULL DEFAULT 0;

-- 2. Procedure to atomically record KOT print
CREATE OR REPLACE FUNCTION record_kot_print(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_order RECORD;
  v_is_admin BOOLEAN;
  v_caller_restaurant_id UUID;
  v_new_count INT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to print KOT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT is_super_admin() INTO v_is_admin;
  SELECT current_restaurant_id() INTO v_caller_restaurant_id;

  IF NOT v_is_admin AND (v_caller_restaurant_id IS NULL OR v_caller_restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only print KOT for your own restaurant' USING ERRCODE = '42501';
  END IF;

  UPDATE orders
  SET
    kot_printed_at = NOW(),
    kot_print_count = COALESCE(kot_print_count, 0) + 1,
    updated_at = NOW()
  WHERE id = p_order_id
  RETURNING kot_print_count INTO v_new_count;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'kot_print_count', v_new_count,
    'kot_printed_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION record_kot_print(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_kot_print(UUID) TO authenticated;
