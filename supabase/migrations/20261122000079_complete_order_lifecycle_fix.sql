-- ==============================================================================
-- Migration: Complete Order Lifecycle Fix (20261122000079_complete_order_lifecycle_fix.sql)
-- Ensures seamless transitions: pending -> accepted -> preparing -> ready -> served -> completed
-- ==============================================================================

-- 1. Ensure served_at column exists
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS served_at TIMESTAMPTZ;

-- 2. Update orders_status_check constraint to include 'served' and 'confirmed'
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (
  status = ANY (ARRAY[
    'pending'::text,
    'accepted'::text,
    'confirmed'::text,
    'preparing'::text,
    'ready'::text,
    'served'::text,
    'completed'::text,
    'cancelled'::text,
    'rejected'::text
  ])
);

-- 3. Enhance has_permission to ensure Owner & Super Admin always have full access
CREATE OR REPLACE FUNCTION public.has_permission(
  p_restaurant_id UUID,
  p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_user_role TEXT;
  v_has_perm BOOLEAN := FALSE;
  v_is_super BOOLEAN;
  v_current_role TEXT;
BEGIN
  BEGIN
    v_current_role := current_setting('role', true);
  EXCEPTION WHEN OTHERS THEN
    v_current_role := NULL;
  END;

  IF v_current_role = 'service_role' THEN
    RETURN TRUE;
  END IF;

  v_caller_auth_id := auth.uid();
  IF v_caller_auth_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT is_super_admin() INTO v_is_super;
  IF v_is_super IS TRUE THEN
    RETURN TRUE;
  END IF;

  SELECT role INTO v_user_role
  FROM restaurant_staff
  WHERE auth_user_id = v_caller_auth_id
    AND restaurant_id = p_restaurant_id
    AND is_active = TRUE
  LIMIT 1;

  IF v_user_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Owner always has full permission across all restaurant actions
  IF v_user_role = 'owner' THEN
    RETURN TRUE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role = v_user_role
      AND permission = p_permission
  ) INTO v_has_perm;

  RETURN COALESCE(v_has_perm, FALSE);
END;
$$;

-- 4. Fix validate_order_status_transition Trigger Function
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize status to lowercase
  NEW.status := lower(trim(NEW.status));
  IF NEW.status = 'confirmed' THEN
    NEW.status := 'accepted';
  END IF;

  -- Check if client is directly setting payment_status to 'paid' without settlement authorization
  IF (NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM 'paid'))
     OR (NEW.invoice_number IS NOT NULL AND (OLD.invoice_number IS DISTINCT FROM NEW.invoice_number)) THEN
    IF COALESCE(current_setting('amarmenu.settlement_authorized', true), 'off') <> 'on' THEN
      RAISE EXCEPTION 'Direct update prohibited: Bill settlement and payment verification must be performed via settle_order_bill or verified gateway callback'
        USING ERRCODE = 'P0007';
    END IF;
  END IF;

  -- If status is not changing, allow other valid updates (notes, items, metadata)
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allowed status transitions:
  IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'cancelled', 'rejected') THEN
    -- Valid: staff confirms, rejects, or order is cancelled
  ELSIF OLD.status IN ('accepted', 'confirmed') AND NEW.status IN ('preparing', 'ready', 'cancelled') THEN
    -- Valid: kitchen starts cooking, or marks ready directly, or order is cancelled
  ELSIF OLD.status = 'preparing' AND NEW.status IN ('ready', 'cancelled') THEN
    -- Valid: kitchen finishes cooking or cancelled
  ELSIF OLD.status = 'ready' AND NEW.status IN ('served', 'completed', 'cancelled') THEN
    -- Valid: waiter marks served, or counter/takeaway quick settle/completion, or cancelled
  ELSIF OLD.status = 'served' AND NEW.status IN ('completed', 'cancelled') THEN
    -- Valid: cashier/manager settles bill to completed, or manager voids/cancels
  ELSIF OLD.status = 'completed' AND NEW.status = 'cancelled' THEN
    -- ONLY allowed if authorized manager void override is active in current transaction
    IF COALESCE(current_setting('amarmenu.manager_void_in_progress', true), 'off') = 'on' THEN
      -- Valid: Authorized Manager Override via void_order_with_pin
    ELSE
      RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.status = 'completed' AND OLD.status IN ('pending', 'accepted', 'confirmed', 'preparing', 'ready', 'served') AND NEW.payment_status = 'paid' THEN
    -- Only allowed if authorized settlement is active
    IF COALESCE(current_setting('amarmenu.settlement_authorized', true), 'off') = 'on' THEN
      -- Valid: Authorized Auto-Settlement
    ELSE
      RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid order status transition from "%" to "%"', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Auto-populate transition timestamps
  IF NEW.status IN ('accepted', 'confirmed') AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at := NOW();
  ELSIF NEW.status = 'preparing' AND NEW.preparing_at IS NULL THEN
    NEW.preparing_at := NOW();
  ELSIF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN
    NEW.ready_at := NOW();
  ELSIF NEW.status = 'served' AND NEW.served_at IS NULL THEN
    NEW.served_at := NOW();
  ELSIF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
  ELSIF NEW.status IN ('cancelled', 'rejected') AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := NOW();
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- 5. Fix transition_order_status RPC
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

  SELECT id, restaurant_id, status, order_number, table_number, verified_by, waiter_name, accepted_by_name, cancellation_reason, rejection_reason
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
      -- Waiter, Cashier, Manager, Kitchen, Owner are all authorized to mark order as served
      IF NOT (
        has_permission(v_order.restaurant_id, 'confirm_order')
        OR has_permission(v_order.restaurant_id, 'settle_bill')
        OR has_permission(v_order.restaurant_id, 'update_kitchen_status')
      ) THEN
        RAISE EXCEPTION 'Permission denied: Your role cannot mark orders as served' USING ERRCODE = '42501';
      END IF;
    ELSIF v_normalized_status = 'completed' THEN
      IF NOT has_permission(v_order.restaurant_id, 'settle_bill') THEN
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

GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 6. Update sync_order_items_trigger to support 'served' table occupancy
CREATE OR REPLACE FUNCTION public.sync_order_items_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_item JSONB;
  v_qty INT;
  v_unit_price NUMERIC(10,2);
  v_line_total NUMERIC(10,2);
  v_size_name TEXT;
  v_size_price NUMERIC(10,2);
  v_addons JSONB;
  v_addons_price NUMERIC(10,2);
BEGIN
  -- If items column exists and is a valid json array
  IF NEW.items IS NOT NULL AND jsonb_typeof(NEW.items) = 'array' THEN
    DELETE FROM order_items WHERE order_id = NEW.id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      v_qty := COALESCE((v_item->>'quantity')::INT, 1);
      v_unit_price := COALESCE((v_item->>'base_price')::NUMERIC, (v_item->>'unit_price')::NUMERIC, 0.00);
      v_line_total := COALESCE((v_item->>'item_total')::NUMERIC, v_unit_price * v_qty);
      
      v_size_name := NULL;
      v_size_price := 0.00;
      IF v_item ? 'selected_size' AND v_item->'selected_size' IS NOT NULL AND jsonb_typeof(v_item->'selected_size') = 'object' THEN
        v_size_name := v_item->'selected_size'->>'name';
        v_size_price := COALESCE((v_item->'selected_size'->>'price')::NUMERIC, 0.00);
      END IF;

      v_addons := '[]'::jsonb;
      v_addons_price := 0.00;
      IF v_item ? 'selected_addons' AND v_item->'selected_addons' IS NOT NULL AND jsonb_typeof(v_item->'selected_addons') = 'array' THEN
        v_addons := v_item->'selected_addons';
        SELECT COALESCE(SUM((a->>'price')::NUMERIC), 0.00) INTO v_addons_price FROM jsonb_array_elements(v_addons) a;
      END IF;

      INSERT INTO order_items (
        order_id,
        restaurant_id,
        menu_item_id,
        item_name,
        quantity,
        unit_price,
        size_name,
        size_price,
        addons,
        addons_price,
        item_total,
        special_instructions
      ) VALUES (
        NEW.id,
        NEW.restaurant_id,
        CASE WHEN v_item ? 'menu_item_id' AND (v_item->>'menu_item_id') ~ '^[0-9a-fA-F-]{36}$' THEN (v_item->>'menu_item_id')::UUID ELSE NULL END,
        COALESCE(v_item->>'name', 'Item'),
        v_qty,
        v_unit_price,
        v_size_name,
        v_size_price,
        v_addons,
        v_addons_price,
        v_line_total,
        v_item->>'special_instructions'
      );
    END LOOP;
  END IF;

  -- Occupy table if dine-in order is active (including 'served')
  IF NEW.table_id IS NOT NULL AND NEW.status IN ('pending', 'accepted', 'confirmed', 'preparing', 'ready', 'served') THEN
    UPDATE restaurant_tables SET status = 'occupied' WHERE id = NEW.table_id;
  END IF;

  RETURN NEW;
END;
$$;
