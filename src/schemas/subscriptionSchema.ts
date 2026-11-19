import { z } from "zod";

export const submitPaymentSchema = z.object({
  restaurantId: z.string().uuid("Invalid restaurant ID"),
  planCode: z.enum(["starter", "growth", "enterprise"]),
  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
  paymentMethod: z.enum(["bkash", "nagad", "bank_transfer", "cash", "card", "sslcommerz", "other"]).default("bkash"),
  transactionId: z.string().trim().min(4, "Transaction ID (TrxID) is required"),
  senderNumber: z.string().trim().regex(/^(\+8801|01)[3-9]\d{8}$/, "Please enter a valid Bangladeshi mobile number (e.g. 017XXXXXXXX)").optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional(),
});

export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;

export const verifyPaymentSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice ID"),
  action: z.enum(["approve", "reject"]),
  amount: z.number().positive("Amount must be positive"),
  rejectionReason: z.string().trim().min(3, "Rejection reason must be at least 3 characters").optional(),
}).refine(
  (data) => {
    if (data.action === "reject" && (!data.rejectionReason || data.rejectionReason.length < 3)) {
      return false;
    }
    return true;
  },
  {
    message: "Rejection reason is mandatory when rejecting a payment",
    path: ["rejectionReason"],
  }
);

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const adminOverrideSubscriptionSchema = z.object({
  restaurantId: z.string().uuid("Invalid restaurant ID"),
  planCode: z.enum(["starter", "growth", "enterprise"]),
  status: z.enum(["trial", "active", "grace_period", "suspended"]),
  extendDays: z.number().int().min(1, "Extend days must be at least 1").default(30),
});

export type AdminOverrideSubscriptionInput = z.infer<typeof adminOverrideSubscriptionSchema>;

export interface SubscriptionInvoice {
  id: string;
  invoice_number: string;
  restaurant_id: string;
  restaurant_name?: string;
  plan_code: "starter" | "growth" | "enterprise" | string;
  billing_cycle: "monthly" | "yearly";
  amount: number;
  payment_method: "bkash" | "nagad" | "bank_transfer" | "cash" | "card" | string;
  transaction_id?: string | null;
  sender_number?: string | null;
  status: "pending" | "paid" | "rejected" | "failed" | "refunded";
  notes?: string | null;
  rejection_reason?: string | null;
  period_start?: string;
  period_end?: string;
  verified_by?: string | null;
  verified_at?: string | null;
  created_at: string;
}

export interface TenantSubscriptionRecord {
  id: string;
  restaurant_id: string;
  restaurant_name?: string;
  restaurant_slug?: string;
  owner_phone?: string;
  plan_code: string;
  billing_cycle: string;
  amount: number;
  status: "trial" | "active" | "grace_period" | "suspended" | "cancelled";
  trial_ends_at?: string | null;
  current_period_end: string;
  last_payment_at?: string | null;
  created_at: string;
}

export interface PlatformBillingMetrics {
  total_mrr: number;
  total_arr: number;
  active_subscriptions: number;
  trial_subscriptions: number;
  grace_subscriptions: number;
  suspended_subscriptions: number;
  pending_verifications: number;
  total_collected: number;
}

export interface PlatformBillingOverview {
  success: boolean;
  metrics: PlatformBillingMetrics;
  invoices: SubscriptionInvoice[];
  subscriptions: TenantSubscriptionRecord[];
}

export interface SubscriptionPlanRecord {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  max_tables: number | null;
  max_staff: number | null;
  features: string[];
  is_active: boolean;
  active_subscribers?: number;
  created_at?: string;
  updated_at?: string;
}
