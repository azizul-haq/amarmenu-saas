-- Migration: 20261125000089_fix_payment_timing_dinein_vs_takeaway.sql
-- Description: Fix payment timing and order completion logic for dine_in vs takeaway orders.
-- 1. Dine-in: Customer payment strictly restricted to 'served' status. Upon payment: status='completed', payment_status='paid', table released.
-- 2. Takeaway: Upfront payment allowed while order is active. Upon payment: payment_status='paid', keep current kitchen status (DO NOT complete yet) so parcel is prepared and handed over.
-- 3. Transition order status allows staff to mark paid orders as 'completed' upon physical handover.

-- 1. Update process_customer_sandbox_payment RPC
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
  v_is_takeaway BOOLEAN;
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

  -- Determine if takeaway vs dine_in
  v_is_takeaway := lower(COALESCE(v_order.order_type, '')) IN ('takeaway', 'counter') AND v_order.table_id IS NULL;

  -- Check if already paid
  IF v_order.payment_status = 'paid' THEN
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
      'status', v_order.status,
      'payment_status', 'paid',
      'order_type', v_order.order_type,
      'is_takeaway', v_is_takeaway,
      'settled_at', COALESCE(v_order.completed_at, v_order.updated_at),
      'restaurant', jsonb_build_object(
        'name', v_restaurant.name,
        'name_bn', v_restaurant.name_bn,
        'phone', v_restaurant.phone,
        'address', v_restaurant.address,
        'vat_bin_no', v_restaurant.vat_bin_no
      )
    );
  END IF;

  IF v_order.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot settle cancelled or rejected order' USING ERRCODE = 'P0003';
  END IF;

  -- Timing rules check based on order_type
  IF NOT v_is_takeaway THEN
    -- DINE-IN: Only allow settlement after food is served
    IF v_order.status <> 'served' THEN
      RAISE EXCEPTION 'Payment is only allowed after your meal has been served (current status: %)', v_order.status USING ERRCODE = 'P0004';
    END IF;
  ELSE
    -- TAKEAWAY: Allow upfront payment while order is active
    IF v_order.status NOT IN ('pending', 'confirmed', 'accepted', 'preparing', 'ready', 'served') THEN
      RAISE EXCEPTION 'Cannot pay for takeaway order in status %', v_order.status USING ERRCODE = 'P0004';
    END IF;
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

  -- Update order according to order_type
  IF NOT v_is_takeaway THEN
    -- DINE-IN: Set completed, paid, and release table
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

    -- Automatically release the table
    IF v_order.table_id IS NOT NULL THEN
      UPDATE public.restaurant_tables
      SET status = 'available',
          updated_at = NOW()
      WHERE id = v_order.table_id;
    END IF;
  ELSE
    -- TAKEAWAY: Keep current kitchen/order status! Update payment_status = 'paid' without completing order
    UPDATE public.orders
    SET
      payment_method = v_method,
      payment_status = 'paid',
      payment_transaction_id = v_trx_id,
      invoice_number = v_invoice_number,
      tendered_amount = v_order.total,
      change_amount = 0.00,
      updated_at = NOW()
    WHERE id = v_order.id;
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

  -- Insert order status history if status changed (dine-in)
  IF NOT v_is_takeaway THEN
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
      'Customer Online Sandbox Payment via ' || upper(v_method) || ' (' || v_trx_id || ')'
    );
  END IF;

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
    'Order #' || v_order.order_number || ' paid online via ' || upper(v_method) || ' (' || v_trx_id || ')' ||
      CASE WHEN v_is_takeaway THEN ' [Prepaid Takeaway]' ELSE ' [Dine-In Settled]' END,
    jsonb_build_object(
      'method', v_method,
      'transaction_id', v_trx_id,
      'amount', v_order.total,
      'invoice_number', v_invoice_number,
      'is_takeaway', v_is_takeaway,
      'order_type', v_order.order_type,
      'sandbox', true
    )
  );

  -- Fetch restaurant metadata for return receipt
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
    'order_type', v_order.order_type,
    'is_takeaway', v_is_takeaway,
    'status', CASE WHEN v_is_takeaway THEN v_order.status ELSE 'completed' END,
    'payment_status', 'paid',
    'table_released', (NOT v_is_takeaway AND v_order.table_id IS NOT NULL),
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

