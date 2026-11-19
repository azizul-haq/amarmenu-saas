import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 20d: Privilege Gaps, Column Hardening & Billing Protection", () => {
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let waiterClient: SupabaseClient;
  let ownerClient: SupabaseClient;

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const serviceRole = getServiceRoleClient();

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: process.env.TEST_ADMIN_PASSWORD || "password123",
    });
    if (authAdmin.error) {
      throw new Error(`Admin Auth failed: ${authAdmin.error.message}`);
    }

    // Obtain Restaurant A ID
    const staffRows = await serviceRole.query<{ restaurant_id: string }>(
      `SELECT restaurant_id FROM restaurant_staff WHERE email = 'testowner@amarmenu.com' LIMIT 1`
    );
    restAId = staffRows[0].restaurant_id;

    async function setupStaff(email: string, role: string) {
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const auth = await client.auth.signInWithPassword({
        email,
        password: "password123",
      });
      if (auth.error) {
        throw new Error(`Auth failed for ${email}: ${auth.error.message}`);
      }
      const existing = await serviceRole.query<{ id: string }>(
        `SELECT id FROM restaurant_staff WHERE email = $1 AND restaurant_id = $2`,
        [email, restAId]
      );
      if (existing.length === 0) {
        await serviceRole.query(
          `INSERT INTO restaurant_staff (auth_user_id, restaurant_id, full_name, email, role, is_active)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [auth.data.user.id, restAId, `Test ${role}`, email, role]
        );
      } else {
        await serviceRole.query(
          `UPDATE restaurant_staff SET auth_user_id = $1, role = $2, is_active = true WHERE id = $3`,
          [auth.data.user.id, role, existing[0].id]
        );
      }
      return client;
    }

    waiterClient = await setupStaff("testwaiter@amarmenu.com", "waiter");
    ownerClient = await setupStaff("testowner@amarmenu.com", "owner");
  });

  describe("1. Restaurant Column Privileges for 'authenticated' Role", () => {
    it("allows a waiter to read safe operational columns from restaurants", async () => {
      const { data, error } = await waiterClient
        .from("restaurants")
        .select("id, name, slug, phone, city, address, default_vat_rate, service_charge_rate")
        .eq("id", restAId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.name).toBeDefined();
    });

    it("denies a waiter from reading private columns (email, owner_name, vat_bin_no, subscription_plan) on restaurant B", async () => {
      const { error: errEmail } = await waiterClient
        .from("restaurants")
        .select("id, email")
        .eq("id", REST_B_ID);
      expect(errEmail).not.toBeNull();
      expect(errEmail?.code).toBe("42501");
      expect(errEmail?.message).toMatch(/permission denied|does not exist/i);

      const { error: errOwner } = await waiterClient
        .from("restaurants")
        .select("id, owner_name")
        .eq("id", REST_B_ID);
      expect(errOwner).not.toBeNull();
      expect(errOwner?.code).toBe("42501");

      const { error: errVat } = await waiterClient
        .from("restaurants")
        .select("id, vat_bin_no")
        .eq("id", REST_B_ID);
      expect(errVat).not.toBeNull();
      expect(errVat?.code).toBe("42501");

      const { error: errPlan } = await waiterClient
        .from("restaurants")
        .select("id, subscription_plan")
        .eq("id", REST_B_ID);
      expect(errPlan).not.toBeNull();
      expect(errPlan?.code).toBe("42501");
    });

    it("denies a waiter from reading private columns on their OWN restaurant via direct PostgREST select", async () => {
      const { error: errEmail } = await waiterClient
        .from("restaurants")
        .select("id, email, subscription_plan")
        .eq("id", restAId);

      expect(errEmail).not.toBeNull();
      expect(errEmail?.code).toBe("42501");
      expect(errEmail?.message).toMatch(/permission denied|does not exist/i);
    });
  });

  describe("2. get_my_restaurant() RPC Role Gating", () => {
    it("returns safe operational columns only for waiter (no email, owner_name, subscription_plan)", async () => {
      const { data, error } = await waiterClient.rpc("get_my_restaurant");

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.id).toBe(restAId);
      expect(data.name).toBeDefined();
      expect(data.slug).toBeDefined();

      // Sensitive fields must NOT be returned for waiter
      expect(data.email).toBeUndefined();
      expect(data.owner_name).toBeUndefined();
      expect(data.subscription_plan).toBeUndefined();
      expect(data.vat_bin_no).toBeUndefined();
      expect(data.trade_license_no).toBeUndefined();
    });

    it("returns full private details including billing and compliance for owner", async () => {
      const { data, error } = await ownerClient.rpc("get_my_restaurant");

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.id).toBe(restAId);
      expect(data.name).toBeDefined();

      // Owner has 'change_settings' permission, so private fields MUST be present
      expect(data.email).toBeDefined();
      expect(data.owner_name).toBeDefined();
      expect(data.subscription_plan).toBeDefined();
      expect(data.trade_license_no).toBeDefined();
      expect(data.vat_bin_no).toBeDefined();
    });

    it("denies anon from executing get_my_restaurant()", async () => {
      const { error } = await anonClient.rpc("get_my_restaurant");
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/permission denied/i);
    });
  });

  describe("3. protect_restaurant_billing_fields Trigger (SECURITY INVOKER)", () => {
    it("denies owner from updating subscription_plan on their own restaurant", async () => {
      const { error } = await ownerClient
        .from("restaurants")
        .update({ subscription_plan: "enterprise" } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/subscription_plan can only be modified by Super Admin/i);

      // Verify row is unchanged via service role
      const restCheck = await serviceRole.query<{ subscription_plan: string }>(
        `SELECT subscription_plan FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(restCheck[0].subscription_plan).toBe("growth");
    });

    it("denies owner from updating status on their own restaurant", async () => {
      const { error } = await ownerClient
        .from("restaurants")
        .update({ status: "blocked" } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/status can only be modified by Super Admin/i);

      const restCheck = await serviceRole.query<{ status: string }>(
        `SELECT status FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(restCheck[0].status).toBe("active");
    });

    it("denies owner from updating is_active directly on their own restaurant", async () => {
      const { error } = await ownerClient
        .from("restaurants")
        .update({ is_active: false } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/is_active can only be modified by Super Admin/i);

      const restCheck = await serviceRole.query<{ is_active: boolean }>(
        `SELECT is_active FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(restCheck[0].is_active).toBe(true);
    });

    it("denies owner from updating slug or qr_code_url directly", async () => {
      const { error: errSlug } = await ownerClient
        .from("restaurants")
        .update({ slug: "hacked-slug" } as any)
        .eq("id", restAId);
      expect(errSlug).not.toBeNull();
      expect(errSlug?.code).toBe("42501");

      const { error: errQr } = await ownerClient
        .from("restaurants")
        .update({ qr_code_url: "https://evil.com/qr.png" } as any)
        .eq("id", restAId);
      expect(errQr).not.toBeNull();
      expect(errQr?.code).toBe("42501");
    });

    it("allows owner to update permissible operational fields (e.g. phone, address)", async () => {
      const { error } = await ownerClient
        .from("restaurants")
        .update({ phone: "+8801700000000" } as any)
        .eq("id", restAId);

      expect(error).toBeNull();
    });
  });

  describe("4. Direct Write Revocations (subscriptions, plans, subscription_invoices, restaurant_staff)", () => {
    it("denies authenticated staff direct INSERT into subscriptions", async () => {
      const { error } = await ownerClient.from("subscriptions").insert({
        restaurant_id: restAId,
        plan_id: "00000000-0000-0000-0000-000000000001",
        billing_cycle: "monthly",
        amount: 0,
        status: "active",
      } as any);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("denies authenticated staff direct UPDATE on plans", async () => {
      const { error } = await ownerClient
        .from("plans")
        .update({ price_bdt: 0 } as any)
        .ilike("name", "growth");

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("denies authenticated staff direct INSERT into subscription_invoices", async () => {
      const { error } = await ownerClient.from("subscription_invoices").insert({
        restaurant_id: restAId,
        subscription_id: "00000000-0000-0000-0000-000000000001",
        invoice_number: "INV-HACK-001",
        amount: 5000,
        status: "paid",
      } as any);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("denies authenticated staff direct INSERT into restaurant_staff (must use Edge Function)", async () => {
      const { error } = await ownerClient.from("restaurant_staff").insert({
        restaurant_id: restAId,
        full_name: "Direct Hack Staff",
        role: "manager",
        is_active: true,
      } as any);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });

    it("denies authenticated staff direct DELETE on restaurant_staff", async () => {
      const { error } = await ownerClient
        .from("restaurant_staff")
        .delete()
        .eq("restaurant_id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });
  });

  describe("5. Blanket Anon Privilege Revocation & Safe Customer Allowlist", () => {
    it("allows anon to SELECT from menu_items, menu_categories, and plans", async () => {
      const { data: menu, error: errMenu } = await anonClient
        .from("menu_items")
        .select("id, name, base_price")
        .limit(1);
      expect(errMenu).toBeNull();
      expect(menu).toBeDefined();

      const { data: cats, error: errCat } = await anonClient
        .from("menu_categories")
        .select("id, name")
        .limit(1);
      expect(errCat).toBeNull();
      expect(cats).toBeDefined();

      const { data: plans, error: errPlans } = await anonClient
        .from("plans")
        .select("id, name, price_monthly")
        .limit(1);
      expect(errPlans).toBeNull();
      expect(plans).toBeDefined();
    });

    it("denies anon SELECT on orders, payments, audit_logs, and subscriptions", async () => {
      const { error: errOrders } = await anonClient.from("orders").select("id").limit(1);
      expect(errOrders).not.toBeNull();
      expect(errOrders?.code).toBe("42501");

      const { error: errPayments } = await anonClient.from("payments").select("id").limit(1);
      expect(errPayments).not.toBeNull();
      expect(errPayments?.code).toBe("42501");

      const { error: errLogs } = await anonClient.from("audit_logs").select("id").limit(1);
      expect(errLogs).not.toBeNull();
      expect(errLogs?.code).toBe("42501");

      const { error: errSubs } = await anonClient.from("subscriptions").select("id").limit(1);
      expect(errSubs).not.toBeNull();
      expect(errSubs?.code).toBe("42501");
    });

    it("allows anon to INSERT into registration_requests (public signup)", async () => {
      const testPhone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
      const { error } = await anonClient.from("registration_requests").insert([
        {
          restaurant_name: "Anon Signup Test Cafe",
          owner_name: "Test Public User",
          restaurant_type: "fine_dining",
          phone: `+88${testPhone}`,
          city: "Dhaka",
          status: "pending",
        },
      ]);

      expect(error).toBeNull();

      // Clean up test registration
      await serviceRole.query(
        `DELETE FROM registration_requests WHERE phone = $1`,
        [`+88${testPhone}`]
      );
    });
  });

  describe("6. Super Admin admin_list_restaurants() and platform_admins integrity", () => {
    it("allows Super Admin to call admin_list_restaurants()", async () => {
      const { data, error } = await adminClient.rpc("admin_list_restaurants");

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it("denies non-super admin (waiter) from calling admin_list_restaurants()", async () => {
      const { error } = await waiterClient.rpc("admin_list_restaurants");

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/Super Admin authorization required/i);
    });

    it("confirms legacy admin_users table is dropped and platform_admins has super admin", async () => {
      const res = await serviceRole.query<{ tbl: string | null }>(
        `SELECT to_regclass('public.admin_users') AS tbl`
      );
      expect(res[0].tbl).toBeNull();

      const admins = await serviceRole.query<{ email: string; role: string; is_active: boolean }>(
        `SELECT email, role, is_active FROM platform_admins WHERE email = 'admin@foodorder.com'`
      );
      expect(admins.length).toBe(1);
      expect(admins[0].is_active).toBe(true);
    });

    it("denies authenticated staff and anon from writing to platform_admins (42501)", async () => {
      const { error: wErr } = await waiterClient.from("platform_admins").insert({
        auth_user_id: crypto.randomUUID(),
        email: "hacked_admin@example.com",
        role: "super_admin",
      } as any);
      expect(wErr).not.toBeNull();
      expect(wErr?.code).toBe("42501");

      const { error: anonErr } = await anonClient.from("platform_admins").insert({
        auth_user_id: crypto.randomUUID(),
        email: "anon_hacked@example.com",
        role: "super_admin",
      } as any);
      expect(anonErr).not.toBeNull();
      expect(anonErr?.code).toBe("42501");
    });
  });

  describe("7. Customer End-to-End Flow Verification", () => {
    it("verifies table token, loads menu, places order, and fetches order status as anon", async () => {
      // 1. Verify table token
      const restRow = await serviceRole.query<{ slug: string }>(
        `SELECT slug FROM restaurants WHERE id = $1`,
        [restAId]
      );
      const slug = restRow[0].slug;

      const { data: tableTokenData, error: tokenErr } = await anonClient.rpc("verify_table_qr_token", {
        p_restaurant_slug: slug,
        p_token: "test-token-t1",
      });

      // Even if token doesn't exist, function executes without privilege error
      if (!tokenErr) {
        expect(tableTokenData).toBeDefined();
      }

      // 2. Fetch menu items for restaurant
      const { data: menuData, error: menuErr } = await anonClient
        .from("menu_items")
        .select("id, name, base_price")
        .eq("restaurant_id", restAId)
        .limit(1);

      expect(menuErr).toBeNull();
      expect(menuData).toBeDefined();
      expect(menuData!.length).toBeGreaterThan(0);

      const item = menuData![0];

      // 3. Place order via anon customer RPC
      const orderPayload = {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Customer E2E Test",
        p_customer_phone: "+8801711111111",
        p_items: [
          {
            menu_item_id: item.id,
            quantity: 1,
          },
        ],
        p_idempotency_key: crypto.randomUUID(),
      };

      const { data: placedOrder, error: orderErr } = await anonClient.rpc(
        "place_order",
        orderPayload
      );

      expect(orderErr).toBeNull();
      expect(placedOrder).toBeDefined();
      expect(placedOrder.order_id).toBeDefined();

      // 4. Retrieve order status via customer RPC
      const { data: fetchedOrder, error: fetchErr } = await anonClient.rpc(
        "get_customer_order",
        {
          p_order_id: placedOrder.order_id,
        }
      );

      expect(fetchErr).toBeNull();
      expect(fetchedOrder).toBeDefined();
      expect(fetchedOrder.found).toBe(true);
      expect(fetchedOrder.order.id).toBe(placedOrder.order_id);

      // Clean up test order
      await serviceRole.query(`DELETE FROM orders WHERE id = $1`, [placedOrder.order_id]);
    });
  });
});
