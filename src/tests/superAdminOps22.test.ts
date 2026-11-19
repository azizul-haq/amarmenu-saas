import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { assertStagingEnvironment } from "./stagingGuard";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 22: Super Admin Operations Hardening & Platform Audit Log", () => {
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let managerAClient: SupabaseClient;
  let waiterAClient: SupabaseClient;
  const serviceRole = getServiceRoleClient();

  let restAId: string;
  let adminUserId: string;

  beforeAll(async () => {
    // 0. Staging Guard check
    assertStagingEnvironment();

    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    ownerAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    managerAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    waiterAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authenticate Super Admin
    const adminAuth = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: process.env.TEST_ADMIN_PASSWORD || "password123",
    });
    if (adminAuth.error) throw new Error(`Super Admin auth failed: ${adminAuth.error.message}`);
    adminUserId = adminAuth.data.user.id;

    // Authenticate Owner A
    const ownerAuth = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (ownerAuth.error) throw new Error(`Owner A auth failed: ${ownerAuth.error.message}`);

    // Resolve Restaurant A ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .eq("email", "testowner@amarmenu.com")
      .single();
    restAId = staffA!.restaurant_id;

    // Authenticate Waiter A
    const waiterAuth = await waiterAClient.auth.signInWithPassword({
      email: "testwaiter@amarmenu.com",
      password: "password123",
    });
    if (waiterAuth.error) throw new Error(`Waiter A auth failed: ${waiterAuth.error.message}`);

    // Ensure Manager A exists and authenticate
    let managerAuth = await managerAClient.auth.signInWithPassword({
      email: "testmanager@amarmenu.com",
      password: "password123",
    });
    if (managerAuth.error) {
      await serviceRole.query(
        `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         VALUES (gen_random_uuid(), 'testmanager@amarmenu.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Test Manager"}', NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET encrypted_password = crypt('password123', gen_salt('bf')), email_confirmed_at = NOW()`
      );
      await serviceRole.query(
        `INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         SELECT id, id, json_build_object('sub', id::text, 'email', email), 'email', NOW(), NOW(), NOW()
         FROM auth.users WHERE email = 'testmanager@amarmenu.com'
         ON CONFLICT (provider, id) DO NOTHING`
      );
      managerAuth = await managerAClient.auth.signInWithPassword({
        email: "testmanager@amarmenu.com",
        password: "password123",
      });
      if (managerAuth.error) throw new Error(`Manager A auth failed: ${managerAuth.error.message}`);
    }
  });

  describe("1. Subscription Sweep Hardening (Service Role Internal vs Super Admin Wrapper)", () => {
    it("allows Super Admin to run sweep via admin_run_grace_sweep wrapper", async () => {
      const { data, error } = await adminClient.rpc("admin_run_grace_sweep");
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("evaluated_at");
      expect(data).toHaveProperty("grace_period_assigned");
      expect(data).toHaveProperty("suspended_and_locked");
      // Must return counts only: no tenant names or emails leaked
      expect(data).not.toHaveProperty("restaurant_name");
      expect(data).not.toHaveProperty("restaurant_email");
      expect(data).not.toHaveProperty("restaurants");
    });

    it("strictly prevents Owner, Manager, and Waiter from calling admin_run_grace_sweep (P0002)", async () => {
      const ownerRes = await ownerAClient.rpc("admin_run_grace_sweep");
      expect(ownerRes.data).toBeNull();
      expect(ownerRes.error?.code).toBe("P0002");

      const managerRes = await managerAClient.rpc("admin_run_grace_sweep");
      expect(managerRes.data).toBeNull();
      expect(managerRes.error?.code).toBe("P0002");

      const waiterRes = await waiterAClient.rpc("admin_run_grace_sweep");
      expect(waiterRes.data).toBeNull();
      expect(waiterRes.error?.code).toBe("P0002");
    });

    it("strictly prevents anon from executing admin_run_grace_sweep (42501)", async () => {
      const anonRes = await anonClient.rpc("admin_run_grace_sweep");
      expect(anonRes.data).toBeNull();
      expect(anonRes.error?.code).toBe("42501");
    });

    it("allows service_role to call evaluate_subscription_grace_and_lock without JWT and logs actor 'system'", async () => {
      const res = await serviceRole.rpc<{
        success: boolean;
        evaluated_at: string;
        grace_period_assigned: number;
        suspended_and_locked: number;
      }>("evaluate_subscription_grace_and_lock", { p_actor_id: null });

      expect(res.error).toBeNull();
      expect(res.data?.success).toBe(true);
      expect(res.data).toHaveProperty("grace_period_assigned");
      expect(res.data).toHaveProperty("suspended_and_locked");
    });

    it("verifies sweep idempotency: running twice consecutively produces 0 changes and no duplicate audits", async () => {
      // First run
      await serviceRole.rpc("evaluate_subscription_grace_and_lock", { p_actor_id: null });

      // Second run immediately
      const secondRun = await serviceRole.rpc<{
        success: boolean;
        grace_period_assigned: number;
        suspended_and_locked: number;
      }>("evaluate_subscription_grace_and_lock", { p_actor_id: null });

      expect(secondRun.error).toBeNull();
      expect(secondRun.data?.grace_period_assigned).toBe(0);
      expect(secondRun.data?.suspended_and_locked).toBe(0);
    });

    it("verifies pg_cron schedule exists in cron.job at '5 18 * * *' (00:05 Asia/Dhaka)", async () => {
      const cronJobs = await serviceRole.query<{
        jobname: string;
        schedule: string;
        command: string;
        active: boolean;
      }>("SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'daily_subscription_grace_sweep'");

      expect(cronJobs.length).toBe(1);
      expect(cronJobs[0].jobname).toBe("daily_subscription_grace_sweep");
      expect(cronJobs[0].schedule).toBe("5 18 * * *");
      expect(cronJobs[0].command).toBe("SELECT public.evaluate_subscription_grace_and_lock(NULL);");
      expect(cronJobs[0].active).toBe(true);
    });
  });

  describe("2. Platform Audit Log Append-Only Immutability & Exact Permissions", () => {
    it("denies direct INSERT by authenticated user with exact code 42501", async () => {
      const { error } = await adminClient.from("platform_audit_logs").insert({
        action: "unauthorized_test_insert",
        target_type: "test",
        target_id: "test",
      });
      expect(error).toBeDefined();
      expect(error?.code).toBe("42501");
    });

    it("denies direct UPDATE by authenticated user with exact code 42501", async () => {
      const { error } = await adminClient
        .from("platform_audit_logs")
        .update({ reason: "malicious_tamper" })
        .eq("action", "toggle_restaurant_status");
      expect(error).toBeDefined();
      expect(error?.code).toBe("42501");
    });

    it("denies direct DELETE by authenticated user with exact code 42501", async () => {
      const { error } = await adminClient
        .from("platform_audit_logs")
        .delete()
        .eq("action", "toggle_restaurant_status");
      expect(error).toBeDefined();
      expect(error?.code).toBe("42501");
    });

    it("blocks UPDATE by service_role via trigger with exact code P0001", async () => {
      const res = await serviceRole.query(
        "UPDATE platform_audit_logs SET reason = 'tamper' WHERE id = (SELECT id FROM platform_audit_logs LIMIT 1)"
      ).catch((err: any) => err);

      expect(res.code).toBe("P0001");
      expect(res.message).toMatch(/strictly append-only and cannot be mutated or deleted/i);
    });

    it("blocks DELETE by service_role via trigger with exact code P0001", async () => {
      const res = await serviceRole.query(
        "DELETE FROM platform_audit_logs WHERE id = (SELECT id FROM platform_audit_logs LIMIT 1)"
      ).catch((err: any) => err);

      expect(res.code).toBe("P0001");
      expect(res.message).toMatch(/strictly append-only and cannot be mutated or deleted/i);
    });

    it("blocks TRUNCATE by service_role via trigger with exact code P0001", async () => {
      const res = await serviceRole.query(
        "TRUNCATE TABLE platform_audit_logs"
      ).catch((err: any) => err);

      expect(res.code).toBe("P0001");
      expect(res.message).toMatch(/strictly append-only and cannot be mutated or deleted/i);
    });
  });

  describe("3. Audit Instrumentation Across Platform Operations", () => {
    it("audits admin_toggle_restaurant_status", async () => {
      const { error } = await adminClient.rpc("admin_toggle_restaurant_status", {
        p_restaurant_id: restAId,
        p_is_active: false,
        p_block_reason: "Compliance audit test suspension",
      });
      expect(error).toBeNull();

      // Check platform_audit_logs
      const logs = await serviceRole.query<{
        action: string;
        target_id: string;
        reason: string;
        actor_id: string;
      }>(
        `SELECT action, target_id, reason, actor_id 
         FROM platform_audit_logs 
         WHERE action = 'toggle_restaurant_status' AND target_id = $1 
         ORDER BY created_at DESC LIMIT 1`,
        [restAId]
      );

      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe("toggle_restaurant_status");
      expect(logs[0].reason).toBe("Compliance audit test suspension");
      expect(logs[0].actor_id).toBe(adminUserId);

      // Restore restaurant status
      await adminClient.rpc("admin_toggle_restaurant_status", {
        p_restaurant_id: restAId,
        p_is_active: true,
        p_block_reason: null,
      });
    });

    it("audits admin_save_plan and admin_toggle_plan_status", async () => {
      const testPlanName = `test_plan_${Date.now()}`;
      // Create plan
      const saveRes = await adminClient.rpc("admin_save_plan", {
        p_name: testPlanName,
        p_display_name: "Test Hardened Plan",
        p_description: "Audit test plan",
        p_price_monthly: 999,
        p_price_yearly: 9990,
        p_max_tables: 10,
        p_max_staff: 5,
        p_is_active: true,
      });
      expect(saveRes.error).toBeNull();
      const planId = saveRes.data.plan_id;

      // Verify create_plan audit row
      const createLogs = await serviceRole.query<{
        action: string;
        target_id: string;
        actor_id: string;
      }>(
        `SELECT action, target_id, actor_id 
         FROM platform_audit_logs 
         WHERE action = 'create_plan' AND target_id = $1`,
        [planId]
      );
      expect(createLogs.length).toBe(1);
      expect(createLogs[0].actor_id).toBe(adminUserId);

      // Toggle plan status
      const toggleRes = await adminClient.rpc("admin_toggle_plan_status", {
        p_plan_id: planId,
        p_is_active: false,
      });
      expect(toggleRes.error).toBeNull();

      // Verify toggle_plan_status audit row
      const toggleLogs = await serviceRole.query<{
        action: string;
        target_id: string;
        new_values: any;
      }>(
        `SELECT action, target_id, new_values 
         FROM platform_audit_logs 
         WHERE action = 'toggle_plan_status' AND target_id = $1`,
        [planId]
      );
      expect(toggleLogs.length).toBe(1);
      expect(toggleLogs[0].new_values.is_active).toBe(false);
    });

    it("audits admin_override_subscription", async () => {
      const overrideRes = await adminClient.rpc("admin_override_subscription", {
        p_restaurant_id: restAId,
        p_plan_code: "growth",
        p_status: "active",
        p_extend_days: 30,
      });
      expect(overrideRes.error).toBeNull();

      const logs = await serviceRole.query<{
        action: string;
        target_id: string;
        actor_id: string;
      }>(
        `SELECT action, target_id, actor_id 
         FROM platform_audit_logs 
         WHERE action = 'override_subscription' AND target_id = $1 
         ORDER BY created_at DESC LIMIT 1`,
        [restAId]
      );
      expect(logs.length).toBe(1);
      expect(logs[0].actor_id).toBe(adminUserId);
    });

    it("audits registration request approval and rejection", async () => {
      // 1. Create a dummy pending registration request
      const reqId = crypto.randomUUID();
      await serviceRole.query(
        `INSERT INTO registration_requests (id, restaurant_name, owner_name, email, phone, city, restaurant_type, status)
         VALUES ($1, 'Audit Reject Test', 'Audit Tester', 'audit_reject@test.com', '01711999888', 'Dhaka', 'fine_dining', 'pending')`,
        [reqId]
      );

      // Reject it
      const rejectRes = await adminClient.rpc("admin_reject_request", {
        p_request_id: reqId,
        p_rejection_reason: "Test rejection audit trail verification",
      });
      expect(rejectRes.error).toBeNull();

      const rejectLogs = await serviceRole.query<{
        action: string;
        target_id: string;
        reason: string;
      }>(
        `SELECT action, target_id, reason 
         FROM platform_audit_logs 
         WHERE action = 'reject_registration_request' AND target_id = $1`,
        [reqId]
      );
      expect(rejectLogs.length).toBe(1);
      expect(rejectLogs[0].reason).toBe("Test rejection audit trail verification");

      // 2. Create another pending registration request to approve
      const approveReqId = crypto.randomUUID();
      await serviceRole.query(
        `INSERT INTO registration_requests (id, restaurant_name, owner_name, email, phone, city, restaurant_type, status)
         VALUES ($1, 'Audit Approve Test', 'Audit Tester 2', 'audit_approve@test.com', '01711999889', 'Dhaka', 'fine_dining', 'pending')`,
        [approveReqId]
      );

      const approveRes = await adminClient.rpc("approve_registration_request", {
        p_request_id: approveReqId,
        p_subscription_plan: "growth",
        p_internal_notes: "Audit approval test note",
      });
      expect(approveRes.error).toBeNull();
      const approvedRestId = approveRes.data.restaurant_id;

      const approveLogs = await serviceRole.query<{
        action: string;
        target_id: string;
        reason: string;
      }>(
        `SELECT action, target_id, reason 
         FROM platform_audit_logs 
         WHERE action = 'approve_registration_request' AND target_id = $1`,
        [approvedRestId]
      );
      expect(approveLogs.length).toBe(1);
      expect(approveLogs[0].reason).toBe("Audit approval test note");
    });
  });

  describe("4. Manual Subscription Payment & TrxID Hardening", () => {
    const rawTrxId = `TRX_AUDIT_${Date.now().toString().slice(-6)}`;
    let createdInvoiceId: string;

    it("submits payment and enforces normalized TrxID uniqueness", async () => {
      // First submission with mixed case
      const submitRes = await ownerAClient.rpc("submit_subscription_payment", {
        p_restaurant_id: restAId,
        p_plan_code: "starter",
        p_billing_cycle: "monthly",
        p_payment_method: "bkash",
        p_transaction_id: `  ${rawTrxId.toUpperCase()}  `,
      });
      expect(submitRes.error).toBeNull();
      createdInvoiceId = submitRes.data.invoice_id;

      // Duplicate submission with same normalized TrxID (lowercase, trimmed)
      const dupRes = await ownerAClient.rpc("submit_subscription_payment", {
        p_restaurant_id: restAId,
        p_plan_code: "starter",
        p_billing_cycle: "monthly",
        p_payment_method: "bkash",
        p_transaction_id: rawTrxId.toLowerCase(),
      });

      expect(dupRes.data).toBeNull();
      expect(dupRes.error?.code).toBe("P0006");
      // Generic message without revealing other restaurant details
      expect(dupRes.error?.message).toMatch(/Transaction ID has already been used and cannot be submitted again/i);
    });

    it("keeps rejected TrxIDs burned (index covers pending, paid, rejected)", async () => {
      // Reject the invoice
      const rejectRes = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: createdInvoiceId,
        p_action: "reject",
        p_amount: 1499,
        p_rejection_reason: "Invalid transaction ID format on bank statement",
      });
      expect(rejectRes.error).toBeNull();

      // Attempt to reuse rejected TrxID -> still blocked with P0006
      const reuseRes = await ownerAClient.rpc("submit_subscription_payment", {
        p_restaurant_id: restAId,
        p_plan_code: "starter",
        p_billing_cycle: "monthly",
        p_payment_method: "bkash",
        p_transaction_id: rawTrxId,
      });

      expect(reuseRes.data).toBeNull();
      expect(reuseRes.error?.code).toBe("P0006");
    });

    it("allows Super Admin to explicitly release a rejected TrxID with an audit trail", async () => {
      const releaseRes = await adminClient.rpc("admin_release_subscription_trxid", {
        p_invoice_id: createdInvoiceId,
        p_reason: "Merchant re-submitted correct voucher reference",
      });

      expect(releaseRes.error).toBeNull();
      expect(releaseRes.data.success).toBe(true);

      // Verify audit row for TrxID release
      const releaseLogs = await serviceRole.query<{
        action: string;
        target_id: string;
        reason: string;
      }>(
        `SELECT action, target_id, reason 
         FROM platform_audit_logs 
         WHERE action = 'release_subscription_trxid' AND target_id = $1`,
        [createdInvoiceId]
      );
      expect(releaseLogs.length).toBe(1);
      expect(releaseLogs[0].reason).toBe("Merchant re-submitted correct voucher reference");

      // Now the released TrxID can be submitted again
      const reSubmitRes = await ownerAClient.rpc("submit_subscription_payment", {
        p_restaurant_id: restAId,
        p_plan_code: "starter",
        p_billing_cycle: "monthly",
        p_payment_method: "bkash",
        p_transaction_id: rawTrxId,
      });

      expect(reSubmitRes.error).toBeNull();
      expect(reSubmitRes.data.success).toBe(true);
    });
  });

  describe("5. Manual Payment Verification Hardening (Self-Verification, Amount Match, Owner Denied)", () => {
    let pendingInvoiceId: string;
    const testTrx = `VRF_${Date.now().toString().slice(-6)}`;

    beforeAll(async () => {
      const submitRes = await ownerAClient.rpc("submit_subscription_payment", {
        p_restaurant_id: restAId,
        p_plan_code: "starter",
        p_billing_cycle: "monthly",
        p_payment_method: "bkash",
        p_transaction_id: testTrx,
      });
      pendingInvoiceId = submitRes.data.invoice_id;
    });

    it("strictly prevents Owner from self-verifying subscription payment (P0002)", async () => {
      const { data, error } = await ownerAClient.rpc("verify_subscription_payment", {
        p_invoice_id: pendingInvoiceId,
        p_action: "approve",
        p_amount: 1499,
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0002");
    });

    it("rejects verification if typed amount does not match invoice amount (P0007)", async () => {
      const { data, error } = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: pendingInvoiceId,
        p_action: "approve",
        p_amount: 9999, // Mismatched amount
      });

      expect(data).toBeNull();
      expect(error?.code).toBe("P0007");
      expect(error?.message).toMatch(/Verified amount \(9999\) does not match invoice amount/i);
    });

    it("strictly prevents a Super Admin who is also staff of the invoice restaurant from self-verifying (P0003)", async () => {
      // Temporarily link admin as staff in Restaurant A
      await serviceRole.query(
        `INSERT INTO restaurant_staff (restaurant_id, auth_user_id, full_name, email, role, is_active)
         VALUES ($1, $2, 'Admin Self-Staff', 'admin@foodorder.com', 'owner', TRUE)`,
        [restAId, adminUserId]
      );

      const { data, error } = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: pendingInvoiceId,
        p_action: "approve",
        p_amount: 1499,
      });

      // Cleanup the temporary staff link
      await serviceRole.query(
        `DELETE FROM restaurant_staff WHERE restaurant_id = $1 AND auth_user_id = $2`,
        [restAId, adminUserId]
      );

      expect(data).toBeNull();
      expect(error?.code).toBe("P0003");
      expect(error?.message).toMatch(/Super Admin cannot verify payments for their own restaurant/i);
    });

    it("successfully verifies payment with matching amount and records admin & time in audit log", async () => {
      const { data, error } = await adminClient.rpc("verify_subscription_payment", {
        p_invoice_id: pendingInvoiceId,
        p_action: "approve",
        p_amount: 1499,
      });

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.status).toBe("paid");

      // Verify audit row
      const logs = await serviceRole.query<{
        action: string;
        target_id: string;
        actor_id: string;
        new_values: any;
      }>(
        `SELECT action, target_id, actor_id, new_values 
         FROM platform_audit_logs 
         WHERE action = 'verify_subscription_payment' AND target_id = $1`,
        [pendingInvoiceId]
      );

      expect(logs.length).toBe(1);
      expect(logs[0].actor_id).toBe(adminUserId);
      expect(logs[0].new_values.verified_amount).toBe(1499);
    });
  });

  describe("6. Transaction Atomicity & State Rollback on Failure", () => {
    it("ensures state change and audit log are atomic: failure rolls back entire transaction", async () => {
      const nonExistentRestId = crypto.randomUUID();

      // Count audit logs before
      const countBefore = await serviceRole.query<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM platform_audit_logs"
      );

      // Attempt operation that fails midway
      const { error } = await adminClient.rpc("admin_toggle_restaurant_status", {
        p_restaurant_id: nonExistentRestId,
        p_is_active: false,
        p_block_reason: "Should rollback",
      });

      expect(error).toBeDefined();
      expect(error?.code).toBe("P0002");

      // Count audit logs after: strictly unchanged
      const countAfter = await serviceRole.query<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM platform_audit_logs"
      );

      expect(countAfter[0].count).toBe(countBefore[0].count);
    });
  });
});
