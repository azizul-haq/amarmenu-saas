import { supabase } from "../config/supabase";
import type { RegistrationRequest, Restaurant } from "../config/supabase";

export interface ApprovalResult {
  success: boolean;
  restaurant?: {
    id: string;
    name: string;
    slug: string;
  };
  inviteLink?: string;
  email?: string;
  ownerName?: string;
  error?: string;
}

/**
 * Admin API Service
 * All admin-related database operations
 */

// Get all pending registration requests with real-time updates
export const subscribeToPendingRequests = (
  callback: (requests: RegistrationRequest[]) => void
) => {
  // Initial fetch
  const fetchPending = async () => {
    const { data, error } = await supabase
      .from("registration_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (!error && data) {
      callback(data);
    }
  };

  fetchPending();

  // Subscribe to changes
  const subscription = supabase
    .channel("pending-requests")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "registration_requests",
        filter: "status=eq.pending",
      },
      () => {
        fetchPending();
      }
    )
    .subscribe();

  return subscription;
};

// Create restaurant account from registration request
export const createRestaurantAccount = async (
  requestId: string,
  data: {
    email: string;
    subscriptionPlan: string;
    internalNotes?: string;
  }
): Promise<ApprovalResult> => {
  try {
    // 1. Try invoking the Supabase Edge Function 'approve-registration'
    try {
      const { data: edgeData, error: edgeError } = await supabase.functions.invoke(
        "approve-registration",
        {
          body: {
            requestId,
            subscriptionPlan: data.subscriptionPlan,
            internalNotes: data.internalNotes,
            appUrl: window.location.origin,
          },
        }
      );

      if (!edgeError && edgeData && edgeData.success) {
        return {
          success: true,
          restaurant: edgeData.restaurant,
          inviteLink: edgeData.inviteLink,
          email: edgeData.email,
          ownerName: edgeData.ownerName,
        };
      }
    } catch {
      // If Edge Function is not deployed or network fails, proceed to server RPC fallback
    }

    // 2. Server-side RPC fallback: approve_registration_request
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "approve_registration_request",
      {
        p_request_id: requestId,
        p_subscription_plan: data.subscriptionPlan,
        p_internal_notes: data.internalNotes || null,
      }
    );

    if (rpcError) {
      console.error("Approval RPC error:", rpcError);
      throw new Error(rpcError.message);
    }

    const inviteLink = `${window.location.origin}/set-password?email=${encodeURIComponent(data.email)}`;

    return {
      success: true,
      restaurant: {
        id: rpcData.restaurant_id,
        name: rpcData.restaurant_name,
        slug: rpcData.slug,
      },
      inviteLink,
      email: data.email,
      ownerName: rpcData.owner_name,
    };
  } catch (error: unknown) {
    console.error("Create account error:", error);
    const message = error instanceof Error ? error.message : "Failed to create account";
    return {
      success: false,
      error: message,
    };
  }
};

// Reject registration request
export const rejectRegistrationRequest = async (
  requestId: string,
  reason: string
) => {
  const { error } = await supabase.rpc("admin_reject_request", {
    p_request_id: requestId,
    p_rejection_reason: reason,
  });

  return !error;
};

// Get all restaurants with real-time updates
export const subscribeToRestaurants = (
  callback: (restaurants: Restaurant[]) => void
) => {
  const fetchRestaurants = async () => {
    const { data, error } = await supabase
      .from("restaurants")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      callback(data);
    }
  };

  fetchRestaurants();

  const subscription = supabase
    .channel("restaurants")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "restaurants",
      },
      () => {
        fetchRestaurants();
      }
    )
    .subscribe();

  return subscription;
};

// Toggle restaurant block/unblock status
export const toggleRestaurantStatus = async (
  restaurantId: string,
  isCurrentlyBlocked: boolean,
  blockReason?: string
) => {
  const { error } = await supabase.rpc("admin_toggle_restaurant_status", {
    p_restaurant_id: restaurantId,
    p_is_active: isCurrentlyBlocked, // If currently blocked, set to active (true)
    p_block_reason: blockReason || null,
  });

  return !error;
};

// Get platform statistics
export const getPlatformStats = async () => {
  try {
    // Get counts
    const [
      { count: activeRestaurants },
      { count: pendingRequests },
      { count: totalOrders },
      { data: todayOrders },
    ] = await Promise.all([
      supabase
        .from("restaurants")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("registration_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase.from("orders").select("*", { count: "exact", head: true }),
      supabase
        .from("orders")
        .select("total")
        .gte(
          "created_at",
          new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        ),
    ]);

    const todayRevenue =
      todayOrders?.reduce((sum, order) => sum + (order.total || 0), 0) || 0;

    return {
      activeRestaurants: activeRestaurants || 0,
      pendingRequests: pendingRequests || 0,
      totalOrders: totalOrders || 0,
      todayRevenue,
    };
  } catch (error) {
    console.error("Error fetching stats:", error);
    return {
      activeRestaurants: 0,
      pendingRequests: 0,
      totalOrders: 0,
      todayRevenue: 0,
    };
  }
};
