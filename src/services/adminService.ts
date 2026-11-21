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
  emailSent?: boolean;
  emailError?: string;
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

    if (edgeError) {
      console.error("approve-registration edge error:", edgeError);
      let errMsg = edgeError.message;
      if (typeof edgeError === "object" && "context" in edgeError) {
        try {
          const body = await (edgeError as any).context.json();
          if (body?.error) errMsg = body.error;
        } catch {
          // ignore
        }
      }
      return {
        success: false,
        error: errMsg || "Failed to approve registration",
      };
    }

    if (!edgeData || !edgeData.success) {
      return {
        success: false,
        error: edgeData?.error || "Registration approval failed",
      };
    }

    return {
      success: true,
      restaurant: {
        id: edgeData.restaurantId,
        name: edgeData.restaurantName || "Restaurant",
        slug: edgeData.restaurantSlug,
      },
      inviteLink: edgeData.inviteLink,
      email: edgeData.ownerEmail || data.email,
      ownerName: edgeData.ownerName,
      emailSent: edgeData.email_sent ?? true,
      emailError: edgeData.email_error,
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
    const { data, error } = await supabase.rpc("admin_list_restaurants");

    if (!error && data) {
      callback(data as Restaurant[]);
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
        .select("id", { count: "exact", head: true })
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

/**
 * Resend invitation email for a restaurant owner (Super Admin only)
 * Resolves owner server-side, checks last_sign_in_at, rate limits, audits.
 */
export const resendRestaurantInvite = async (
  restaurantId: string
): Promise<{ success: boolean; message?: string; inviteLink?: string; ownerEmail?: string; email_sent?: boolean; error?: string }> => {
  const { data, error } = await supabase.functions.invoke("approve-registration", {
    body: {
      action: "resend_invite",
      restaurantId,
      appUrl: window.location.origin,
    },
  });

  if (error) {
    let errMsg = error.message;
    if (typeof error === "object" && "context" in error) {
      try {
        const body = await (error as any).context.json();
        if (body?.error) errMsg = body.error;
      } catch {
        // ignore
      }
    }
    return {
      success: false,
      error: errMsg || "Failed to resend invite",
    };
  }

  if (!data?.success) {
    return {
      success: false,
      error: data?.error || "Failed to resend invite",
    };
  }

  return {
    success: true,
    email_sent: data.email_sent,
    message: data.message || `Onboarding invitation email sent to ${data.ownerEmail || "owner"}.`,
    ownerEmail: data.ownerEmail,
    inviteLink: data.inviteLink,
  };
};
