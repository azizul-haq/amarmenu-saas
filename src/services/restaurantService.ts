import { supabase } from "../config/supabase";
import type {
  Order,
  OrderItem,
  MenuItem,
  MenuCategory,
  RestaurantTable,
  Payment,
  OrderItemRecord,
} from "../config/supabase";

/**
 * Restaurant API Service
 * All restaurant dashboard operations with real-time support
 */

// Subscribe to restaurant's orders with real-time updates
export const subscribeToOrders = (
  restaurantId: string,
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void
) => {
  let isCancelled = false;

  const fetchOrders = async () => {
    try {
      if (isCancelled) return;

      // Ensure active authenticated Supabase session before querying RLS orders table
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        console.warn("fetchOrders: active Supabase session not ready yet, waiting 150ms before query...");
        await new Promise((r) => setTimeout(r, 150));
      }

      if (isCancelled) return;

      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (isCancelled) return;

      if (error) {
        console.error("fetchOrders Supabase error:", error);
        onError?.(new Error(error.message));
      } else {
        callback(data || []);
      }
    } catch (err: unknown) {
      if (isCancelled) return;
      console.error("fetchOrders exception:", err);
      onError?.(err instanceof Error ? err : new Error("Failed to fetch orders"));
    }
  };

  fetchOrders();

  const channelName = `restaurant-orders-${restaurantId}-${Math.random().toString(36).substring(2, 7)}`;
  const subscription = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        if (!isCancelled) fetchOrders();
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      isCancelled = true;
      supabase.removeChannel(subscription);
    },
  };
};

// Subscribe to active kitchen orders (accepted, preparing, ready)
export const subscribeToKitchenOrders = (
  restaurantId: string,
  callback: (orders: Order[]) => void,
  onError?: (error: Error) => void
) => {
  let isCancelled = false;

  const fetchKitchenOrders = async () => {
    try {
      if (isCancelled) return;

      // Ensure active authenticated Supabase session before querying RLS orders table
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        console.warn("fetchKitchenOrders: active Supabase session not ready yet, waiting 150ms before query...");
        await new Promise((r) => setTimeout(r, 150));
      }

      if (isCancelled) return;

      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          restaurant_id,
          order_number,
          order_type,
          table_number,
          status,
          customer_notes,
          created_at,
          updated_at,
          accepted_at,
          preparing_at,
          ready_at,
          kot_printed_at,
          kot_print_count,
          items
        `)
        .eq("restaurant_id", restaurantId)
        .in("status", ["accepted", "preparing", "ready"])
        .order("created_at", { ascending: true })
        .limit(100);

      if (isCancelled) return;

      if (error) {
        console.error("fetchKitchenOrders Supabase error:", error);
        onError?.(new Error(error.message));
      } else if (data) {
        // Strip financial properties from order and items
        const sanitized = data.map((order: any) => ({
          ...order,
          subtotal: undefined,
          tax: undefined,
          discount: undefined,
          total: undefined,
          tendered_amount: undefined,
          change_amount: undefined,
          payment_method: undefined,
          payment_status: undefined,
          payment_transaction_id: undefined,
          invoice_number: undefined,
          items: Array.isArray(order.items)
            ? order.items.map((i: any) => ({
                name: i.name || i.item_name,
                quantity: i.quantity,
                special_instructions: i.special_instructions || i.notes,
                size_name: i.size_name,
                addons: i.addons,
              }))
            : order.items,
        }));
        callback(sanitized as Order[]);
      }
    } catch (err: unknown) {
      if (isCancelled) return;
      console.error("fetchKitchenOrders exception:", err);
      onError?.(err instanceof Error ? err : new Error("Failed to fetch kitchen orders"));
    }
  };

  fetchKitchenOrders();

  const channelName = `restaurant-kitchen-${restaurantId}-${Math.random().toString(36).substring(2, 7)}`;
  const subscription = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        if (!isCancelled) fetchKitchenOrders();
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      isCancelled = true;
      supabase.removeChannel(subscription);
    },
  };
};

export interface TransitionOrderResult {
  success: boolean;
  data?: {
    order_id: string;
    from_status: string;
    to_status: string;
    updated_at: string;
  };
  error?: string;
}

export interface OrderStatusHistoryItem {
  id: string;
  order_id: string;
  restaurant_id: string;
  from_status: string;
  to_status: string;
  changed_by?: string | null;
  notes?: string | null;
  created_at: string;
}

// Update order status via server-enforced state machine RPC
export const updateOrderStatus = async (
  orderId: string,
  status: Order["status"],
  notes?: string,
  paymentData?: {
    paymentMethod?: string;
    paymentStatus?: string;
    transactionId?: string;
  }
): Promise<TransitionOrderResult> => {
  const { data, error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_new_status: status,
    p_notes: notes || null,
    p_payment_method: paymentData?.paymentMethod || null,
    p_payment_status: paymentData?.paymentStatus || null,
    p_payment_transaction_id: paymentData?.transactionId || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
};

// Get order transition audit history
export const getOrderStatusHistory = async (
  orderId: string
): Promise<OrderStatusHistoryItem[]> => {
  const { data, error } = await supabase
    .from("order_status_history")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return data;
};

// Record KOT printing event atomically
export const recordKOTPrint = async (
  orderId: string
): Promise<{ success: boolean; kot_print_count?: number; error?: string }> => {
  const { data, error } = await supabase.rpc("record_kot_print", {
    p_order_id: orderId,
  });

  if (error || !data) {
    return { success: false, error: error?.message || "Failed to record KOT print" };
  }

  return { success: true, kot_print_count: data.kot_print_count };
};

// Subscribe to restaurant categories with real-time updates
export const subscribeToCategories = (
  restaurantId: string,
  callback: (categories: MenuCategory[]) => void
) => {
  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from("menu_categories")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("display_order", { ascending: true });

    if (!error && data) {
      callback(data as MenuCategory[]);
    }
  };

  fetchCategories();

  const subscription = supabase
    .channel(`restaurant-categories-${restaurantId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "menu_categories",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        fetchCategories();
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(subscription);
    },
  };
};

