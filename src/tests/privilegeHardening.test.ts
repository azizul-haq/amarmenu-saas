import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 19c: Function Privilege Hardening & Security Definer Allowlist", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let waiterAClient: SupabaseClient;
  let adminClient: SupabaseClient;
  const serviceRole = getServiceRoleClient();

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let staffAOwnerId: string;
  let testOrderIdA: string;
  let testOrderIdB: string;

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ownerAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    waiterAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authenticate Owner A
    const authOwnerA = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authOwnerA.error) throw new Error(`Owner A auth failed: ${authOwnerA.error.message}`);

    // Authenticate Super Admin
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: "admin123",
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    // Resolve Restaurant A & Owner A staff ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("id, restaurant_id")
      .eq("email", "testowner@amarmenu.com")
      .single();
    restAId = (staffA as { restaurant_id: string; id: string }).restaurant_id;
    staffAOwnerId = (staffA as { restaurant_id: string; id: string }).id;

    // Ensure waiter user exists and is confirmed in auth.users
    const waiterEmail = "testwaiter@amarmenu.com";
    const waiterPassword = "password123";

    const waiterAuth = await waiterAClient.auth.signInWithPassword({
      email: waiterEmail,
      password: waiterPassword,
    });

    if (waiterAuth.error) {
      await anonClient.auth.signUp({
        email: waiterEmail,
        password: waiterPassword,
      });

      await serviceRole.adminQuery(
        `UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = $1`,
        [waiterEmail]
      );
      await serviceRole.adminQuery(
        `INSERT INTO restaurant_staff (auth_user_id, restaurant_id, full_name, email, role, is_active)
         SELECT id, $2, 'Test Waiter', $1, 'waiter', true
         FROM auth.users WHERE email = $1
         ON CONFLICT DO NOTHING`,
        [waiterEmail, restAId]
      );

      const retryAuth = await waiterAClient.auth.signInWithPassword({
        email: waiterEmail,
        password: waiterPassword,
      });
      if (retryAuth.error) {
        throw new Error(`Failed to authenticate waiter: ${retryAuth.error.message}`);
      }
    } else {
      await serviceRole.query(
        `UPDATE restaurant_staff SET role = 'waiter' WHERE email = $1`,
        [waiterEmail]
      );
    }

    // Ensure Owner A PIN is '1234'
    await serviceRole.rpc("set_staff_manager_pin", {
      p_staff_id: staffAOwnerId,
      p_new_pin: "1234",
    });

    // Reset failed pin counter
    await serviceRole.query(
      `UPDATE restaurant_staff SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
      [staffAOwnerId]
    );

    // Place an active order in Restaurant A
    const { data: itemDataA } = await ownerAClient
      .from("menu_items")
      .select("id")
      .eq("restaurant_id", restAId)
      .is("deleted_at", null)
      .eq("is_available", true)
      .limit(1)
      .single();

    const phoneA = `+88017${Date.now().toString().slice(-8)}`;
    const { data: orderDataA, error: orderErrA } = await anonClient.rpc("place_order", {
      p_restaurant_id: restAId,
      p_order_type: "counter",
      p_customer_name: "Privilege Test Customer",
      p_customer_phone: phoneA,
      p_items: [{ menu_item_id: (itemDataA as { id: string }).id, quantity: 1 }],
      p_idempotency_key: crypto.randomUUID(),
    });
    if (orderErrA || !orderDataA) {
      throw new Error(`Failed to place order A: ${orderErrA?.message}`);
    }
    testOrderIdA = (orderDataA as { order_id: string }).order_id;

    // Place an active order in Restaurant B
    const bItems = await serviceRole.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE restaurant_id = $1 AND deleted_at IS NULL AND is_available = true LIMIT 1`,
      [REST_B_ID]
    );
    const itemBId = bItems[0]?.id;

    const phoneB = `+88018${Date.now().toString().slice(-8)}`;
    const { data: orderDataB, error: orderErrB } = await anonClient.rpc("place_order", {
      p_restaurant_id: REST_B_ID,
      p_order_type: "counter",
      p_customer_name: "Customer Rest B",
      p_customer_phone: phoneB,
      p_items: [{ menu_item_id: itemBId, quantity: 1 }],
      p_idempotency_key: crypto.randomUUID(),
    });
    if (orderErrB || !orderDataB) {
      throw new Error(`Failed to place order B: ${orderErrB?.message}`);
    }
    testOrderIdB = (orderDataB as { order_id: string }).order_id;
  });

  describe("1. SECURITY DEFINER Global Allowlist Verification", () => {
    const ALLOWED_ANON = new Set([
      "place_order",
      "get_customer_order",
      "verify_table_qr_token",
      "initiate_online_payment",
      "create_online_payment_session",
    ]);

    const ALLOWED_AUTH = new Set([
      // Customer
      "place_order",
      "get_customer_order",
      "verify_table_qr_token",
      "initiate_online_payment",
      "create_online_payment_session",
      // Staff
      "open_cash_shift",
      "close_cash_shift",
      "get_active_cash_shift",
      "settle_order_bill",
      "void_order_with_pin",
      "verify_manager_pin",
      "set_staff_manager_pin",
      "transition_order_status",
      "record_kot_print",
      "regenerate_table_qr_token",
      "get_restaurant_sales_analytics",
      "get_mushak_6_3_report",
      "submit_subscription_payment",
      "current_restaurant_id",
      // Super admin
      "admin_create_restaurant",
      "admin_reject_request",
      "admin_toggle_restaurant_status",
      "admin_override_subscription",
      "approve_registration_request",
      "verify_subscription_payment",
      "get_platform_analytics",
      "get_platform_billing_overview",
      "is_super_admin",
      "get_table_policies",
    ]);

    const SERVICE_ROLE_ONLY = new Set([
      "complete_online_payment",
      "execute_online_payment_success",
      "fail_online_payment",
      "cancel_online_payment",
      "evaluate_subscription_grace_and_lock",
      "audit_security_definer_functions",
      "check_function_privilege",
    ]);

    it("verifies that NO public SECURITY DEFINER function has anon EXECUTE unless on ALLOWED_ANON list", async () => {
      const rows = await serviceRole.query<{
        proname: string;
        anon_exec: boolean;
      }>(`
        SELECT 
          p.proname,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.prosecdef = TRUE;
      `);

      for (const row of rows) {
        if (row.anon_exec) {
          expect(
            ALLOWED_ANON.has(row.proname),
            `Function "${row.proname}" has EXECUTE granted to anon but is not on ALLOWED_ANON allowlist!`
          ).toBe(true);
        }
      }
    });

    it("verifies that NO public SECURITY DEFINER function has authenticated EXECUTE unless on ALLOWED_AUTH list", async () => {
      const rows = await serviceRole.query<{
        proname: string;
        auth_exec: boolean;
      }>(`
        SELECT 
          p.proname,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.prosecdef = TRUE;
      `);

      for (const row of rows) {
        if (row.auth_exec) {
          expect(
            ALLOWED_AUTH.has(row.proname),
            `Function "${row.proname}" has EXECUTE granted to authenticated but is not on ALLOWED_AUTH allowlist!`
          ).toBe(true);
        }
      }
    });

    it("verifies that all SERVICE_ROLE_ONLY functions are revoked from anon and authenticated", async () => {
      const rows = await serviceRole.query<{
        proname: string;
        anon_exec: boolean;
        auth_exec: boolean;
        service_exec: boolean;
      }>(`
        SELECT 
          p.proname,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.prosecdef = TRUE;
      `);

      for (const row of rows) {
        if (SERVICE_ROLE_ONLY.has(row.proname)) {
          expect(row.anon_exec, `${row.proname} must not be callable by anon`).toBe(false);
          expect(row.auth_exec, `${row.proname} must not be callable by authenticated`).toBe(false);
          expect(row.service_exec, `${row.proname} must be callable by service_role`).toBe(true);
        }
      }
    });

    it("verifies sync_order_items_trigger has EXECUTE revoked from anon and authenticated", async () => {
      const rows = await serviceRole.query<{
        proname: string;
        anon_exec: boolean;
        auth_exec: boolean;
      }>(`
        SELECT 
          p.proname,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'sync_order_items_trigger';
      `);

      expect(rows.length).toBe(1);
      expect(rows[0].anon_exec).toBe(false);
      expect(rows[0].auth_exec).toBe(false);
    });
  });

  describe("2. Caller Authorization Enforcement (Anon Denied)", () => {
    it("denies anon from calling staff settlement function settle_order_bill (42501)", async () => {
      const { error } = await anonClient.rpc("settle_order_bill", {
        p_order_id: testOrderIdA,
        p_payment_method: "cash",
        p_tendered_amount: 500,
        p_discount: 0,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("denies anon from calling void_order_with_pin (42501)", async () => {
      const { error } = await anonClient.rpc("void_order_with_pin", {
        p_order_id: testOrderIdA,
        p_manager_pin: "1234",
        p_reason: "Customer left",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("denies anon from calling open_cash_shift (42501)", async () => {
      const { error } = await anonClient.rpc("open_cash_shift", {
        p_opening_float: 1000,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("denies anon from calling super admin function get_platform_analytics (42501)", async () => {
      const { error } = await anonClient.rpc("get_platform_analytics", {
        p_start_date: new Date(Date.now() - 86400000).toISOString(),
        p_end_date: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });
  });

  describe("3. Waiter Privilege Guard (Staff Denied Super-Admin Functions)", () => {
    it("denies waiter from calling admin_override_subscription (Super Admin required)", async () => {
      const { error } = await waiterAClient.rpc("admin_override_subscription", {
        p_restaurant_id: restAId,
        p_plan_code: "enterprise",
        p_status: "active",
        p_extend_days: 30,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Super Admin authorization required");
    });

    it("denies waiter from calling approve_registration_request (Super Admin required)", async () => {
      const { error } = await waiterAClient.rpc("approve_registration_request", {
        p_request_id: crypto.randomUUID(),
        p_subscription_plan: "growth",
      });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/Super Admin (privilege|authorization) required/i);
    });

    it("denies waiter from calling get_platform_analytics (Super Admin required)", async () => {
      const { error } = await waiterAClient.rpc("get_platform_analytics", {
        p_start_date: new Date(Date.now() - 86400000).toISOString(),
        p_end_date: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Super Admin authorization required");
    });

    it("denies waiter from calling verify_subscription_payment (Super Admin required)", async () => {
      const { error } = await waiterAClient.rpc("verify_subscription_payment", {
        p_invoice_id: crypto.randomUUID(),
        p_action: "approve",
        p_rejection_reason: null,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Super Admin authorization required");
    });
  });

  describe("4. Tenant Isolation Enforcement (Restaurant A Staff Cannot Act on Restaurant B)", () => {
    it("denies Restaurant A staff from transitioning orders of Restaurant B (42501)", async () => {
      const { error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: testOrderIdB,
        p_new_status: "accepted",
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toMatch(/orders for your own restaurant/i);
    });

    it("denies Restaurant A staff from settling orders of Restaurant B (42501)", async () => {
      const { error } = await ownerAClient.rpc("settle_order_bill", {
        p_order_id: testOrderIdB,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toMatch(/bills for your own restaurant/i);
    });

    it("denies Restaurant A staff from accessing active cash shift of Restaurant B (42501)", async () => {
      const { error } = await ownerAClient.rpc("get_active_cash_shift", {
        p_restaurant_id: REST_B_ID,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("Cross-tenant access denied");
    });
  });

  describe("5. verify_manager_pin Rate Limiting, Lockout & Audit Logging", () => {
    it("increments failed attempt count and logs to audit_logs on incorrect PIN", async () => {
      // Reset state for Owner A
      await serviceRole.query(
        `UPDATE restaurant_staff SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
        [staffAOwnerId]
      );

      // Attempt invalid PIN
      const { data, error } = await ownerAClient.rpc("verify_manager_pin", {
        p_restaurant_id: restAId,
        p_pin: "0000",
      });

      expect(error).toBeNull();
      expect(data).toBeNull(); // Returns null on invalid PIN

      // Verify failed attempt count incremented to 1
      const staffRows = await serviceRole.query<{ failed_pin_attempts: number; pin_locked_until: string | null }>(
        `SELECT failed_pin_attempts, pin_locked_until FROM restaurant_staff WHERE id = $1`,
        [staffAOwnerId]
      );
      expect(staffRows[0].failed_pin_attempts).toBe(1);
      expect(staffRows[0].pin_locked_until).toBeNull();

      // Verify audit log entry created
      const auditRows = await serviceRole.query<{
        action: string;
        entity_type: string;
        entity_id: string;
        reason: string;
      }>(
        `SELECT action, entity_type, entity_id, reason 
         FROM audit_logs 
         WHERE restaurant_id = $1 AND action = 'manager_pin_failed' 
         ORDER BY created_at DESC LIMIT 1`,
        [restAId]
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].action).toBe("manager_pin_failed");
      expect(auditRows[0].entity_type).toBe("staff_pin");
      expect(auditRows[0].entity_id).toBe(staffAOwnerId);
    });

    it("locks out user after 5 consecutive failed PIN attempts (P0008)", async () => {
      // Simulate 4 prior failed attempts
      await serviceRole.query(
        `UPDATE restaurant_staff SET failed_pin_attempts = 4, pin_locked_until = NULL WHERE id = $1`,
        [staffAOwnerId]
      );

      // 5th failed attempt triggers lockout
      const { data: data5, error: err5 } = await ownerAClient.rpc("verify_manager_pin", {
        p_restaurant_id: restAId,
        p_pin: "0000",
      });
      expect(err5).toBeNull();
      expect(data5).toBeNull();

      // Verify user is now locked out
      const staffRows = await serviceRole.query<{ failed_pin_attempts: number; pin_locked_until: string }>(
        `SELECT failed_pin_attempts, pin_locked_until FROM restaurant_staff WHERE id = $1`,
        [staffAOwnerId]
      );
      expect(staffRows[0].failed_pin_attempts).toBe(5);
      expect(staffRows[0].pin_locked_until).not.toBeNull();

      // Subsequent attempt is blocked by lockout with code P0008
      const { error: errLockout } = await ownerAClient.rpc("verify_manager_pin", {
        p_restaurant_id: restAId,
        p_pin: "1234", // Even correct PIN is blocked during lockout
      });

      expect(errLockout).not.toBeNull();
      expect(errLockout!.code).toBe("P0008");
      expect(errLockout!.message).toContain("Manager PIN verification locked out");
    });

    it("resets failed attempts counter to 0 upon successful PIN verification after unlock", async () => {
      // Clear lockout
      await serviceRole.query(
        `UPDATE restaurant_staff SET failed_pin_attempts = 2, pin_locked_until = NULL WHERE id = $1`,
        [staffAOwnerId]
      );

      // Provide correct PIN (1234)
      const { data, error } = await ownerAClient.rpc("verify_manager_pin", {
        p_restaurant_id: restAId,
        p_pin: "1234",
      });

      expect(error).toBeNull();
      expect(typeof data).toBe("string");
      expect(data).toMatch(/^[0-9a-f-]{36}$/);

      // Verify counter was reset to 0
      const staffRows = await serviceRole.query<{ failed_pin_attempts: number; pin_locked_until: string | null }>(
        `SELECT failed_pin_attempts, pin_locked_until FROM restaurant_staff WHERE id = $1`,
        [staffAOwnerId]
      );
      expect(staffRows[0].failed_pin_attempts).toBe(0);
      expect(staffRows[0].pin_locked_until).toBeNull();
    });
  });
});
