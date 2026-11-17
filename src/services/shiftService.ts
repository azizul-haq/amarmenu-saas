import { supabase } from "../config/supabase";
import type { CashShift, ZReportData } from "../config/supabase";

export interface ActiveShiftDetails {
  has_active_shift: boolean;
  shift_id?: string;
  restaurant_id?: string;
  opened_by_name?: string;
  opening_float?: number;
  opening_time?: string;
  status?: "open" | "closed";
  live_cash_sales?: number;
  live_digital_sales?: number;
  live_total_sales?: number;
  live_expected_cash?: number;
  live_completed_orders?: number;
  live_voided_orders?: number;
}

/**
 * Open a new cash drawer shift with initial opening float
 */
export const openCashShift = async (
  openingFloat: number = 0,
  notes?: string
): Promise<{
  success: boolean;
  data?: {
    shift_id: string;
    restaurant_id: string;
    opening_float: number;
    opening_time: string;
    status: string;
  };
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("open_cash_shift", {
    p_opening_float: openingFloat,
    p_notes: notes || null,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to open cash shift",
    };
  }

  return {
    success: true,
    data: data as {
      shift_id: string;
      restaurant_id: string;
      opening_float: number;
      opening_time: string;
      status: string;
    },
  };
};

/**
 * Retrieve the active open shift with live calculated financial metrics
 */
export const getActiveCashShift = async (
  restaurantId: string
): Promise<ActiveShiftDetails> => {
  const { data, error } = await supabase.rpc("get_active_cash_shift", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data) {
    return { has_active_shift: false };
  }

  return data as ActiveShiftDetails;
};

/**
 * Close cash shift, reconcile drawer count vs expected cash, and generate Z-Report
 */
export const closeCashShift = async (
  shiftId: string,
  closingCount: number,
  notes?: string
): Promise<{
  success: boolean;
  data?: ZReportData;
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("close_cash_shift", {
    p_shift_id: shiftId,
    p_closing_count: closingCount,
    p_notes: notes || null,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to close cash shift",
    };
  }

  return {
    success: true,
    data: data as ZReportData,
  };
};

/**
 * Fetch past shifts history for audit and reconciliation
 */
export const getCashShiftsHistory = async (
  restaurantId: string,
  limit: number = 30
): Promise<CashShift[]> => {
  const { data, error } = await supabase
    .from("cash_shifts")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("opening_time", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data as CashShift[];
};