// Create category
export const createCategory = async (category: Partial<MenuCategory>) => {
  const { data, error } = await supabase
    .from("menu_categories")
    .insert([category])
    .select()
    .single();

  return { success: !error, data, error: error?.message };
};

// Update category
export const updateCategory = async (
  categoryId: string,
  updates: Partial<MenuCategory>
) => {
  const { data, error } = await supabase
    .from("menu_categories")
    .update(updates)
    .eq("id", categoryId)
    .select()
    .single();

  return { success: !error, data, error: error?.message };
};

// Soft delete category
export const deleteCategory = async (categoryId: string) => {
  const { error } = await supabase
    .from("menu_categories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", categoryId);

  return !error;
};

// Subscribe to menu items with real-time updates (filters out soft-deleted items)
export const subscribeToMenuItems = (
  restaurantId: string,
  callback: (items: MenuItem[]) => void
) => {
  const fetchItems = async () => {
    const { data, error } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (!error && data) {
      callback(data as MenuItem[]);
    }
  };

  fetchItems();

  const subscription = supabase
    .channel(`restaurant-menu-${restaurantId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "menu_items",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        fetchItems();
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(subscription);
    },
  };
};

// Create menu item
export const createMenuItem = async (item: Partial<MenuItem>) => {
  const { data, error } = await supabase
    .from("menu_items")
    .insert([item])
    .select()
    .single();

  return { success: !error, data, error: error?.message };
};

// Update menu item
export const updateMenuItem = async (
  itemId: string,
  updates: Partial<MenuItem>
) => {
  const { data, error } = await supabase
    .from("menu_items")
    .update(updates)
    .eq("id", itemId)
    .select()
    .single();

  return { success: !error, data, error: error?.message };
};

// Toggle menu item availability (triggers real-time update for customers)
export const toggleMenuItemAvailability = async (
  itemId: string,
  isAvailable: boolean
) => {
  const { error } = await supabase
    .from("menu_items")
    .update({ is_available: isAvailable })
    .eq("id", itemId);

  return !error;
};

// Soft delete menu item
export const deleteMenuItem = async (itemId: string) => {
  const { error } = await supabase
    .from("menu_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", itemId);

  return !error;
};

export interface PlaceOrderItemDTO {
  menu_item_id: string;
  name?: string;
  quantity: number;
  base_price?: number;
  selected_size?: { name: string; price?: number };
  selected_addons?: { name: string; price?: number }[];
  client_price?: number;
  item_total?: number;
  special_instructions?: string;
}

export interface PlaceOrderDTO {
  restaurant_id: string;
  order_type: "dine_in" | "takeaway" | "qr" | "counter" | "table" | "phone";
  customer_name: string;
  customer_phone: string;
  items: PlaceOrderItemDTO[];
  customer_notes?: string | null;
  table_id?: string | null;
  table_number?: string | null;
  qr_token?: string | null;
  idempotency_key?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
}

// Create order using atomic server-side verification procedure
export const createOrder = async (order: PlaceOrderDTO) => {
  const { data, error } = await supabase.rpc("place_order", {
    p_restaurant_id: order.restaurant_id,
    p_order_type: order.order_type,
    p_customer_name: order.customer_name,
    p_customer_phone: order.customer_phone,
    p_items: order.items,
    p_customer_notes: order.customer_notes || null,
    p_qr_token: order.qr_token || null,
    p_idempotency_key: order.idempotency_key || null,
    p_client_subtotal: order.subtotal ?? null,
    p_client_total: order.total ?? null,
    p_table_id: order.table_id || null,
  });

  return { data, error };
};

// Get restaurant stats
export const getRestaurantStats = async (restaurantId: string) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      { data: todayOrders },
      { data: pendingOrders },
      { count: totalOrders },
    ] = await Promise.all([
      supabase
        .from("orders")
        .select("total, status")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", today.toISOString()),
      supabase
        .from("orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("status", "pending"),
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId),
    ]);

    const completedToday =
      todayOrders?.filter((o) => o.status === "completed").length || 0;
    const revenueToday =
      todayOrders
        ?.filter((o) => o.status === "completed")
        .reduce((sum, o) => sum + (o.total || 0), 0) || 0;

    return {
      pendingOrders: pendingOrders?.length || 0,
      completedToday,
      revenueToday,
      totalOrders: totalOrders || 0,
    };
  } catch (error) {
    console.error("Error fetching restaurant stats:", error);
    return {
      pendingOrders: 0,
      completedToday: 0,
      revenueToday: 0,
      totalOrders: 0,
    };
  }
};

// ============================================================================
// Restaurant Table Management & QR Code Functions
// ============================================================================

// Subscribe to restaurant tables with real-time updates
export const subscribeToTables = (
  restaurantId: string,
  callback: (tables: RestaurantTable[]) => void,
  onError?: (error: Error) => void
) => {
  let isCancelled = false;

  const fetchTables = async () => {
    try {
      if (isCancelled) return;
      const { data, error } = await supabase
        .from("restaurant_tables")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (isCancelled) return;

      if (error) {
        console.error("subscribeToTables query error:", error);
        onError?.(new Error(error.message));
      } else {
        callback((data as RestaurantTable[]) || []);
      }
    } catch (err: unknown) {
      if (isCancelled) return;
      const errorObj = err instanceof Error ? err : new Error("Failed to fetch tables");
      console.error("subscribeToTables exception:", err);
      onError?.(errorObj);
    }
  };

  fetchTables();

  const channelName = `restaurant_tables_${restaurantId}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "restaurant_tables",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        if (!isCancelled) fetchTables();
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      isCancelled = true;
      supabase.removeChannel(channel);
    },
  };
};

