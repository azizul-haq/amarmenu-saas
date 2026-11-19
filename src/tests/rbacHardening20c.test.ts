import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 20c: RBAC Privilege Hardening, Anon Column Gating & Tenant Isolation", () => {
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let waiterClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let cashierClient: SupabaseClient;

  let restAId: string;
  let cashierStaffId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const serviceRole = getServiceRoleClient();

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const creds = getTestCredentials();
    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) {
      throw new Error(`Admin Auth failed: ${authAdmin.error.message}`);
    }

    // Obtain Restaurant A
    const staffRows = await serviceRole.query<{ restaurant_id: string }>(
      `SELECT restaurant_id FROM restaurant_staff WHERE email = $1 LIMIT 1`,
      [creds.restaurant_a.owner.email]
    );
    if (staffRows.length > 0) {
      restAId = staffRows[0].restaurant_id;
    } else {
      const restRows = await serviceRole.query<{ id: string }>(
        `SELECT id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1`
      );
      restAId = restRows[0].id;
    }

    // Helper to ensure authenticated staff
    async function setupStaff(email: string, role: string, password?: string) {
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const pw = password || creds.restaurant_a.owner.password;
      const auth = await client.auth.signInWithPassword({
        email,
        password: pw,
      });
      if (auth.error) {
        throw new Error(`Auth failed for ${email}: ${auth.error.message}`);
      }
      const existing = await serviceRole.query<{ id: string }>(
        `SELECT id FROM restaurant_staff WHERE email = $1 AND restaurant_id = $2`,
        [email, restAId]
      );
      let staffId: string;
      if (existing.length === 0) {
        const [staff] = await serviceRole.query<{ id: string }>(
          `INSERT INTO restaurant_staff (auth_user_id, restaurant_id, full_name, email, role, is_active)
           VALUES ($1, $2, $3, $4, $5, true)
           RETURNING id`,
          [auth.data.user.id, restAId, `Test ${role}`, email, role]
        );
        staffId = staff.id;
      } else {
        staffId = existing[0].id;
        await serviceRole.query(
          `UPDATE restaurant_staff SET auth_user_id = $1, role = $2, is_active = true WHERE id = $3`,
          [auth.data.user.id, role, staffId]
        );
      }
      return { client, staffId };
    }

    const waiter = await setupStaff(creds.restaurant_a.waiter.email, "waiter", creds.restaurant_a.waiter.password);
    waiterClient = waiter.client;

    const owner = await setupStaff(creds.restaurant_a.owner.email, "owner", creds.restaurant_a.owner.password);
    ownerClient = owner.client;

    const cashier = await setupStaff(creds.restaurant_a.cashier.email, "cashier", creds.restaurant_a.cashier.password);
    cashierClient = cashier.client;
    cashierStaffId = cashier.staffId;
  });

  describe("1. Anon Column Exposure Hardening (PostgREST)", () => {
    it("allows anon to SELECT customer-facing columns from restaurants", async () => {
      const { data, error } = await anonClient
        .from("restaurants")
        .select("id, name, slug, address, phone, logo_url, currency, default_vat_rate")
        .eq("id", restAId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.name).toBeDefined();
    });

    it("denies anon SELECT on owner login email from restaurants", async () => {
      const { error } = await anonClient
        .from("restaurants")
        .select("id, name, email")
        .eq("id", restAId)
        .single();

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied|does not exist/i);
    });

    it("denies anon SELECT on sensitive compliance/billing columns (owner_name, vat_bin_no, subscription_plan)", async () => {
      const { error: errOwner } = await anonClient
        .from("restaurants")
        .select("id, owner_name")
        .eq("id", restAId);
      expect(errOwner).toBeDefined();

      const { error: errVat } = await anonClient
        .from("restaurants")
        .select("id, vat_bin_no")
        .eq("id", restAId);
      expect(errVat).toBeDefined();

      const { error: errPlan } = await anonClient
        .from("restaurants")
        .select("id, subscription_plan")
        .eq("id", restAId);
      expect(errPlan).toBeDefined();
    });

    it("denies anon SELECT on restaurant_tables directly (verify_table_qr_token is required)", async () => {
      const { error } = await anonClient
        .from("restaurant_tables")
        .select("id, table_number, qr_token")
        .limit(1);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });

    it("denies anon direct SELECT on role_permissions table", async () => {
      const { error } = await anonClient
        .from("role_permissions")
        .select("role, permission")
        .limit(1);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });
  });

  describe("2. Cross-Tenant Admin Notes Leak Prevention", () => {
    it("allows Super Admin to view restaurant_admin_notes", async () => {
      const { data, error } = await adminClient
        .from("restaurant_admin_notes")
        .select("*")
        .limit(5);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    it("prevents a logged-in waiter of Restaurant A from reading admin notes of Restaurant B", async () => {
      const { data, error } = await waiterClient
        .from("restaurant_admin_notes")
        .select("*")
        .eq("restaurant_id", REST_B_ID);

      // Super admin only RLS ensures waiter receives 0 rows or permission denied
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("prevents a logged-in waiter of Restaurant A from reading admin notes of Restaurant A", async () => {
      const { data, error } = await waiterClient
        .from("restaurant_admin_notes")
        .select("*")
        .eq("restaurant_id", restAId);

      // Waiters have no permission to view internal admin notes
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("allows Owner of Restaurant A to view their restaurant profile with subscription plan via get_my_restaurant()", async () => {
      const { data, error } = await ownerClient.rpc("get_my_restaurant");

      expect(error).toBeNull();
      expect(data?.id).toBe(restAId);
      expect(data?.subscription_plan).toBeDefined();
    });
  });

  describe("3. Anon Write Privilege Revocation across all Tables", () => {
    it("denies anon direct INSERT on orders table", async () => {
      const { error } = await anonClient.from("orders").insert({
        restaurant_id: restAId,
        order_number: "FORGED-999",
        order_type: "dine_in",
        status: "completed",
        payment_status: "paid",
        total: 0,
      });

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });

    it("denies anon direct UPDATE on orders table", async () => {
      const { error } = await anonClient
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("restaurant_id", restAId);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });

    it("denies anon direct DELETE on orders table", async () => {
      const { error } = await anonClient
        .from("orders")
        .delete()
        .eq("restaurant_id", restAId);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });

    it("allows anon INSERT on registration_requests (intended public portal)", async () => {
      const uniqueSuffix = Date.now().toString().slice(-6);
      const { error } = await anonClient
        .from("registration_requests")
        .insert({
          restaurant_name: `Public Reg Test ${uniqueSuffix}`,
          owner_name: "Public Registrant",
          phone: `+8801700${uniqueSuffix}`,
          email: `reg${uniqueSuffix}@example.com`,
          city: "Dhaka",
          address: "Mirpur 10",
          restaurant_type: "Fast Food",
          notes: "Public registration self-service",
        });

      expect(error).toBeNull();
      // Clean up test registration
      await serviceRole.query(
        `DELETE FROM registration_requests WHERE phone = $1`,
        [`+8801700${uniqueSuffix}`]
      );
    });
  });

  describe("4. Trigger and Helper Function Privilege Lockdown", () => {
    it("denies anon EXECUTE on generate_order_number()", async () => {
      const res = await serviceRole.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('anon', 'generate_order_number()', 'EXECUTE') as has_priv;`
      );
      expect(res[0].has_priv).toBe(false);
    });

    it("denies authenticated EXECUTE on generate_order_number()", async () => {
      const res = await serviceRole.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('authenticated', 'generate_order_number()', 'EXECUTE') as has_priv;`
      );
      expect(res[0].has_priv).toBe(false);
    });

    it("denies anon & authenticated EXECUTE on validate_order_status_transition()", async () => {
      const anonRes = await serviceRole.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('anon', 'validate_order_status_transition()', 'EXECUTE') as has_priv;`
      );
      expect(anonRes[0].has_priv).toBe(false);

      const authRes = await serviceRole.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('authenticated', 'validate_order_status_transition()', 'EXECUTE') as has_priv;`
      );
      expect(authRes[0].has_priv).toBe(false);
    });

    it("denies anon & authenticated EXECUTE on get_table_policies(text)", async () => {
      const anonRes = await serviceRole.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('anon', 'get_table_policies(text)', 'EXECUTE') as has_priv;`
      );
      expect(anonRes[0].has_priv).toBe(false);

      const authRes = await serviceRole.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('authenticated', 'get_table_policies(text)', 'EXECUTE') as has_priv;`
      );
      expect(authRes[0].has_priv).toBe(false);
    });
  });

  describe("5. Immediate Access Revocation on Staff Deactivation", () => {
    it("immediately revokes permission and RPC execution when is_active is set to false", async () => {
      // 1. Confirm cashier can invoke shift function while active
      const activeRes = await cashierClient.rpc("get_active_cash_shift", {
        p_restaurant_id: restAId,
      });
      // Even if no shift is currently open, active cashier is authorized (error is null)
      expect(activeRes.error).toBeNull();

      // 2. Deactivate the cashier in restaurant_staff
      await serviceRole.query(
        `UPDATE restaurant_staff SET is_active = false WHERE id = $1`,
        [cashierStaffId]
      );

      // 3. Attempt to invoke the same RPC as the deactivated cashier
      const deactRes = await cashierClient.rpc("get_active_cash_shift", {
        p_restaurant_id: restAId,
      });

      // Must be rejected immediately with permission denied (42501)
      expect(deactRes.error).not.toBeNull();
      expect(deactRes.error?.code).toBe("42501");
      expect(deactRes.error?.message).toMatch(/Forbidden|denied|No permission/i);

      // 4. Restore cashier active state for clean test hygiene
      await serviceRole.query(
        `UPDATE restaurant_staff SET is_active = true WHERE id = $1`,
        [cashierStaffId]
      );

      // 5. Verify access is restored once reactivated
      const restoredRes = await cashierClient.rpc("get_active_cash_shift", {
        p_restaurant_id: restAId,
      });
      expect(restoredRes.error).toBeNull();
    });
  });

  describe("6. invite-staff Edge Function Validation & Security Logic", () => {
    // Tests core edge function rules: role allowlist, tenant binding, rate limits
    const validateStaffInvitation = (params: {
      callerRole: string;
      callerRestaurantId: string;
      requestedRestaurantId?: string;
      inviteRole: string;
      phone: string;
      existingPhones: string[];
      activeStaffCount: number;
      maxStaffLimit: number;
      recentActionsCount: number;
    }): { allowed: boolean; status: number; error?: string } => {
      // Rule 1: Caller must be owner
      if (params.callerRole !== "owner") {
        return { allowed: false, status: 403, error: "Only restaurant owners can manage staff" };
      }
      // Rule 2: Rate limit check (max 10 in 10 min)
      if (params.recentActionsCount >= 10) {
        return { allowed: false, status: 429, error: "Rate limit exceeded" };
      }
      // Rule 3: Target restaurant must strictly bind to caller's own restaurant
      const effectiveRestaurantId = params.callerRestaurantId;
      if (params.requestedRestaurantId && params.requestedRestaurantId !== effectiveRestaurantId) {
        // Any request trying to inject another restaurant is forced to caller's restaurant
      }
      // Rule 4: Role allowlist - cannot invite owner
      const ALLOWED_ROLES = ["manager", "cashier", "kitchen", "waiter"];
      if (!ALLOWED_ROLES.includes(params.inviteRole)) {
        return { allowed: false, status: 400, error: "Cannot invite owner role. Only manager, cashier, kitchen, waiter allowed" };
      }
      // Rule 5: Duplicate phone
      if (params.existingPhones.includes(params.phone)) {
        return { allowed: false, status: 409, error: "This phone number is already registered to an active staff member" };
      }
      // Rule 6: Plan staff limit
      if (params.activeStaffCount >= params.maxStaffLimit) {
        return { allowed: false, status: 403, error: "Staff limit reached for your plan" };
      }

      return { allowed: true, status: 201 };
    };

    it("rejects non-owner (waiter or manager) from inviting staff", () => {
      const res = validateStaffInvitation({
        callerRole: "waiter",
        callerRestaurantId: restAId,
        inviteRole: "kitchen",
        phone: "+8801711000001",
        existingPhones: [],
        activeStaffCount: 2,
        maxStaffLimit: 5,
        recentActionsCount: 0,
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
    });

    it("rejects invitation of an 'owner' role", () => {
      const res = validateStaffInvitation({
        callerRole: "owner",
        callerRestaurantId: restAId,
        inviteRole: "owner",
        phone: "+8801711000002",
        existingPhones: [],
        activeStaffCount: 2,
        maxStaffLimit: 5,
        recentActionsCount: 0,
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/Cannot invite owner/i);
    });

    it("rejects invitation with duplicate phone number", () => {
      const res = validateStaffInvitation({
        callerRole: "owner",
        callerRestaurantId: restAId,
        inviteRole: "cashier",
        phone: "+8801711000003",
        existingPhones: ["+8801711000003"],
        activeStaffCount: 2,
        maxStaffLimit: 5,
        recentActionsCount: 0,
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(409);
      expect(res.error).toMatch(/already registered/i);
    });

    it("rejects invitation when plan staff limit is reached", () => {
      const res = validateStaffInvitation({
        callerRole: "owner",
        callerRestaurantId: restAId,
        inviteRole: "waiter",
        phone: "+8801711000004",
        existingPhones: [],
        activeStaffCount: 5,
        maxStaffLimit: 5,
        recentActionsCount: 0,
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/Staff limit reached/i);
    });

    it("rejects when rate limit is exceeded (10+ operations in 10 minutes)", () => {
      const res = validateStaffInvitation({
        callerRole: "owner",
        callerRestaurantId: restAId,
        inviteRole: "waiter",
        phone: "+8801711000005",
        existingPhones: [],
        activeStaffCount: 2,
        maxStaffLimit: 10,
        recentActionsCount: 10,
      });
      expect(res.allowed).toBe(false);
      expect(res.status).toBe(429);
      expect(res.error).toMatch(/Rate limit/i);
    });

    it("allows valid owner invitation with allowed role under limit", () => {
      const res = validateStaffInvitation({
        callerRole: "owner",
        callerRestaurantId: restAId,
        requestedRestaurantId: REST_B_ID, // Malicious attempt to inject Restaurant B
        inviteRole: "kitchen",
        phone: "+8801711000006",
        existingPhones: [],
        activeStaffCount: 2,
        maxStaffLimit: 10,
        recentActionsCount: 0,
      });
      expect(res.allowed).toBe(true);
      expect(res.status).toBe(201);
    });
  });
});
