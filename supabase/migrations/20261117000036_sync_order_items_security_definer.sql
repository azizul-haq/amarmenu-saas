-- Migration 36: Make sync_order_items_trigger SECURITY DEFINER so that internal order item synchronization succeeds regardless of caller context
CREATE OR REPLACE FUNCTION sync_order_items_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