// Create a new table
export const createRestaurantTable = async (table: {
  restaurant_id: string;
  table_number: string;
  capacity?: number;
  is_active?: boolean;
}) => {
  const { data, error } = await supabase
    .from("restaurant_tables")
    .insert([table])
    .select()
    .single();

  return { success: !error, data, error: error?.message };
};

// Update table details (e.g. number, capacity, active status)
export const updateRestaurantTable = async (
  tableId: string,
  updates: Partial<RestaurantTable>
) => {
  const { data, error } = await supabase
    .from("restaurant_tables")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", tableId)
    .select()
    .single();

  return { success: !error, data, error: error?.message };
};

// Soft delete a table
export const deleteRestaurantTable = async (tableId: string) => {
  const { error } = await supabase
    .from("restaurant_tables")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tableId);

  return !error;
};

// Regenerate table QR token
export const regenerateTableQR = async (tableId: string) => {
  const { data, error } = await supabase.rpc("regenerate_table_qr_token", {
    p_table_id: tableId,
  });

  return { success: !error, token: data as string, error: error?.message };
};

// Verify table QR token for customer ordering
export const verifyTableQRToken = async (
  slug: string,
  token: string
): Promise<{
  valid: boolean;
  table?: { id: string; table_number: string; capacity: number };
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("verify_table_qr_token", {
    p_slug: slug,
    p_token: token,
  });

  if (error || !data) {
    return { valid: false, error: error?.message || "Verification failed" };
  }

  return data as {
    valid: boolean;
    table?: { id: string; table_number: string; capacity: number };
    error?: string;
  };
};

