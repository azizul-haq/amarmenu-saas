-- ==============================================================================
-- AmarMenu Migration: Cash Billing, Order Items, Payments & Table Reset
-- Version: 20261117000035_billing_and_payments.sql
-- ==============================================================================

-- 1. Add status column to restaurant_tables
ALTER TABLE restaurant_tables
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved'));

CREATE INDEX IF NOT EXISTS idx_tables_status ON restaurant_tables(restaurant_id, status);

-- 2. Create normalized order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  size_name TEXT,
  size_price NUMERIC(10,2) DEFAULT 0.00,
  addons JSONB DEFAULT '[]'::jsonb,
  addons_price NUMERIC(10,2) DEFAULT 0.00,
  item_total NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (item_total >= 0),
  special_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_restaurant ON order_items(restaurant_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select_staff" ON order_items;
CREATE POLICY "order_items_select_staff" ON order_items
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- 3. Automatic Synchronization Trigger: orders.items JSONB -> order_items rows
CREATE OR REPLACE FUNCTION sync_order_items_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
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

  -- Occupy table if dine-in order is active
  IF NEW.table_id IS NOT NULL AND NEW.status IN ('pending', 'accepted', 'preparing', 'ready') THEN
    UPDATE restaurant_tables SET status = 'occupied' WHERE id = NEW.table_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_items ON orders;
CREATE TRIGGER trg_sync_order_items
  AFTER INSERT OR UPDATE OF items, status, table_id ON orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_order_items_trigger();

-- Backfill existing orders into order_items via trigger
UPDATE orders SET updated_at = NOW() WHERE items IS NOT NULL;

-- 4. Create restaurant_invoice_sequences table
CREATE TABLE IF NOT EXISTS restaurant_invoice_sequences (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  current_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Add invoice & cash tender columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS invoice_number TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS tendered_amount NUMERIC(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS change_amount NUMERIC(10,2) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders(invoice_number);

-- 6. Create payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bkash', 'nagad', 'card', 'other')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  tendered_amount NUMERIC(10,2) DEFAULT NULL,
  change_amount NUMERIC(10,2) DEFAULT 0.00,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  collected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_restaurant ON payments(restaurant_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select_staff" ON payments;
CREATE POLICY "payments_select_staff" ON payments
  FOR SELECT
  TO authenticated
  USING (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "payments_insert_staff" ON payments;
CREATE POLICY "payments_insert_staff" ON payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    restaurant_id = current_restaurant_id()
    OR is_super_admin()
  );

-- 7. Atomic Settle Order Bill Procedure
CREATE OR REPLACE FUNCTION settle_order_bill(
  p_order_id UUID,
  p_payment_method TEXT DEFAULT 'cash',
  p_tendered_amount NUMERIC DEFAULT NULL,
  p_discount NUMERIC DEFAULT 0.00,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_order RECORD;
  v_restaurant RECORD;
  v_is_admin BOOLEAN;
  v_caller_restaurant_id UUID;
  
  v_discount NUMERIC(10,2);
  v_payable_total NUMERIC(10,2);
  v_tendered NUMERIC(10,2);
  v_change NUMERIC(10,2);
  
  v_next_seq BIGINT;
  v_date_str TEXT;
  v_invoice_number TEXT;
  v_payment_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to settle bill' USING ERRCODE = '42501';
  END IF;

  -- 1. Fetch order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Verify authorization
  SELECT is_super_admin() INTO v_is_admin;
  SELECT current_restaurant_id() INTO v_caller_restaurant_id;

  IF NOT v_is_admin AND (v_caller_restaurant_id IS NULL OR v_caller_restaurant_id <> v_order.restaurant_id) THEN
    RAISE EXCEPTION 'Unauthorized: You can only settle bills for your own restaurant' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'cancelled' OR v_order.status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot settle cancelled or rejected order' USING ERRCODE = 'P0003';
  END IF;

  IF v_order.payment_status = 'paid' AND v_order.invoice_number IS NOT NULL THEN
    RAISE EXCEPTION 'Order bill has already been settled with invoice %', v_order.invoice_number USING ERRCODE = 'P0004';
  END IF;

  -- 3. Calculate discount, payable total, tendered and change
  v_discount := GREATEST(0.00, COALESCE(p_discount, v_order.discount, 0.00));
  v_payable_total := GREATEST(0.00, v_order.subtotal + v_order.tax - v_discount);

  v_tendered := COALESCE(p_tendered_amount, v_payable_total);
  IF v_tendered < v_payable_total THEN
    RAISE EXCEPTION 'Tendered amount (৳%) is less than payable total (৳%)', v_tendered, v_payable_total USING ERRCODE = 'P0005';
  END IF;

  v_change := v_tendered - v_payable_total;

  -- 4. Generate gap-free sequential invoice number (INV-YYYYMMDD-XXXX)
  SELECT to_char(NOW() AT TIME ZONE 'Asia/Dhaka', 'YYYYMMDD') INTO v_date_str;

  INSERT INTO restaurant_invoice_sequences (restaurant_id, current_number, updated_at)
  VALUES (v_order.restaurant_id, 1, NOW())
  ON CONFLICT (restaurant_id) DO UPDATE
  SET current_number = restaurant_invoice_sequences.current_number + 1,
      updated_at = NOW()
  RETURNING current_number INTO v_next_seq;

  v_invoice_number := 'INV-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');

  -- 5. Update Order
  UPDATE orders
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    invoice_number = v_invoice_number,
    discount = v_discount,
    total = v_payable_total,
    tendered_amount = v_tendered,
    change_amount = v_change,
    payment_method = p_payment_method,
    payment_status = 'paid',
    last_updated_by = v_caller_id,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- 6. Insert into payments table
  INSERT INTO payments (
    restaurant_id,
    order_id,
    payment_method,
    amount,
    tendered_amount,
    change_amount,
    status,
    collected_by,
    notes
  ) VALUES (
    v_order.restaurant_id,
    v_order.id,
    p_payment_method,
    v_payable_total,
    v_tendered,
    v_change,
    'completed',
    v_caller_id,
    p_notes
  )
  RETURNING id INTO v_payment_id;

  -- 7. Reset Table Status to 'available'
  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'available',
        updated_at = NOW()
    WHERE id = v_order.table_id;
  END IF;

  -- Fetch restaurant metadata for receipt response
  SELECT name, name_bn, phone, address, vat_bin_no, trade_license_no
  INTO v_restaurant
  FROM restaurants
  WHERE id = v_order.restaurant_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'invoice_number', v_invoice_number,
    'subtotal', v_order.subtotal,
    'tax', v_order.tax,
    'discount', v_discount,
    'total', v_payable_total,
    'tendered_amount', v_tendered,
    'change_amount', v_change,
    'payment_method', p_payment_method,
    'table_reset', v_order.table_id IS NOT NULL,
    'settled_at', NOW(),
    'restaurant', jsonb_build_object(
      'name', v_restaurant.name,
      'name_bn', v_restaurant.name_bn,
      'phone', v_restaurant.phone,
      'address', v_restaurant.address,
      'vat_bin_no', v_restaurant.vat_bin_no,
      'trade_license_no', v_restaurant.trade_license_no
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION settle_order_bill(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settle_order_bill(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
