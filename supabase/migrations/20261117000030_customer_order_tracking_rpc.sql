-- ==============================================================================
-- AmarMenu Migration: Public Customer Order Tracking Procedure
-- Version: 20261117000030_customer_order_tracking_rpc.sql
-- ==============================================================================

-- Secure function allowing customers to view live status of their placed order
CREATE OR REPLACE FUNCTION get_customer_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_restaurant RECORD;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Order ID is required');
  END IF;

  -- 1. Fetch order details
  SELECT 
    id,
    restaurant_id,
    order_number,
    order_type,
    table_number,
    customer_name,
    customer_phone,
    items,
    subtotal,
    tax,
    discount,
    total,
    status,
    payment_method,
    payment_status,
    customer_notes,
    created_at,
    accepted_at,
    preparing_at,
    ready_at,
    completed_at,
    cancelled_at
  INTO v_order
  FROM orders
  WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Order not found');
  END IF;

  -- 2. Fetch restaurant public branding & contact
  SELECT 
    id,
    name,
    name_bn,
    slug,
    phone,
    address,
    logo_url,
    vat_bin_no,
    currency,
    currency_symbol
  INTO v_restaurant
  FROM restaurants
  WHERE id = v_order.restaurant_id;

  -- 3. Return sanitized customer tracking payload
  RETURN jsonb_build_object(
    'found', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'order_type', v_order.order_type,
      'table_number', v_order.table_number,
      'customer_name', v_order.customer_name,
      'items', v_order.items,
      'subtotal', v_order.subtotal,
      'tax', v_order.tax,
      'discount', v_order.discount,
      'total', v_order.total,
      'status', v_order.status,
      'payment_method', v_order.payment_method,
      'payment_status', v_order.payment_status,
      'customer_notes', v_order.customer_notes,
      'created_at', v_order.created_at,
      'accepted_at', v_order.accepted_at,
      'preparing_at', v_order.preparing_at,
      'ready_at', v_order.ready_at,
      'completed_at', v_order.completed_at,
      'cancelled_at', v_order.cancelled_at
    ),
    'restaurant', jsonb_build_object(
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'slug', v_restaurant.slug,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'logo_url', v_restaurant.logo_url,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'currency', COALESCE(v_restaurant.currency, 'BDT'),
      'currency_symbol', COALESCE(v_restaurant.currency_symbol, '৳')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_order(UUID) TO anon, authenticated;
