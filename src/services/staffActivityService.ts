import { supabase } from "../config/supabase";
import type { StaffActivityLog } from "../config/supabase";

export interface TeamActivityFilter {
  restaurantId: string;
  role?: string;
  actorId?: string;
  dateRange?: "today" | "week" | "month" | "all";
  limit?: number;
}

export interface MyTodayStats {
  ordersServed: number;
  ordersAccepted: number;
  itemsPrepared: number;
  billsSettled: number;
  stockToggles: number;
  shiftsHandled: number;
  totalActions: number;
}

/**
 * Fetch personal activity logs for the logged-in staff member
 */
export async function getMyActivityLogs(
  restaurantId: string,
  userId: string,
  limit = 50
): Promise<{ data: StaffActivityLog[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("staff_activity_logs")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("actor_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { data: (data as StaffActivityLog[]) || [], error: null };
  } catch (err: any) {
    return { data: [], error: err.message || "Failed to load activity logs" };
  }
}

/**
 * Calculate today's activity stats for the current staff member
 */
export async function getMyTodayStats(
  restaurantId: string,
  userId: string
): Promise<MyTodayStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  try {
    const { data, error } = await supabase
      .from("staff_activity_logs")
      .select("action")
      .eq("restaurant_id", restaurantId)
      .eq("actor_user_id", userId)
      .gte("created_at", startOfDay.toISOString());

    if (error || !data) {
      return {
        ordersServed: 0,
        ordersAccepted: 0,
        itemsPrepared: 0,
        billsSettled: 0,
        stockToggles: 0,
        shiftsHandled: 0,
        totalActions: 0,
      };
    }

    let ordersServed = 0;
    let ordersAccepted = 0;
    let itemsPrepared = 0;
    let billsSettled = 0;
    let stockToggles = 0;
    let shiftsHandled = 0;

    for (const item of data) {
      if (item.action === "order_served") ordersServed++;
      else if (item.action === "order_accepted") ordersAccepted++;
      else if (item.action === "order_ready") itemsPrepared++;
      else if (item.action === "bill_settled") billsSettled++;
      else if (item.action === "menu_stock_toggled") stockToggles++;
      else if (item.action === "shift_opened" || item.action === "shift_closed") shiftsHandled++;
    }

    return {
      ordersServed,
      ordersAccepted,
      itemsPrepared,
      billsSettled,
      stockToggles,
      shiftsHandled,
      totalActions: data.length,
    };
  } catch {
    return {
      ordersServed: 0,
      ordersAccepted: 0,
      itemsPrepared: 0,
      billsSettled: 0,
      stockToggles: 0,
      shiftsHandled: 0,
      totalActions: 0,
    };
  }
}

/**
 * Fetch team activity logs for Owner / Manager with filtering
 */
export async function getTeamActivityLogs(
  filter: TeamActivityFilter
): Promise<{ data: StaffActivityLog[]; error: string | null }> {
  try {
    let query = supabase
      .from("staff_activity_logs")
      .select("*")
      .eq("restaurant_id", filter.restaurantId)
      .order("created_at", { ascending: false })
      .limit(filter.limit || 100);

    if (filter.role && filter.role !== "all") {
      query = query.eq("actor_role", filter.role);
    }

    if (filter.actorId && filter.actorId !== "all") {
      query = query.eq("actor_user_id", filter.actorId);
    }

    if (filter.dateRange && filter.dateRange !== "all") {
      const now = new Date();
      if (filter.dateRange === "today") {
        now.setHours(0, 0, 0, 0);
        query = query.gte("created_at", now.toISOString());
      } else if (filter.dateRange === "week") {
        now.setDate(now.getDate() - 7);
        query = query.gte("created_at", now.toISOString());
      } else if (filter.dateRange === "month") {
        now.setDate(now.getDate() - 30);
        query = query.gte("created_at", now.toISOString());
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    return { data: (data as StaffActivityLog[]) || [], error: null };
  } catch (err: any) {
    return { data: [], error: err.message || "Failed to load team activity logs" };
  }
}

/**
 * Safely update staff member's own profile (full_name and phone)
 */
export async function updateMyProfile(
  fullName: string,
  phone: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc("update_my_profile", {
      p_full_name: fullName,
      p_phone: phone,
    });

    if (error) throw error;
    return { success: !!data?.success, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to update profile" };
  }
}
