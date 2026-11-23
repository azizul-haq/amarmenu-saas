-- Migration 20261123000085: Post-Service Hybrid Payment Workflow (Cash vs. Online Sandbox Pay)
-- Adds process_customer_sandbox_payment and select_customer_cash_payment RPCs

-- 1. Ensure payments table supports vat_amount and status checks
ALTER TABLE public.payments 
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2) DEFAULT 0.00;

ALTER TABLE public.payments 
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments 
  ADD CONSTRAINT payments_status_check 
  CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'paid'::text, 'refunded'::text, 'failed'::text]));

-- 2. Customer Sandbox Payment RPC
CREATE OR REPLACE FUNCTION public.process_customer_sandbox_payment(
  p_order_id UUID,
  p_method TEXT,
  p_sender_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order RECORD;
  v_method TEXT;
  v_trx_id TEXT;
  v_date_str TEXT;
  v_next_seq BIGINT;
  v_invoice_number TEXT;
  v_payment_id UUID;
  v_shift_id UUID;
  v_restaurant RECORD;
BEGIN
  -- Authorize settlement for this transaction (bypasses order update security triggers)
  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order ID is required' USING ERRCODE = 'P0001';
  END IF;

  v_method := lower(trim(COALESCE(p_method, 'bkash')));
  IF v_method NOT IN ('bkash', 'nagad', 'sslcommerz', 'card') THEN
    RAISE EXCEPTION 'Invalid payment method "%". Allowed: bkash, nagad, sslcommerz', v_method USING ERRCODE = 'P0005';
  END IF;

  -- Lock order row
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot settle cancelled or rejected order' USING ERRCODE = 'P0003';
  END IF;

  IF v_order.status = 'completed' AND v_order.payment_status = 'paid' THEN
    SELECT name, name_bn, phone, address, vat_bin_no
    INTO v_restaurant
    FROM public.restaurants
    WHERE id = v_order.restaurant_id;

    RETURN jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'message', 'Order bill has already been settled',
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'invoice_number', v_order.invoice_number,
      'transaction_id', v_order.payment_transaction_id,
      'method', v_order.payment_method,
      'amount', v_order.total,
      'subtotal', v_order.subtotal,
      'tax', v_order.tax,
      'discount', v_order.discount,
      'table_number', v_order.table_number,
      'settled_at', v_order.completed_at,
      'restaurant', jsonb_build_object(
        'name', v_restaurant.name,
        'name_bn', v_restaurant.name_bn,
        'phone', v_restaurant.phone,
        'address', v_restaurant.address,
        'vat_bin_no', v_restaurant.vat_bin_no
      )
    );
  END IF;

  -- Generate realistic sandbox transaction ID (e.g. SBX-BKASH-8F3A21)
  v_trx_id := 'SBX-' || upper(v_method) || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));

  -- Generate invoice number if not already generated
  IF v_order.invoice_number IS NOT NULL THEN
    v_invoice_number := v_order.invoice_number;
  ELSE
    SELECT to_char(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') INTO v_date_str;

    INSERT INTO public.restaurant_invoice_sequences (restaurant_id, current_number, updated_at)
    VALUES (v_order.restaurant_id, 1, NOW())
    ON CONFLICT (restaurant_id) DO UPDATE
    SET current_number = public.restaurant_invoice_sequences.current_number + 1,
        updated_at = NOW()
    RETURNING current_number INTO v_next_seq;

    v_invoice_number := 'INV-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');
  END IF;

  -- Insert verified payment record
  INSERT INTO public.payments (
    restaurant_id,
    order_id,
    payment_method,
    amount,
    vat_amount,
    tendered_amount,
    change_amount,
    transaction_id,
    status,
    notes
  ) VALUES (
    v_order.restaurant_id,
    v_order.id,
    v_method,
    v_order.total,
    COALESCE(v_order.tax, 0.00),
    v_order.total,
    0.00,
    v_trx_id,
    'completed',
    'Customer Online Sandbox Payment via ' || upper(v_method) || ' (Sender: ' || COALESCE(p_sender_number, 'Sandbox Test Account') || ')'
  )
  RETURNING id INTO v_payment_id;

  -- Update order to completed and paid
  UPDATE public.orders
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    invoice_number = v_invoice_number,
    payment_method = v_method,
    payment_status = 'paid',
    payment_transaction_id = v_trx_id,
    tendered_amount = v_order.total,
    change_amount = 0.00,
    updated_at = NOW()
  WHERE id = v_order.id;

  -- Automatically release the table so it becomes available immediately
  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.restaurant_tables
    SET status = 'available',
        updated_at = NOW()
    WHERE id = v_order.table_id;
  END IF;

  -- Tally in active cash shift if open
  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE restaurant_id = v_order.restaurant_id AND status = 'open'
  ORDER BY opening_time DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    UPDATE public.cash_shifts
    SET
      digital_sales = digital_sales + v_order.total,
      total_sales = total_sales + v_order.total,
      total_orders = total_orders + 1,
      updated_at = NOW()
    WHERE id = v_shift_id;
  END IF;

  -- Insert order status history
  INSERT INTO public.order_status_history (
    order_id,
    restaurant_id,
    from_status,
    to_status,
    changed_by,
    notes
  ) VALUES (
    v_order.id,
    v_order.restaurant_id,
    v_order.status,
    'completed',
    NULL,
    'Customer Sandbox Online Payment via ' || upper(v_method) || ' (' || v_trx_id || ')'
  );

  -- Log in staff_activity_logs
  INSERT INTO public.staff_activity_logs (
    restaurant_id,
    actor_user_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  ) VALUES (
    v_order.restaurant_id,
    NULL,
    COALESCE(v_order.customer_name, 'Guest Customer'),
    'customer',
    'bill_settled',
    'order',
    v_order.id,
    'Order #' || v_order.order_number || ' paid online via ' || upper(v_method) || ' (' || v_trx_id || ')',
    jsonb_build_object(
      'method', v_method,
      'transaction_id', v_trx_id,
      'amount', v_order.total,
      'invoice_number', v_invoice_number,
      'sandbox', true
    )
  );

  -- Retrieve restaurant details for receipt
  SELECT name, name_bn, phone, address, vat_bin_no
  INTO v_restaurant
  FROM public.restaurants
  WHERE id = v_order.restaurant_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_invoice_number,
    'transaction_id', v_trx_id,
    'payment_id', v_payment_id,
    'method', v_method,
    'gateway', v_method,
    'amount', v_order.total,
    'subtotal', v_order.subtotal,
    'tax', v_order.tax,
    'discount', v_order.discount,
    'table_number', v_order.table_number,
    'table_released', v_order.table_id IS NOT NULL,
    'settled_at', NOW(),
    'restaurant', jsonb_build_object(
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'vat_bin_no', v_restaurant.vat_bin_no
    )
  );
END;
$function$;

-- 3. Customer Cash Payment Preference RPC
CREATE OR REPLACE FUNCTION public.select_customer_cash_payment(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order ID is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status IN ('completed', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot select cash payment for order in % status', v_order.status USING ERRCODE = 'P0003';
  END IF;

  UPDATE public.orders
  SET
    payment_method = 'cash',
    updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'payment_method', 'cash',
    'message', 'Cash payment selected'
  );
END;
$function$;

-- 4. Grant execution permissions to anon and authenticated
GRANT EXECUTE ON FUNCTION public.process_customer_sandbox_payment(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.select_customer_cash_payment(UUID) TO anon, authenticated, service_role;
