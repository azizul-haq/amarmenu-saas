import { supabase, type OnlinePaymentSession } from "../config/supabase";
import {
  initiateOnlinePaymentSchema,
  completeOnlinePaymentSchema,
  failOnlinePaymentSchema,
  type OnlineGateway,
  type PaymentInitiationResult,
  type PaymentCompletionResult,
} from "../schemas/onlinePaymentSchema";

/**
 * Initiates an online payment session (bKash, SSLCOMMERZ, or Nagad)
 */
export const initiateOnlinePayment = async (
  orderId: string,
  gateway: OnlineGateway = "bkash",
  customerPhone?: string
): Promise<{ success: boolean; data?: PaymentInitiationResult; error?: string }> => {
  try {
    const validated = initiateOnlinePaymentSchema.parse({
      order_id: orderId,
      gateway,
      customer_phone: customerPhone,
    });

    const { data, error } = await supabase.rpc("initiate_online_payment", {
      p_order_id: validated.order_id,
      p_gateway: validated.gateway,
      p_customer_phone: validated.customer_phone || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: data as PaymentInitiationResult,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to initiate online payment";
    return { success: false, error: message };
  }
};

/**
 * Completes an online payment session atomically: updates session, generates fiscal invoice,
 * records payment in payments table, marks order paid & completed, and resets dine-in table.
 */
export const completeOnlinePayment = async (
  sessionId: string,
  gatewayTrxId: string,
  valId?: string,
  payload?: Record<string, unknown>
): Promise<{ success: boolean; data?: PaymentCompletionResult; error?: string }> => {
  try {
    const validated = completeOnlinePaymentSchema.parse({
      session_id: sessionId,
      gateway_trx_id: gatewayTrxId,
      val_id: valId,
      payload,
    });

    const { data, error } = await supabase.rpc("complete_online_payment", {
      p_session_id: validated.session_id,
      p_gateway_trx_id: validated.gateway_trx_id,
      p_val_id: validated.val_id || null,
      p_payload: validated.payload || {},
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: data as PaymentCompletionResult,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete online payment";
    return { success: false, error: message };
  }
};

/**
 * Marks an online payment session as failed or cancelled
 */
export const failOnlinePayment = async (
  sessionId: string,
  reason = "Payment cancelled or failed"
): Promise<{ success: boolean; error?: string }> => {
  try {
    const validated = failOnlinePaymentSchema.parse({
      session_id: sessionId,
      reason,
    });

    const { error } = await supabase.rpc("fail_online_payment", {
      p_session_id: validated.session_id,
      p_reason: validated.reason || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel online payment";
    return { success: false, error: message };
  }
};

/**
 * Fetches an online payment session by tran_id or session_id
 */
export const getOnlinePaymentSession = async (
  sessionIdOrTranId: string
): Promise<{ success: boolean; session?: OnlinePaymentSession; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from("online_payment_sessions")
      .select("*")
      .or(`tran_id.eq.${sessionIdOrTranId},session_id.eq.${sessionIdOrTranId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: "Payment session not found" };
    }

    return {
      success: true,
      session: data as OnlinePaymentSession,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve payment session";
    return { success: false, error: message };
  }
};

/**
 * Helper to generate realistic mock transaction IDs for simulation
 */
export const generateMockTrxId = (gateway: OnlineGateway): string => {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  switch (gateway) {
    case "bkash":
      return `BK${stamp}${rand}`;
    case "sslcommerz":
      return `SSL${stamp}${rand}`;
    case "nagad":
      return `NGD${stamp}${rand}`;
    default:
      return `TRX${stamp}${rand}`;
  }
};