// Customer live order status tracking
export const getCustomerOrder = async (
  orderId: string
): Promise<{
  found: boolean;
  order?: Order & { items: OrderItem[] };
  restaurant?: {
    name: string;
    name_bn?: string;
    slug: string;
    phone?: string;
    address?: string;
    logo_url?: string;
    vat_bin_no?: string;
    currency: string;
    currency_symbol: string;
  };
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("get_customer_order", {
    p_order_id: orderId,
  });

  if (error || !data) {
    return { found: false, error: error?.message || "Failed to load order status" };
  }

  return data as {
    found: boolean;
    order?: Order & { items: OrderItem[] };
    restaurant?: {
      name: string;
      name_bn?: string;
      slug: string;
      phone?: string;
      address?: string;
      logo_url?: string;
      vat_bin_no?: string;
      currency: string;
      currency_symbol: string;
    };
    error?: string;
  };
};

export interface BillSettlementResult {
  order_id: string;
  order_number: string;
  invoice_number: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: string;
  tendered_amount: number;
  change_amount: number;
  settled_at: string;
  completed_at?: string;
}

// Settle an order bill (Cashier / Owner)
export const settleOrderBill = async (
  orderId: string,
  paymentMethod: string = "cash",
  tenderedAmount: number,
  discount: number = 0,
  notes?: string
): Promise<{
  success: boolean;
  data?: BillSettlementResult;
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("settle_order_bill", {
    p_order_id: orderId,
    p_payment_method: paymentMethod,
    p_tendered_amount: tenderedAmount,
    p_discount: discount,
    p_notes: notes || null,
  });

  if (error || !data) {
    return { success: false, error: error?.message || "Failed to settle bill" };
  }

  return { success: true, data: data as BillSettlementResult };
};

// Fetch payments for an order
export const getOrderPayments = async (orderId: string): Promise<Payment[]> => {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    return [];
  }
  return data as Payment[];
};

// Fetch normalized order items for an order
export const getOrderItemsNormalized = async (
  orderId: string
): Promise<OrderItemRecord[]> => {
  const { data, error } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return [];
  }
  return data as OrderItemRecord[];
};

// Update or remove restaurant official logo via secure RPC with fallback
export const updateRestaurantLogo = async (
  restaurantId: string,
  logoUrl: string | null
): Promise<{ success: boolean; error?: string; logo_url?: string | null }> => {
  try {
    const { data, error } = await supabase.rpc("update_restaurant_logo", {
      p_restaurant_id: restaurantId,
      p_logo_url: logoUrl,
    });

    if (error) {
      // Fallback to direct table update if RPC fails
      const { error: tableError } = await supabase
        .from("restaurants")
        .update({
          logo_url: logoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", restaurantId);

      if (tableError) {
        return { success: false, error: tableError.message || error.message };
      }
      return { success: true, logo_url: logoUrl };
    }

    return {
      success: true,
      logo_url: (data as any)?.logo_url ?? logoUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update restaurant logo";
    return { success: false, error: msg };
  }
};




