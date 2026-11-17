import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import {
  submitSubscriptionPayment,
  verifySubscriptionPayment,
  evaluateSubscriptionGraceAndLock,
  adminOverrideSubscription,
  getPlatformBillingOverview,
} from "../../src/services/subscriptionService";

describe("Chunk 17: Super Admin Billing & SaaS Subscriptions", () => {
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let submittedInvoiceId: string;

  beforeAll(async () => {
    ownerAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authenticate Owner A
    const authA = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Set singleton session to Owner A initially
    await supabase.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });

    // Authenticate Admin
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: "admin123",
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    // Resolve Restaurant A ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();
    restAId = staffA!.restaurant_id;
  });

  describe("1. Self-Service Subscription Payment Submission", () => {
    it("submits manual bKash payment with TrxID and generates pending invoice", async () => {
      const testTrxId = `BKASH${Date.now().toString().slice(-6)}`;
      const res = await submitSubscriptionPayment({
        restaurantId: restAId,
        planCode: "growth",
        billingCycle: "monthly",
        paymentMethod: "bkash",
        transactionId: testTrxId,
        senderNumber: "01712345678",
        notes: "Automated test bKash payment",
      });

      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
      expect(res.data!.invoice_number).toMatch(/^SAAS-\d{6}-\d{4}$/);
      expect(res.data!.amount).toBe(2999.0);
      expect(res.data!.status).toBe("pending");

      submittedInvoiceId = res.data!.invoice_id;

      // Verify row in database
      const { data: invRow } = await ownerAClient
        .from("subscription_invoices")
        .select("*")
        .eq("id", submittedInvoiceId)
        .single();

      expect(invRow).toBeDefined();
      expect(invRow.transaction_id).toBe(testTrxId);
      expect(invRow.sender_number).toBe("01712345678");
      expect(invRow.status).toBe("pending");
    });

    it("submits yearly subscription payment with 20% discount rate", async () => {
      const yearlyTrxId = `YR${Date.now().toString().slice(-6)}`;
      const res = await submitSubscriptionPayment({
        restaurantId: restAId,
        planCode: "starter",
        billingCycle: "yearly",
        paymentMethod: "nagad",
        transactionId: yearlyTrxId,
      });

      expect(res.success).toBe(true);
      expect(res.data!.amount).toBe(14388.0);
      expect(res.data!.plan_code).toBe("starter");
      expect(res.data!.billing_cycle).toBe("yearly");
    });
  });

  describe("2. Super Admin Payment Verification (Approval & Rejection)", () => {
    it("approves pending payment, activates subscription, and extends billing period", async () => {
      // Super Admin approves the invoice submitted in test 1
      const { data, error } = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: submittedInvoiceId,
        p_action: "approve",
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.action).toBe("approved");
      expect(data.status).toBe("paid");

      // Verify subscription record was activated
      const { data: subRow } = await adminClient
        .from("subscriptions")
        .select("*")
        .eq("restaurant_id", restAId)
        .single();

      expect(subRow.status).toBe("active");
      expect(subRow.plan_code).toBe("growth");
      expect(new Date(subRow.current_period_end).getTime()).toBeGreaterThan(Date.now());

      // Verify restaurant is active and unlocked
      const { data: restRow } = await adminClient
        .from("restaurants")
        .select("status, is_active, block_reason")
        .eq("id", restAId)
        .single();

      expect(restRow.status).toBe("active");
      expect(restRow.is_active).toBe(true);
      expect(restRow.block_reason).toBeNull();
    });

    it("rejects an invalid payment with mandatory rejection reason", async () => {
      // First submit an invalid payment
      const fakeTrxId = `FAKE${Date.now().toString().slice(-6)}`;
      const submitRes = await submitSubscriptionPayment({
        restaurantId: restAId,
        planCode: "starter",
        paymentMethod: "bkash",
        transactionId: fakeTrxId,
      });
      const invalidInvoiceId = submitRes.data!.invoice_id;

      // Super Admin rejects with reason
      const { data, error } = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: invalidInvoiceId,
        p_action: "reject",
        p_rejection_reason: "Transaction ID not found in bKash merchant statement",
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.action).toBe("rejected");
      expect(data.status).toBe("rejected");

      // Verify invoice updated
      const { data: invRow } = await adminClient
        .from("subscription_invoices")
        .select("status, rejection_reason")
        .eq("id", invalidInvoiceId)
        .single();

      expect(invRow.status).toBe("rejected");
      expect(invRow.rejection_reason).toMatch(/bKash merchant statement/i);
    });

    it("requires rejection reason when rejecting payment", async () => {
      const submitRes = await submitSubscriptionPayment({
        restaurantId: restAId,
        planCode: "starter",
        paymentMethod: "bkash",
        transactionId: `TRX${Date.now().toString().slice(-6)}`,
      });

      const { data, error } = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: submitRes.data!.invoice_id,
        p_action: "reject",
        p_rejection_reason: "", // Empty reason
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0006");
      expect(error?.message).toMatch(/valid rejection reason is required/i);
    });
  });

  describe("3. Subscription Grace Periods & Auto-Lock Evaluation", () => {
    it("runs grace and lock sweep procedure successfully", async () => {
      const { data, error } = await adminClient.rpc("evaluate_subscription_grace_and_lock");

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("grace_period_assigned");
      expect(data).toHaveProperty("suspended_and_locked");
    });

    it("allows Super Admin to directly override plan, status, and trial days", async () => {
      const { data, error } = await adminClient.rpc("admin_override_subscription", {
        p_restaurant_id: restAId,
        p_plan_code: "enterprise",
        p_status: "active",
        p_extend_days: 60,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.plan_code).toBe("enterprise");

      // Verify restaurant was upgraded to enterprise
      const { data: restRow } = await adminClient
        .from("restaurants")
        .select("subscription_plan")
        .eq("id", restAId)
        .single();

      expect(restRow.subscription_plan).toBe("enterprise");
    });
  });

  describe("4. Platform Billing Overview & Tenant Isolation Security", () => {
    it("calculates platform-wide MRR, ARR, and active subscription counts for Super Admin", async () => {
      const { data, error } = await adminClient.rpc("get_platform_billing_overview");

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.metrics).toBeDefined();
      expect(data.metrics.total_mrr).toBeGreaterThan(0);
      expect(data.metrics.total_arr).toBe(data.metrics.total_mrr * 12);
      expect(data.metrics.active_subscriptions).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.invoices)).toBe(true);
      expect(Array.isArray(data.subscriptions)).toBe(true);
    });

    it("strictly prevents regular restaurant staff from approving subscription payments (P0002)", async () => {
      const { data, error } = await ownerAClient.rpc("verify_subscription_payment", {
        p_invoice_id: submittedInvoiceId,
        p_action: "approve",
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/Super Admin authorization required/i);
    });

    it("strictly prevents regular restaurant staff from executing admin override (P0002)", async () => {
      const { data, error } = await ownerAClient.rpc("admin_override_subscription", {
        p_restaurant_id: restAId,
        p_plan_code: "enterprise",
        p_status: "active",
        p_extend_days: 365,
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/Super Admin authorization required/i);
    });

    it("strictly prevents Owner A from submitting payment for Restaurant B (P0002)", async () => {
      const { data, error } = await ownerAClient.rpc("submit_subscription_payment", {
        p_restaurant_id: REST_B_ID,
        p_plan_code: "growth",
        p_transaction_id: "HACK123456",
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/Access denied/i);
    });
  });
});
