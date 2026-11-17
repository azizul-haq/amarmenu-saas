import { supabase } from "../config/supabase";
import type { AuditLog } from "../config/supabase";

export interface VoidOrderResult {
  success: boolean;
  order_id: string;
  order_number: string;
  invoice_number?: string;
  status: string;
  audit_log_id: string;
  table_released: boolean;
  voided_at: string;
}

/**
 * Void an order using manager PIN authorization with mandatory reason
 */
export const voidOrderWithPIN = async (
  orderId: string,
  managerPin: string,
  reason: string
): Promise<{
  success: boolean;
  data?: VoidOrderResult;
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("void_order_with_pin", {
    p_order_id: orderId,
    p_manager_pin: managerPin,
    p_reason: reason,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to void order",
    };
  }

  return {
    success: true,
    data: data as VoidOrderResult,
  };
};

/**
 * Fetch append-only audit logs for the restaurant
 */
export const getRestaurantAuditLogs = async (
  restaurantId: string,
  limit: number = 50
): Promise<AuditLog[]> => {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data as AuditLog[];
};

/**
 * Update a staff member's manager PIN (Owner only)
 */
export const setStaffManagerPIN = async (
  staffId: string,
  newPin: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  const { data, error } = await supabase.rpc("set_staff_manager_pin", {
    p_staff_id: staffId,
    p_new_pin: newPin,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to update manager PIN",
    };
  }

  return {
    success: true,
    message: (data as { message: string }).message,
  };
};
