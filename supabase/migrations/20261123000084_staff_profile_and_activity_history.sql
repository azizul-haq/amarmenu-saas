-- Migration 20261123000084: Staff Profile & Role-Wise Activity History

-- 1. Create staff_activity_logs Table
CREATE TABLE IF NOT EXISTS public.staff_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  actor_user_id UUID NULL,
  actor_name TEXT NOT NULL DEFAULT 'Staff',
  actor_role TEXT NOT NULL DEFAULT 'staff',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for fast role-wise & team-wide querying
CREATE INDEX IF NOT EXISTS idx_staff_activity_restaurant_created 
  ON public.staff_activity_logs (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_activity_restaurant_actor 
  ON public.staff_activity_logs (restaurant_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_staff_activity_restaurant_action
  ON public.staff_activity_logs (restaurant_id, action, created_at DESC);

-- 3. Row Level Security (RLS)
ALTER TABLE public.staff_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff select own activity logs" ON public.staff_activity_logs;
CREATE POLICY "Staff select own activity logs"
ON public.staff_activity_logs FOR SELECT
TO authenticated
USING (
  (restaurant_id = current_restaurant_id() AND actor_user_id = auth.uid())
  OR (is_super_admin())
  OR (
    restaurant_id = current_restaurant_id() 
    AND EXISTS (
      SELECT 1 FROM restaurant_staff 
      WHERE auth_user_id = auth.uid() 
        AND restaurant_id = staff_activity_logs.restaurant_id 
        AND role IN ('owner', 'manager') 
        AND is_active = TRUE
    )
  )
);

DROP POLICY IF EXISTS "Staff insert activity logs" ON public.staff_activity_logs;
CREATE POLICY "Staff insert activity logs"
ON public.staff_activity_logs FOR INSERT
TO authenticated
WITH CHECK (
  restaurant_id = current_restaurant_id() OR is_super_admin()
);

GRANT SELECT, INSERT ON public.staff_activity_logs TO authenticated;

-- 4. Internal Logger Helper
CREATE OR REPLACE FUNCTION public.log_staff_activity_internal(
  p_restaurant_id UUID,
  p_actor_user_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_summary TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_log_id UUID;
  v_name TEXT;
  v_role TEXT;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_actor_user_id IS NOT NULL THEN
    SELECT full_name, role INTO v_name, v_role
    FROM restaurant_staff
    WHERE auth_user_id = p_actor_user_id
      AND restaurant_id = p_restaurant_id
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  IF v_name IS NULL THEN
    IF p_actor_user_id IS NOT NULL AND is_super_admin() THEN
      v_name := 'Super Admin';
      v_role := 'super_admin';
    ELSE
      v_name := COALESCE(
        (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p_actor_user_id),
        'Staff'
      );
      v_role := 'staff';
    END IF;
  END IF;

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
  )
  VALUES (
    p_restaurant_id,
    p_actor_user_id,
    v_name,
    v_role,
    p_action,
    p_entity_type,
    p_entity_id,
    p_summary,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- 5. Public RPC for Client Activity Logging
CREATE OR REPLACE FUNCTION public.log_staff_activity(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_summary TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_restaurant_id UUID;
  v_log_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_restaurant_id := current_restaurant_id();
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Active restaurant context required' USING ERRCODE = '42501';
  END IF;

  v_log_id := log_staff_activity_internal(
    v_restaurant_id,
    v_caller_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_summary,
    p_metadata
  );

  RETURN jsonb_build_object('success', TRUE, 'log_id', v_log_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_staff_activity TO authenticated;

-- 6. RPC: update_my_profile (Allows staff to update their own full_name & phone safely)
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_staff_id UUID;
  v_cleaned_name TEXT;
  v_cleaned_phone TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_cleaned_name := trim(p_full_name);
  v_cleaned_phone := trim(p_phone);

  IF v_cleaned_name = '' OR length(v_cleaned_name) < 2 THEN
    RAISE EXCEPTION 'Name must be at least 2 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.restaurant_staff
  SET
    full_name = v_cleaned_name,
    phone = NULLIF(v_cleaned_phone, ''),
    updated_at = now()
  WHERE auth_user_id = v_caller_id
  RETURNING id INTO v_staff_id;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff profile not found' USING ERRCODE = 'P0002';
  END IF;

  -- Also sync full_name in auth user metadata if possible
  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{full_name}',
    to_jsonb(v_cleaned_name)
  )
  WHERE id = v_caller_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'full_name', v_cleaned_name,
    'phone', v_cleaned_phone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT) TO authenticated;

-- 7. Trigger on Orders (Automated order state transition logging)
CREATE OR REPLACE FUNCTION public.trg_log_order_status_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_action TEXT;
  v_summary TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'accepted', 'confirmed' THEN
      v_action := 'order_accepted';
      v_summary := 'Confirmed order #' || NEW.order_number || 
        COALESCE(' (Table ' || NEW.table_number || ')', '');
    WHEN 'preparing' THEN
      v_action := 'order_preparing';
      v_summary := 'Started preparing order #' || NEW.order_number;
    WHEN 'ready' THEN
      v_action := 'order_ready';
      v_summary := 'Marked order #' || NEW.order_number || ' ready for pickup';
    WHEN 'served' THEN
      v_action := 'order_served';
      v_summary := 'Served order #' || NEW.order_number || 
        COALESCE(' (Table ' || NEW.table_number || ')', '');
    WHEN 'completed' THEN
      v_action := 'bill_settled';
      v_summary := 'Settled bill & finalized order #' || NEW.order_number ||
        COALESCE(' [৳' || NEW.total::text || ' via ' || COALESCE(NEW.payment_method, 'cash') || ']', '');
    WHEN 'cancelled' THEN
      v_action := 'order_voided';
      v_summary := 'Voided/cancelled order #' || NEW.order_number ||
        COALESCE(': ' || NEW.cancellation_reason, '');
    WHEN 'rejected' THEN
      v_action := 'order_rejected';
      v_summary := 'Rejected order #' || NEW.order_number ||
        COALESCE(': ' || NEW.rejection_reason, '');
    ELSE
      v_action := 'order_status_' || NEW.status;
      v_summary := 'Updated order #' || NEW.order_number || ' to ' || NEW.status;
  END CASE;

  PERFORM public.log_staff_activity_internal(
    NEW.restaurant_id,
    v_caller_id,
    v_action,
    'order',
    NEW.id,
    v_summary,
    jsonb_build_object(
      'order_number', NEW.order_number,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'table_number', NEW.table_number,
      'total', NEW.total,
      'payment_method', NEW.payment_method
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_staff_activity ON public.orders;
CREATE TRIGGER trg_orders_staff_activity
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_order_status_activity();

-- 8. Trigger on Menu Item stock toggling
CREATE OR REPLACE FUNCTION public.trg_log_menu_item_stock_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_summary TEXT;
BEGIN
  IF NEW.is_available IS NOT DISTINCT FROM OLD.is_available THEN
    RETURN NEW;
  END IF;

  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_available THEN
    v_summary := 'Restocked / marked in-stock: ' || NEW.name;
  ELSE
    v_summary := 'Marked sold out / unavailable: ' || NEW.name;
  END IF;

  PERFORM public.log_staff_activity_internal(
    NEW.restaurant_id,
    v_caller_id,
    'menu_stock_toggled',
    'menu_item',
    NEW.id,
    v_summary,
    jsonb_build_object(
      'item_name', NEW.name,
      'is_available', NEW.is_available
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_menu_items_stock_activity ON public.menu_items;
CREATE TRIGGER trg_menu_items_stock_activity
AFTER UPDATE OF is_available ON public.menu_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_menu_item_stock_activity();

-- 9. Trigger on Cash Shifts (Shift open & close)
CREATE OR REPLACE FUNCTION public.trg_log_cash_shift_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();

  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_staff_activity_internal(
      NEW.restaurant_id,
      COALESCE(v_caller_id, NEW.opened_by_user_id),
      'shift_opened',
      'cash_shift',
      NEW.id,
      'Opened cash shift with float ৳' || COALESCE(NEW.opening_float::text, '0.00'),
      jsonb_build_object(
        'opening_float', NEW.opening_float,
        'shift_id', NEW.id
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
      PERFORM public.log_staff_activity_internal(
        NEW.restaurant_id,
        COALESCE(v_caller_id, NEW.closed_by_user_id),
        'shift_closed',
        'cash_shift',
        NEW.id,
        'Closed cash shift (Counted: ৳' || COALESCE(NEW.actual_cash_counted::text, '0.00') || 
        ', Expected: ৳' || COALESCE(NEW.system_expected_cash::text, '0.00') || ')',
        jsonb_build_object(
          'actual_cash_counted', NEW.actual_cash_counted,
          'system_expected_cash', NEW.system_expected_cash,
          'discrepancy', NEW.discrepancy,
          'shift_id', NEW.id
        )
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_shifts_activity ON public.cash_shifts;
CREATE TRIGGER trg_cash_shifts_activity
AFTER INSERT OR UPDATE OF status ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_cash_shift_activity();

-- 10. Trigger on Staff Management (Added, Deactivated, Activated, Role Changed)
CREATE OR REPLACE FUNCTION public.trg_log_restaurant_staff_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID;
  v_action TEXT;
  v_summary TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'staff_added';
    v_summary := 'Added team member: ' || NEW.full_name || ' (' || NEW.role || ')';
    PERFORM public.log_staff_activity_internal(
      NEW.restaurant_id,
      v_caller_id,
      v_action,
      'staff',
      NEW.id,
      v_summary,
      jsonb_build_object('staff_name', NEW.full_name, 'role', NEW.role, 'email', NEW.email)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF NOT NEW.is_active THEN
        v_action := 'staff_deactivated';
        v_summary := 'Deactivated team member: ' || NEW.full_name || ' (' || NEW.role || ')';
      ELSE
        v_action := 'staff_activated';
        v_summary := 'Reactivated team member: ' || NEW.full_name || ' (' || NEW.role || ')';
      END IF;
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
      v_action := 'staff_role_changed';
      v_summary := 'Changed role of ' || NEW.full_name || ' from ' || OLD.role || ' to ' || NEW.role;
    ELSE
      v_action := 'staff_updated';
      v_summary := 'Updated profile details for ' || NEW.full_name;
    END IF;

    PERFORM public.log_staff_activity_internal(
      NEW.restaurant_id,
      v_caller_id,
      v_action,
      'staff',
      NEW.id,
      v_summary,
      jsonb_build_object('staff_name', NEW.full_name, 'role', NEW.role)
    );
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_management_activity ON public.restaurant_staff;
CREATE TRIGGER trg_staff_management_activity
AFTER INSERT OR UPDATE ON public.restaurant_staff
FOR EACH ROW
EXECUTE FUNCTION public.trg_log_restaurant_staff_activity();
