import { supabase } from "../config/supabase";
import {
  submitPaymentSchema,
  verifyPaymentSchema,
  adminOverrideSubscriptionSchema,
} from "../schemas/subscriptionSchema";
import type {
  SubmitPaymentInput,
  VerifyPaymentInput,
  AdminOverrideSubscriptionInput,
  PlatformBillingOverview,
  SubscriptionInvoice,
  TenantSubscriptionRecord,
} from "../schemas/subscriptionSchema";

/**
 * Submit manual subscription payment (bKash, Nagad, Bank) from restaurant dashboard
 */
export const submitSubscriptionPayment = async (
  input: SubmitPaymentInput
): Promise<{
  success: boolean;
  data?: {
    invoice_id: string;
    invoice_number: string;
    amount: number;
    plan_code: string;
    status: string;
    message: string;
  };
  error?: string;
}> => {
  const validation = submitPaymentSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid payment details",
    };
  }

  const { data, error } = await supabase.rpc("submit_subscription_payment", {
    p_restaurant_id: input.restaurantId,
    p_plan_code: input.planCode,
    p_billing_cycle: input.billingCycle,
    p_payment_method: input.paymentMethod,
    p_transaction_id: input.transactionId,
    p_sender_number: input.senderNumber || null,
    p_notes: input.notes || null,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to submit subscription payment",
    };
  }

  return {
    success: true,
    data: data as {
      invoice_id: string;
      invoice_number: string;
      amount: number;
      plan_code: string;
      status: string;
      message: string;
    },
  };
};

/**
 * Verify or Reject subscription payment (Super Admin only)
 */
export const verifySubscriptionPayment = async (
  input: VerifyPaymentInput
): Promise<{
  success: boolean;
  data?: {
    invoice_id: string;
    action: string;
    status: string;
    plan_code?: string;
    message: string;
  };
  error?: string;
}> => {
  const validation = verifyPaymentSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid verification parameters",
    };
  }

  const { data, error } = await supabase.rpc("verify_subscription_payment", {
    p_invoice_id: input.invoiceId,
    p_action: input.action,
    p_rejection_reason: input.rejectionReason || null,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to verify subscription payment",
    };
  }

  return {
    success: true,
    data: data as {
      invoice_id: string;
      action: string;
      status: string;
      plan_code?: string;
      message: string;
    },
  };
};

/**
 * Run subscription sweep to assign grace periods (7 days) and suspend/lock expired accounts
 */
export const evaluateSubscriptionGraceAndLock = async (): Promise<{
  success: boolean;
  data?: {
    grace_period_assigned: number;
    suspended_and_locked: number;
    evaluated_at: string;
  };
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("evaluate_subscription_grace_and_lock");

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to evaluate subscription grace periods",
    };
  }

  return {
    success: true,
    data: data as {
      grace_period_assigned: number;
      suspended_and_locked: number;
      evaluated_at: string;
    },
  };
};

/**
 * Super Admin direct plan, trial extension, or status override
 */
export const adminOverrideSubscription = async (
  input: AdminOverrideSubscriptionInput
): Promise<{
  success: boolean;
  data?: {
    restaurant_id: string;
    plan_code: string;
    status: string;
    expires_at: string;
    message: string;
  };
  error?: string;
}> => {
  const validation = adminOverrideSubscriptionSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid override parameters",
    };
  }

  const { data, error } = await supabase.rpc("admin_override_subscription", {
    p_restaurant_id: input.restaurantId,
    p_plan_code: input.planCode,
    p_status: input.status,
    p_extend_days: input.extendDays,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to update subscription",
    };
  }

  return {
    success: true,
    data: data as {
      restaurant_id: string;
      plan_code: string;
      status: string;
      expires_at: string;
      message: string;
    },
  };
};

/**
 * Super Admin Platform-Wide Billing Overview (MRR, ARR, Invoices, Subscriptions)
 */
export const getPlatformBillingOverview = async (): Promise<{
  success: boolean;
  data?: PlatformBillingOverview;
  error?: string;
}> => {
  const { data, error } = await supabase.rpc("get_platform_billing_overview");

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to load platform billing overview",
    };
  }

  return {
    success: true,
    data: data as PlatformBillingOverview,
  };
};

/**
 * Get active subscription and invoices for a single restaurant
 */
export const getTenantSubscriptionDetails = async (
  restaurantId: string
): Promise<{
  success: boolean;
  subscription?: TenantSubscriptionRecord | null;
  invoices: SubscriptionInvoice[];
  error?: string;
}> => {
  try {
    const [subRes, invRes] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("subscription_invoices")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false }),
    ]);

    if (subRes.error) throw subRes.error;
    if (invRes.error) throw invRes.error;

    return {
      success: true,
      subscription: subRes.data as TenantSubscriptionRecord | null,
      invoices: (invRes.data || []) as SubscriptionInvoice[],
    };
  } catch (err) {
    return {
      success: false,
      invoices: [],
      error: err instanceof Error ? err.message : "Failed to load subscription details",
    };
  }
};

/**
 * Export SaaS Invoices to CSV
 */
export const exportSubscriptionInvoicesCSV = (
  invoices: SubscriptionInvoice[]
): void => {
  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines: string[] = [
    `"AmarMenu SaaS Platform Invoices"`,
    `"Generated On: ${new Date().toLocaleString()}"`,
    "",
    [
      escapeCSV("Invoice No"),
      escapeCSV("Restaurant Name"),
      escapeCSV("Plan"),
      escapeCSV("Billing Cycle"),
      escapeCSV("Amount (BDT)"),
      escapeCSV("Payment Method"),
      escapeCSV("Transaction ID"),
      escapeCSV("Sender Phone"),
      escapeCSV("Status"),
      escapeCSV("Submitted At"),
      escapeCSV("Verified At"),
    ].join(","),
  ];

  invoices.forEach((inv) => {
    lines.push(
      [
        escapeCSV(inv.invoice_number),
        escapeCSV(inv.restaurant_name || "N/A"),
        escapeCSV(inv.plan_code.toUpperCase()),
        escapeCSV(inv.billing_cycle),
        inv.amount.toFixed(2),
        escapeCSV(inv.payment_method.toUpperCase()),
        escapeCSV(inv.transaction_id || "N/A"),
        escapeCSV(inv.sender_number || "N/A"),
        escapeCSV(inv.status.toUpperCase()),
        escapeCSV(new Date(inv.created_at).toLocaleString()),
        escapeCSV(inv.verified_at ? new Date(inv.verified_at).toLocaleString() : "-"),
      ].join(",")
    );
  });

  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SaaS_Invoices_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
