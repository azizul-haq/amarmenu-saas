import { z } from "zod";

export const onlineGatewaySchema = z.enum(["bkash", "sslcommerz", "nagad"]);
export type OnlineGateway = z.infer<typeof onlineGatewaySchema>;

export const initiateOnlinePaymentSchema = z.object({
  order_id: z.string().uuid("Invalid Order ID"),
  gateway: onlineGatewaySchema.default("bkash"),
  customer_phone: z
    .string()
    .regex(/^(\+?8801[3-9]\d{8}|01[3-9]\d{8})$/, "Valid Bangladeshi mobile number required (01XXXXXXXXX)")
    .optional(),
});
export type InitiateOnlinePaymentInput = z.infer<typeof initiateOnlinePaymentSchema>;

export const completeOnlinePaymentSchema = z.object({
  session_id: z.string().min(1, "Session ID / Transaction ID is required"),
  gateway_trx_id: z.string().min(1, "Gateway Transaction ID is required"),
  val_id: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CompleteOnlinePaymentInput = z.infer<typeof completeOnlinePaymentSchema>;

export const failOnlinePaymentSchema = z.object({
  session_id: z.string().min(1, "Session ID is required"),
  reason: z.string().optional(),
});
export type FailOnlinePaymentInput = z.infer<typeof failOnlinePaymentSchema>;

export interface PaymentInitiationResult {
  success: boolean;
  session_id: string;
  tran_id: string;
  polling_token?: string;
  order_id: string;
  order_number: string;
  amount: number;
  currency: string;
  gateway: OnlineGateway;
  gateway_payment_id?: string;
  redirect_url: string;
  expires_at: string;
  restaurant_name: string;
}

export interface PaymentCompletionResult {
  success: boolean;
  is_duplicate?: boolean;
  session_id: string;
  tran_id: string;
  order_id: string;
  order_number: string;
  invoice_number: string;
  amount: number;
  gateway: OnlineGateway;
  gateway_trx_id: string;
  val_id?: string | null;
  payment_id?: string;
  table_reset?: boolean;
  settled_at: string;
}