-- 2. Update select_customer_cash_payment timing logic
CREATE OR REPLACE FUNCTION public.select_customer_cash_payment(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order RECORD;
  v_is_takeaway BOOLEAN;
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

  v_is_takeaway := lower(COALESCE(v_order.order_type, '')) IN ('takeaway', 'counter') AND v_order.table_id IS NULL;

  IF NOT v_is_takeaway THEN
    -- Dine-in requires served status before cash preference confirmation
    IF v_order.status <> 'served' THEN
      RAISE EXCEPTION 'Cash payment can only be requested after your food is served (current status: %)', v_order.status USING ERRCODE = 'P0004';
    END IF;
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

-- 3. Update transition_order_status to allow handover completion of prepaid orders
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id UUID,
  p_new_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_payment_transaction_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_is_super BOOLEAN;
  v_order RECORD;
  v_staff RECORD;
  v_staff_name TEXT;
  v_normalized_status TEXT;
BEGIN
  v_caller_id := auth.uid();
  SELECT is_super_admin() INTO v_is_super;

  IF v_caller_id IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_normalized_status := lower(trim(p_new_status));
  IF v_normalized_status = 'confirmed' THEN
    v_normalized_status := 'accepted';
  END IF;

  SELECT id, restaurant_id, status, payment_status, order_number, table_number, table_id, verified_by, waiter_name, accepted_by_name, cancellation_reason, rejection_reason
  INTO v_order
  FROM orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_super THEN
    IF current_restaurant_id() <> v_order.restaurant_id THEN
      RAISE EXCEPTION 'Unauthorized: You can only transition orders for your own restaurant' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Role-based transition authorization
  IF NOT v_is_super THEN
    IF v_normalized_status IN ('accepted', 'rejected') THEN
      IF NOT has_permission(v_order.restaurant_id, 'confirm_order') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot confirm or reject orders' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status IN ('preparing', 'ready') THEN
      IF NOT has_permission(v_order.restaurant_id, 'update_kitchen_status') THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot update kitchen status' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'served' THEN
      -- Waiter, Cashier, Manager, Owner are authorized (Kitchen is strictly excluded)
      IF NOT (
        has_permission(v_order.restaurant_id, 'confirm_order')
        OR has_permission(v_order.restaurant_id, 'settle_bill')
      ) THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot mark orders as served' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'completed' THEN
      -- Settle bill role, OR if order is already paid (e.g. prepaid takeaway handover), confirm_order role can complete it
      IF NOT (
        has_permission(v_order.restaurant_id, 'settle_bill')
        OR (v_order.payment_status = 'paid' AND has_permission(v_order.restaurant_id, 'confirm_order'))
      ) THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot complete orders' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'cancelled' THEN
      IF NOT (
        has_permission(v_order.restaurant_id, 'void_order')
        OR (v_order.status = 'pending' AND has_permission(v_order.restaurant_id, 'confirm_order'))
      ) THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot cancel orders' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  SELECT id, full_name, role INTO v_staff
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_id AND restaurant_id = v_order.restaurant_id
  LIMIT 1;

  v_staff_name := COALESCE(v_staff.full_name, 'Staff');

  PERFORM set_config('amarmenu.settlement_authorized', 'on', true);

  UPDATE orders
  SET
    status = v_normalized_status,
    completed_at = CASE WHEN v_normalized_status = 'completed' AND completed_at IS NULL THEN NOW() ELSE completed_at END,
    verified_by = CASE WHEN v_normalized_status = 'accepted' AND verified_by IS NULL THEN v_caller_id ELSE verified_by END,
    waiter_name = CASE WHEN (v_normalized_status IN ('accepted', 'served')) AND (waiter_name IS NULL OR waiter_name = '') THEN v_staff_name ELSE waiter_name END,
    accepted_by_name = CASE WHEN v_normalized_status = 'accepted' AND (accepted_by_name IS NULL OR accepted_by_name = '') THEN v_staff_name ELSE accepted_by_name END,
    served_at = CASE WHEN v_normalized_status = 'served' AND served_at IS NULL THEN NOW() ELSE served_at END,
    rejection_reason = CASE WHEN v_normalized_status = 'rejected' THEN COALESCE(p_notes, rejection_reason) ELSE rejection_reason END,
    cancellation_reason = CASE WHEN v_normalized_status = 'cancelled' THEN COALESCE(p_notes, cancellation_reason) ELSE cancellation_reason END,
    payment_method = COALESCE(p_payment_method, payment_method),
    payment_status = COALESCE(p_payment_status, payment_status),
    payment_transaction_id = COALESCE(p_payment_transaction_id, payment_transaction_id),
    updated_at = NOW()
  WHERE id = p_order_id;

  -- If order completed and had a table, release it
  IF v_normalized_status = 'completed' AND v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available',
        updated_at = NOW()
    WHERE id = v_order.table_id;
  END IF;

  INSERT INTO order_status_history (
    order_id,
    restaurant_id,
    from_status,
    to_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    v_order.restaurant_id,
    v_order.status,
    v_normalized_status,
    v_caller_id,
    p_notes
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', v_normalized_status,
    'waiter_name', v_staff_name
  );
END;
$$;

-- 4. Permissions & PostgREST reload
GRANT EXECUTE ON FUNCTION public.process_customer_sandbox_payment(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.select_customer_cash_payment(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
