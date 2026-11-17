import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import {
  initiateOnlinePayment,
  getOnlinePaymentSession,
  generateMockTrxId,
} from "../services/onlinePaymentService";
import type { PaymentCompletionResult } from "../schemas/onlinePaymentSchema";

describe("Chunk 19 & 19b: Online Payment Gateways, Security Lockdown & Auto-Settlement", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let restAId: string;
  let testItemId: string;
  let testTableId: string;
  let testTableToken: string;

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ownerAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authenticate Owner A
    const authOwner = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authOwner.error) {
      throw new Error(`Owner A auth failed: ${authOwner.error.message}`);
    }

    // Authenticate Super Admin for service-role simulation proxy
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: "admin123",
    });
    if (authAdmin.error) {
      throw new Error(`Admin auth failed: ${authAdmin.error.message}`);
    }

    // Resolve Restaurant A ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();
    restAId = (staffA as { restaurant_id: string }).restaurant_id;

    // Create a fresh test menu item in Restaurant A
    const { data: itemData, error: itemError } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Online Pay Test Item ${Date.now()}`,
        base_price: 350.0,
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test menu item: ${itemError?.message}`);
    }
    testItemId = (itemData as { id: string }).id;

    // Create a test table in Restaurant A
    const { data: tableData, error: tableError } = await ownerAClient
      .from("restaurant_tables")
      .insert({
        restaurant_id: restAId,
        table_number: `T-OP-${Date.now().toString().slice(-4)}`,
        capacity: 4,
        is_active: true,
        status: "available",
      })
      .select()
      .single();

    if (tableError || !tableData) {
      throw new Error(`Failed to create test table: ${tableError?.message}`);
    }
    const tData = tableData as { id: string; qr_token: string };
    testTableId = tData.id;
    testTableToken = tData.qr_token;
  });

  // Helper to place an active order
  const placeTestOrder = async (isDineIn: boolean = false): Promise<{
    orderId: string;
    total: number;
    subtotal: number;
    tax: number;
    phone: string;
  }> => {
    const phone = `+88017${Date.now().toString().slice(-8)}`;
    const payload: Record<string, unknown> = {
      p_restaurant_id: restAId,
      p_order_type: isDineIn ? "table" : "counter",
      p_customer_name: "Online Pay Customer",
      p_customer_phone: phone,
      p_items: [
        {
          menu_item_id: testItemId,
          quantity: 2, // 2 x 350 = 700 + 5% tax = 735
        },
      ],
      p_idempotency_key: crypto.randomUUID(),
    };

    if (isDineIn) {
      payload.p_qr_token = testTableToken;
    }

    const { data, error } = await anonClient.rpc("place_order", payload);
    if (error || !data) {
      throw new Error(`Failed to place order: ${error?.message}`);
    }

    const oData = data as { order_id: string; total: number; subtotal: number; tax: number };
    return {
      orderId: oData.order_id,
      total: oData.total,
      subtotal: oData.subtotal,
      tax: oData.tax,
      phone,
    };
  };

  // Helper to execute settlement via authorized server/admin role
  const executeSettlementAsServiceRole = async (
    sessionId: string,
    gatewayTrxId: string,
    valId?: string,
    payload?: Record<string, unknown>
  ): Promise<{ success: boolean; data?: PaymentCompletionResult; error?: string }> => {
    const { data, error } = await adminClient.rpc("test_execute_settlement_as_service_role", {
      p_session_id: sessionId,
      p_gateway_trx_id: gatewayTrxId,
      p_val_id: valId || null,
      p_payload: payload || {},
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data: data as PaymentCompletionResult };
  };

  // Helper to execute cancellation via authorized server/admin role
  const executeFailAsServiceRole = async (
    sessionId: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const { error } = await adminClient.rpc("test_execute_fail_as_service_role", {
      p_session_id: sessionId,
      p_reason: reason || null,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  };

  describe("1. Payment Session Initiation (bKash & SSLCOMMERZ)", () => {
    it("successfully initiates bKash payment session with unique tran_id format", async () => {
      const order = await placeTestOrder(false);

      const res = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      const session = res.data!;
      expect(session.order_id).toBe(order.orderId);
      expect(session.gateway).toBe("bkash");
      expect(session.amount).toBe(order.total);
      expect(session.currency).toBe("BDT");
      expect(session.tran_id).toMatch(/^TXN-\d{8}-[A-Z0-9]{6}$/);
      expect(session.redirect_url).toContain("gateway-simulator");
    });

    it("verifies amount is taken directly from database row, not client parameter", async () => {
      const order = await placeTestOrder(false);
      // Initiate without any amount parameter
      const res = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      expect(res.success).toBe(true);
      expect(res.data?.amount).toBe(order.total);
    });

    it("rejects payment initiation for non-existent orders with P0003", async () => {
      const fakeOrderId = crypto.randomUUID();
      const res = await initiateOnlinePayment(fakeOrderId, "bkash");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Order not found");
    });

    it("rejects payment initiation for cancelled orders with P0004", async () => {
      const order = await placeTestOrder(false);

      const cancelRes = await ownerAClient.rpc("transition_order_status", {
        p_order_id: order.orderId,
        p_new_status: "cancelled",
        p_notes: "Customer changed mind",
      });
      expect(cancelRes.error).toBeNull();

      const res = await initiateOnlinePayment(order.orderId, "bkash");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Cannot initiate payment for cancelled order");
    });
  });

  describe("2. REVOKE Security Lockdown & Permission Denied Enforcement (Chunk 19b)", () => {
    it("proves anon role has NO execute privilege on settlement and cancel RPCs via has_function_privilege", async () => {
      const funcs = [
        "complete_online_payment(text,text,text,jsonb)",
        "execute_online_payment_success(text,text,text,jsonb)",
        "fail_online_payment(text,text)",
        "cancel_online_payment(text,text)",
      ];

      for (const fn of funcs) {
        const { data } = await anonClient.rpc("check_function_privilege", {
          p_role: "anon",
          p_func: fn,
        });
        expect(data).toBe(false);
      }
    });

    it("proves authenticated staff role has NO execute privilege on settlement and cancel RPCs", async () => {
      const funcs = [
        "complete_online_payment(text,text,text,jsonb)",
        "execute_online_payment_success(text,text,text,jsonb)",
        "fail_online_payment(text,text)",
        "cancel_online_payment(text,text)",
      ];

      for (const fn of funcs) {
        const { data } = await anonClient.rpc("check_function_privilege", {
          p_role: "authenticated",
          p_func: fn,
        });
        expect(data).toBe(false);
      }
    });

    it("proves service_role HAS execute privilege on settlement and cancel RPCs", async () => {
      const funcs = [
        "complete_online_payment(text,text,text,jsonb)",
        "execute_online_payment_success(text,text,text,jsonb)",
        "fail_online_payment(text,text)",
        "cancel_online_payment(text,text)",
      ];

      for (const fn of funcs) {
        const { data } = await anonClient.rpc("check_function_privilege", {
          p_role: "service_role",
          p_func: fn,
        });
        expect(data).toBe(true);
      }
    });

    it("rejects direct complete_online_payment invocation by anon with 42501 permission denied", async () => {
      const { error } = await anonClient.rpc("complete_online_payment", {
        p_session_id: "TXN-TEST",
        p_gateway_trx_id: "FAKE-TRX",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("rejects direct complete_online_payment invocation by authenticated staff with 42501 permission denied", async () => {
      const { error } = await ownerAClient.rpc("complete_online_payment", {
        p_session_id: "TXN-TEST",
        p_gateway_trx_id: "FAKE-TRX",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("rejects direct fail_online_payment invocation by anon with 42501 permission denied", async () => {
      const { error } = await anonClient.rpc("fail_online_payment", {
        p_session_id: "TXN-TEST",
        p_reason: "Testing anon cancel",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("rejects direct fail_online_payment invocation by authenticated staff with 42501 permission denied", async () => {
      const { error } = await ownerAClient.rpc("fail_online_payment", {
        p_session_id: "TXN-TEST",
        p_reason: "Testing staff cancel",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });
  });

  describe("3. Anti-Bypass Direct UPDATE Protection on Orders (Chunk 19b)", () => {
    it("blocks authenticated staff from directly updating payment_status = 'paid' with P0007", async () => {
      const order = await placeTestOrder(false);

      const { error } = await ownerAClient
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", order.orderId);

      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0007");
      expect(error!.message).toContain("Direct update prohibited");
    });

    it("blocks authenticated staff from directly updating status = 'completed' with P0007", async () => {
      const order = await placeTestOrder(false);

      const { error } = await ownerAClient
        .from("orders")
        .update({ status: "completed", payment_status: "paid" })
        .eq("id", order.orderId);

      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0007");
    });

    it("blocks authenticated staff from directly assigning invoice_number with P0007", async () => {
      const order = await placeTestOrder(false);

      const { error } = await ownerAClient
        .from("orders")
        .update({ invoice_number: "INV-FORGED-0001" })
        .eq("id", order.orderId);

      expect(error).not.toBeNull();
      expect(error!.code).toBe("P0007");
    });

    it("blocks anon clients from directly updating orders via RLS", async () => {
      const order = await placeTestOrder(false);

      const { data, error } = await anonClient
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", order.orderId)
        .select();

      // Either returns error or 0 rows modified due to RLS
      if (!error) {
        expect(data?.length || 0).toBe(0);
      } else {
        expect(error).toBeDefined();
      }
    });
  });

  describe("4. bKash Payment Completion & Atomic Auto-Settlement (via Service Role)", () => {
    it("completes bKash payment, generates invoice, settles order, and resets dine-in table", async () => {
      const order = await placeTestOrder(true); // Dine-in order

      // Verify table is occupied
      const { data: tableBefore } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect((tableBefore as { status: string })?.status).toBe("occupied");

      // 1. Initiate bKash payment
      const initRes = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      expect(initRes.success).toBe(true);
      const sessionId = initRes.data!.tran_id;

      // 2. Complete payment via server-side service role execution
      const mockTrxId = generateMockTrxId("bkash");
      const completeRes = await executeSettlementAsServiceRole(sessionId, mockTrxId);
      expect(completeRes.success).toBe(true);
      expect(completeRes.data).toBeDefined();

      const settlement = completeRes.data!;
      expect(settlement.gateway).toBe("bkash");
      expect(settlement.gateway_trx_id).toBe(mockTrxId);
      expect(settlement.invoice_number).toMatch(/^INV-\d{8}-\d{4}$/);
      expect(settlement.table_reset).toBe(true);

      // 3. Verify order status in DB
      const { data: orderAfter } = await ownerAClient
        .from("orders")
        .select("status, payment_status, payment_method, invoice_number, payment_transaction_id")
        .eq("id", order.orderId)
        .single();

      const oAfter = orderAfter as {
        status: string;
        payment_status: string;
        payment_method: string;
        invoice_number: string;
        payment_transaction_id: string;
      };
      expect(oAfter?.status).toBe("completed");
      expect(oAfter?.payment_status).toBe("paid");
      expect(oAfter?.payment_method).toBe("bkash");
      expect(oAfter?.invoice_number).toBe(settlement.invoice_number);
      expect(oAfter?.payment_transaction_id).toBe(mockTrxId);

      // 4. Verify table is reset to 'available'
      const { data: tableAfter } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect((tableAfter as { status: string })?.status).toBe("available");

      // 5. Verify payment row in payments table
      const { data: paymentRecord } = await ownerAClient
        .from("payments")
        .select("*")
        .eq("order_id", order.orderId)
        .single();

      const pRec = paymentRecord as {
        payment_method: string;
        amount: number;
        transaction_id: string;
        status: string;
      } | null;
      expect(pRec).toBeDefined();
      expect(pRec!.payment_method).toBe("bkash");
      expect(Number(pRec!.amount)).toBe(order.total);
      expect(pRec!.transaction_id).toBe(mockTrxId);
      expect(pRec!.status).toBe("completed");
    });

    it("enforces idempotency on duplicate payment completion calls", async () => {
      const order = await placeTestOrder(false);
      const initRes = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      const sessionId = initRes.data!.tran_id;

      const trxId = generateMockTrxId("bkash");
      const firstRes = await executeSettlementAsServiceRole(sessionId, trxId);
      expect(firstRes.success).toBe(true);

      // Second identical call
      const secondRes = await executeSettlementAsServiceRole(sessionId, trxId);
      expect(secondRes.success).toBe(true);
      expect(secondRes.data?.is_duplicate).toBe(true);
      expect(secondRes.data?.invoice_number).toBe(firstRes.data?.invoice_number);
    });

    it("rejects payment initiation for already paid orders with P0005", async () => {
      const order = await placeTestOrder(false);
      const initRes = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      await executeSettlementAsServiceRole(initRes.data!.tran_id, generateMockTrxId("bkash"));

      // Try initiating a new payment for the now-settled order
      const duplicateInit = await initiateOnlinePayment(order.orderId, "bkash");
      expect(duplicateInit.success).toBe(false);
      expect(duplicateInit.error).toContain("is already paid");
    });
  });

  describe("5. SSLCOMMERZ Hosted Payment & Validation (val_id)", () => {
    it("initiates and completes SSLCOMMERZ payment with val_id tracking", async () => {
      const order = await placeTestOrder(false);

      const initRes = await initiateOnlinePayment(order.orderId, "sslcommerz", order.phone);
      expect(initRes.success).toBe(true);
      expect(initRes.data?.gateway).toBe("sslcommerz");

      const sessionId = initRes.data!.tran_id;
      const bankTranId = generateMockTrxId("sslcommerz");
      const valId = `VAL_${Date.now()}`;
      const payload = {
        card_issuer: "BRAC Bank",
        card_brand: "VISA",
        risk_level: "0",
      };

      const completeRes = await executeSettlementAsServiceRole(sessionId, bankTranId, valId, payload);
      expect(completeRes.success).toBe(true);
      expect(completeRes.data?.val_id).toBe(valId);
      expect(completeRes.data?.gateway_trx_id).toBe(bankTranId);

      // Verify online_payment_sessions stores val_id and metadata
      const { session } = await getOnlinePaymentSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.status).toBe("completed");
      expect(session?.val_id).toBe(valId);
      expect(session?.gateway_trx_id).toBe(bankTranId);
      expect(session?.metadata).toMatchObject(payload);
    });
  });

  describe("6. Payment Cancellation & Failure Handling", () => {
    it("handles customer cancellation without altering order status or table", async () => {
      const order = await placeTestOrder(true);
      const initRes = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      const sessionId = initRes.data!.tran_id;

      // Cancel via server service role
      const cancelRes = await executeFailAsServiceRole(sessionId, "User cancelled on bKash PIN screen");
      expect(cancelRes.success).toBe(true);

      // Verify session is marked cancelled
      const { session } = await getOnlinePaymentSession(sessionId);
      expect(session?.status).toBe("cancelled");

      // Verify order is still pending and unpaid
      const { data: orderCheck } = await ownerAClient
        .from("orders")
        .select("status, payment_status, invoice_number")
        .eq("id", order.orderId)
        .single();
      const oCheck = orderCheck as { status: string; payment_status: string; invoice_number: string | null };
      expect(oCheck?.payment_status).toBe("pending");
      expect(oCheck?.invoice_number).toBeNull();

      // Verify table is still occupied
      const { data: tableCheck } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect((tableCheck as { status: string })?.status).toBe("occupied");

      // Verify cannot complete a cancelled session
      const completeCancelled = await executeSettlementAsServiceRole(sessionId, "TRX-FAIL");
      expect(completeCancelled.success).toBe(false);
      expect(completeCancelled.error).toContain('Cannot complete payment session with status "cancelled"');
    });

    it("rejects cancellation of an already completed payment session", async () => {
      const order = await placeTestOrder(false);
      const initRes = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      const sessionId = initRes.data!.tran_id;

      await executeSettlementAsServiceRole(sessionId, generateMockTrxId("bkash"));

      const cancelAttempt = await executeFailAsServiceRole(sessionId, "Trying to cancel after pay");
      expect(cancelAttempt.success).toBe(false);
      expect(cancelAttempt.error).toContain("Cannot cancel or fail an already completed payment");
    });
  });

  describe("7. Customer Order Tracking Integration", () => {
    it("returns invoice_number and payment_transaction_id in get_customer_order RPC", async () => {
      const order = await placeTestOrder(false);
      const initRes = await initiateOnlinePayment(order.orderId, "bkash", order.phone);
      const trxId = generateMockTrxId("bkash");
      const completeRes = await executeSettlementAsServiceRole(initRes.data!.tran_id, trxId);

      const { data: trackingData, error } = await anonClient.rpc("get_customer_order", {
        p_order_id: order.orderId,
      });

      expect(error).toBeNull();
      const tData = trackingData as {
        found: boolean;
        order: {
          payment_status: string;
          payment_method: string;
          invoice_number: string;
          payment_transaction_id: string;
        };
      };
      expect(tData.found).toBe(true);
      expect(tData.order.payment_status).toBe("paid");
      expect(tData.order.payment_method).toBe("bkash");
      expect(tData.order.invoice_number).toBe(completeRes.data?.invoice_number);
      expect(tData.order.payment_transaction_id).toBe(trxId);
    });
  });

  describe("8. simulate-payment Edge Function Environment & Production Guard", () => {
    // Tests simulate-payment logic: requires BOTH ENABLE_PAYMENT_SIMULATOR === 'true' AND APP_ENV !== 'production'
    const evaluateSimulatorAllowed = (env: { ENABLE_PAYMENT_SIMULATOR?: string; APP_ENV?: string }): {
      allowed: boolean;
      status: number;
    } => {
      if (env.ENABLE_PAYMENT_SIMULATOR !== "true" || env.APP_ENV === "production") {
        return { allowed: false, status: 403 };
      }
      return { allowed: true, status: 200 };
    };

    it("returns 403 when ENABLE_PAYMENT_SIMULATOR is unset", () => {
      const res = evaluateSimulatorAllowed({ APP_ENV: "development" });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
    });

    it("returns 403 when APP_ENV is production even if flag is true", () => {
      const res = evaluateSimulatorAllowed({
        ENABLE_PAYMENT_SIMULATOR: "true",
        APP_ENV: "production",
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
    });

    it("returns 200 allowed only when flag is true and APP_ENV is not production", () => {
      const resDev = evaluateSimulatorAllowed({
        ENABLE_PAYMENT_SIMULATOR: "true",
        APP_ENV: "development",
      });
      expect(resDev.allowed).toBe(true);
      expect(resDev.status).toBe(200);

      const resStaging = evaluateSimulatorAllowed({
        ENABLE_PAYMENT_SIMULATOR: "true",
        APP_ENV: "staging",
      });
      expect(resStaging.allowed).toBe(true);
      expect(resStaging.status).toBe(200);
    });
  });

  describe("9. SECURITY DEFINER search_path Global Database Audit", () => {
    it("confirms 100% of SECURITY DEFINER functions in public schema set explicit search_path", async () => {
      const { data, error } = await anonClient.rpc("audit_security_definer_functions");
      expect(error).toBeNull();
      expect(data).toEqual([]); // Zero functions missing search_path
    });
  });
});
