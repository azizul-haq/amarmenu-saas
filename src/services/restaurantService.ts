import { supabase } from "../config/supabase";
import type { Order, MenuItem, MenuCategory } from "../config/supabase";

/**
 * Restaurant API Service
 * All restaurant dashboard operations with real-time support
 */

// Subscribe to restaurant's orders with real-time updates
export const subscribeToOrders = (
  restaurantId: string,
  callback: (orders: Order[]) => void
) => {
  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      callback(data);
    }
  };

  fetchOrders();

  const subscription = supabase
    .channel(`restaurant-orders-${restaurantId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        fetchOrders();
      }
    )
    .subscribe();

  return subscription;
};

// Update order status
export const updateOrderStatus = async (
  orderId: string,
  status: string,
  paymentData?: {
    paymentMethod?: string;
    transactionId?: string;
  }
) => {
  const updateData: Partial<Order> = { status: status as Order["status"] };

  if (paymentData) {
    updateData.payment_method = paymentData.paymentMethod;
    updateData.payment_transaction_id = paymentData.transactionId;
  }

  const { error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", orderId);

  return !error;
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

  return subscription;
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

  return subscription;
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

// Create order (manual or from customer)
export const createOrder = async (order: Partial<Order>) => {
  const { data, error } = await supabase
    .from("orders")
    .insert([order])
    .select()
    .single();

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
