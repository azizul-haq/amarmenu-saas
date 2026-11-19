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
 * Initiates an online payment session (bKash, SSLCOMMERZ, or Nagad).
 * Note: amount is taken directly from the database order row, never from a client parameter.
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
 * Completes an online payment via the server-side simulate-payment Edge Function.
 * The client browser NEVER calls raw settlement RPCs directly.
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

    const { data, error } = await supabase.functions.invoke("simulate-payment", {
      body: {
        action: "complete",
        session_id: validated.session_id,
        gateway_trx_id: validated.gateway_trx_id,
        val_id: validated.val_id || null,
        payload: validated.payload || {},
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || "Payment simulation failed" };
    }

    return {
      success: true,
      data: data.data as PaymentCompletionResult,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete online payment";
    return { success: false, error: message };
  }
};

/**
 * Marks an online payment session as failed or cancelled via Edge Function.
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

    const { data, error } = await supabase.functions.invoke("simulate-payment", {
      body: {
        action: "fail",
        session_id: validated.session_id,
        reason: validated.reason || null,
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || "Payment cancellation failed" };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel online payment";
    return { success: false, error: message };
  }
};

/**
 * Fetches sanitized payment status via RPC by secure 128-bit polling token (safe for public/anon customer callers)
 */
export interface PaymentStatusInfo {
  status: string;
  invoice_number?: string | null;
}

export const getPaymentStatus = async (
  pollingToken: string
): Promise<{ success: boolean; data?: PaymentStatusInfo; error?: string }> => {
  try {
    const { data, error } = await supabase.rpc("get_payment_status", {
      p_polling_token: pollingToken,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data || data.success === false) {
      return { success: false, error: data?.error || "Payment session not found" };
    }

    return {
      success: true,
      data: {
        status: data.status,
        invoice_number: data.invoice_number,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve payment status";
    return { success: false, error: message };
  }
};

/**
 * Fetches an online payment session status by polling token via safe RPC
 */
export const getOnlinePaymentSession = async (
  pollingToken: string
): Promise<{ success: boolean; session?: Partial<OnlinePaymentSession>; error?: string }> => {
  const res = await getPaymentStatus(pollingToken);
  if (!res.success || !res.data) {
    return { success: false, error: res.error || "Payment session not found" };
  }
  return {
    success: true,
    session: {
      status: res.data.status as any,
    } as Partial<OnlinePaymentSession>,
  };
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
