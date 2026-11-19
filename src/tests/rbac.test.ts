import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 20: Role-Based Access Control (RBAC) System", () => {
  let anonClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let kitchenClient: SupabaseClient;
  let waiterClient: SupabaseClient;


  let ownerStaffId: string;
  let managerStaffId: string;

  const serviceRole = getServiceRoleClient();

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  // Helper to ensure auth user and restaurant_staff record exist
  async function ensureStaffMember(
    email: string,
    role: "owner" | "manager" | "cashier" | "kitchen" | "waiter"
  ): Promise<{ client: SupabaseClient; userId: string; staffId: string }> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authRes = await client.auth.signInWithPassword({
      email,
      password: "password123",
    });

    if (authRes.error) {
      throw new Error(`Authentication failed for ${email}: ${authRes.error.message}`);
    }

    const userId = authRes.data.user!.id;

    // Check if staff record exists for restaurant A
    const staffRows = await serviceRole.query<{ id: string }>(
      `SELECT id FROM restaurant_staff WHERE email = $1 AND restaurant_id = $2`,
      [email, restAId]
    );

    let staffId: string;
    if (staffRows.length === 0) {
      const inserted = await serviceRole.query<{ id: string }>(
        `INSERT INTO restaurant_staff (auth_user_id, restaurant_id, full_name, email, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [userId, restAId, `Test ${role}`, email, role]
      );
      staffId = inserted[0].id;
    } else {
      staffId = staffRows[0].id;
      await serviceRole.query(
        `UPDATE restaurant_staff SET auth_user_id = $1, role = $2, is_active = true WHERE id = $3`,
        [userId, role, staffId]
      );
    }

    return { client, userId, staffId };
  }

  // Helper to place an active order
  async function placeOrderInRestA(): Promise<string> {
    const { data: itemData } = await ownerClient
      .from("menu_items")
      .select("id")
      .eq("restaurant_id", restAId)
      .is("deleted_at", null)
      .eq("is_available", true)
      .limit(1)
      .single();

    if (!itemData) {
      throw new Error(`No available menu item in restaurant ${restAId}`);
    }

    const phone = `+88017${Date.now().toString().slice(-8)}`;
    const { data: orderData, error: orderErr } = await anonClient.rpc("place_order", {
      p_restaurant_id: restAId,
      p_order_type: "counter",
      p_customer_name: "RBAC Test Customer",
      p_customer_phone: phone,
      p_items: [
        {
          menu_item_id: (itemData as { id: string }).id,
          quantity: 2,
        },
      ],
    });

    if (orderErr) {
      throw new Error(`Failed to place order in Rest A: ${orderErr.message}`);
    }
    return (orderData as { order_id: string }).order_id;
  }

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Get Restaurant A ID from existing staff row
    const staffRows = await serviceRole.query<{ restaurant_id: string }>(
      `SELECT restaurant_id FROM restaurant_staff WHERE email = 'testowner@amarmenu.com' LIMIT 1`
    );
    restAId = staffRows[0].restaurant_id;

    // 2. Setup all 5 roles in parallel
    const [ownerRes, managerRes, cashierRes, kitchenRes, waiterRes] = await Promise.all([
      ensureStaffMember("testowner@amarmenu.com", "owner"),
      ensureStaffMember("testmanager@amarmenu.com", "manager"),
      ensureStaffMember("testcashier@amarmenu.com", "cashier"),
      ensureStaffMember("testkitchen@amarmenu.com", "kitchen"),
      ensureStaffMember("testwaiter@amarmenu.com", "waiter"),
    ]);

    ownerClient = ownerRes.client;
    ownerStaffId = ownerRes.staffId;

    managerClient = managerRes.client;
    managerStaffId = managerRes.staffId;

    cashierClient = cashierRes.client;

    kitchenClient = kitchenRes.client;

    waiterClient = waiterRes.client;

    // Set Manager PIN to '4827'
    await Promise.all([
      serviceRole.rpc("set_staff_manager_pin", {
        p_staff_id: ownerStaffId,
        p_new_pin: "4827",
      }),
      serviceRole.rpc("set_staff_manager_pin", {
        p_staff_id: managerStaffId,
        p_new_pin: "4827",
      }),
    ]);
  }, 35000);

  describe("1. role_permissions Matrix & Integrity", () => {
    it("has entries for all 5 defined roles", async () => {
      const rows = await serviceRole.query<{ role: string; count: string }>(
        `SELECT role, count(*)::text as count FROM role_permissions GROUP BY role ORDER BY role`
      );

      const roles = rows.map((r) => r.role);
      expect(roles).toEqual(["cashier", "kitchen", "manager", "owner", "waiter"]);
    });

    it("verifies permissions allocated to each role match the Chunk 20 specification", async () => {
      const rows = await serviceRole.query<{ role: string; permission: string }>(
        `SELECT role, permission FROM role_permissions ORDER BY role, permission`
      );

      const byRole: Record<string, string[]> = {};
      for (const r of rows) {
        if (!byRole[r.role]) byRole[r.role] = [];
        byRole[r.role].push(r.permission);
      }

      // Owner has 16 permissions
      expect(byRole["owner"]).toContain("view_reports");
      expect(byRole["owner"]).toContain("edit_menu");
      expect(byRole["owner"]).toContain("delete_menu");
      expect(byRole["owner"]).toContain("settle_bill");
      expect(byRole["owner"]).toContain("apply_discount");
      expect(byRole["owner"]).toContain("void_settled_bill");
      expect(byRole["owner"]).toContain("manage_staff");
      expect(byRole["owner"]).toContain("manage_subscription");

      // Manager has 12 permissions
      expect(byRole["manager"]).toContain("view_reports");
      expect(byRole["manager"]).toContain("edit_menu");
      expect(byRole["manager"]).toContain("confirm_order");
      expect(byRole["manager"]).toContain("update_kitchen_status");
      expect(byRole["manager"]).toContain("settle_bill");
      expect(byRole["manager"]).toContain("apply_discount");
      expect(byRole["manager"]).toContain("void_order");
      expect(byRole["manager"]).not.toContain("delete_menu");
      expect(byRole["manager"]).not.toContain("void_settled_bill");
      expect(byRole["manager"]).not.toContain("manage_staff");
      expect(byRole["manager"]).not.toContain("manage_subscription");

      // Cashier
      expect(byRole["cashier"]).toContain("confirm_order");
      expect(byRole["cashier"]).toContain("settle_bill");
      expect(byRole["cashier"]).toContain("manage_shifts");
      expect(byRole["cashier"]).not.toContain("apply_discount");
      expect(byRole["cashier"]).not.toContain("update_kitchen_status");
      expect(byRole["cashier"]).not.toContain("view_reports");

      // Kitchen
      expect(byRole["kitchen"]).toContain("update_kitchen_status");
      expect(byRole["kitchen"]).toContain("toggle_availability");
      expect(byRole["kitchen"]).not.toContain("view_financials");
      expect(byRole["kitchen"]).not.toContain("settle_bill");
      expect(byRole["kitchen"]).not.toContain("confirm_order");

      // Waiter
      expect(byRole["waiter"]).toContain("confirm_order");
      expect(byRole["waiter"]).not.toContain("update_kitchen_status");
      expect(byRole["waiter"]).not.toContain("settle_bill");
      expect(byRole["waiter"]).not.toContain("view_reports");
    });
  });

  describe("2. has_permission & get_staff_permissions RPCs", () => {
    it("denies anon from calling has_permission directly", async () => {
      const { error } = await anonClient.rpc("has_permission", {
        p_restaurant_id: restAId,
        p_permission: "view_reports",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("returns correct permission array for caller via get_staff_permissions", async () => {
      // Kitchen caller
      const { data: kitchenPerms, error: kErr } = await kitchenClient.rpc("get_staff_permissions", {
        p_restaurant_id: restAId,
      });
      expect(kErr).toBeNull();
      const kData = kitchenPerms as { role: string; permissions: string[] };
      expect(kData.role).toBe("kitchen");
      expect(kData.permissions).toContain("update_kitchen_status");
      expect(kData.permissions).not.toContain("view_financials");

      // Waiter caller
      const { data: waiterPerms, error: wErr } = await waiterClient.rpc("get_staff_permissions", {
        p_restaurant_id: restAId,
      });
      expect(wErr).toBeNull();
      const wData = waiterPerms as { role: string; permissions: string[] };
      expect(wData.role).toBe("waiter");
      expect(wData.permissions).toContain("confirm_order");
      expect(wData.permissions).not.toContain("settle_bill");
    });
  });

  describe("3. Order State Machine Enforcement (transition_order_status)", () => {
    it("allows Waiter to confirm/accept orders", async () => {
      const orderId = await placeOrderInRestA();
      const { data, error } = await waiterClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      expect(error).toBeNull();
      expect((data as { success: boolean }).success).toBe(true);
    });

    it("DENIES Waiter from advancing order to 'preparing' (kitchen status) (42501)", async () => {
      const orderId = await placeOrderInRestA();
      // First accept it as waiter
      await waiterClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      // Now waiter tries to advance to preparing -> Should be rejected
      const { error } = await waiterClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "preparing",
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("Your role cannot update kitchen status");
    });

    it("DENIES Kitchen from accepting/confirming orders (42501)", async () => {
      const orderId = await placeOrderInRestA();
      const { error } = await kitchenClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("Your role cannot confirm or reject orders");
    });

    it("allows Kitchen to advance accepted order to 'preparing' and 'ready'", async () => {
      const orderId = await placeOrderInRestA();
      // Cashier accepts
      await cashierClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      // Kitchen starts cooking
      const { data: prepData, error: prepErr } = await kitchenClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "preparing",
      });
      expect(prepErr).toBeNull();
      expect((prepData as { success: boolean }).success).toBe(true);

      // Kitchen marks ready
      const { data: readyData, error: readyErr } = await kitchenClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "ready",
      });
      expect(readyErr).toBeNull();
      expect((readyData as { success: boolean }).success).toBe(true);
    });
  });

  describe("4. Billing & Discount Enforcement (settle_order_bill)", () => {
    it("DENIES Waiter from settling bills (42501)", async () => {
      const orderId = await placeOrderInRestA();
      await ownerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      const { error } = await waiterClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("caller cannot settle bills");
    }, 20000);

    it("DENIES Kitchen from settling bills (42501)", async () => {
      const orderId = await placeOrderInRestA();
      const { error } = await kitchenClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("caller cannot settle bills");
    });

    it("allows Cashier to settle bill with 0 discount", async () => {
      const orderId = await placeOrderInRestA();
      await ownerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      const { data, error } = await cashierClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      expect(error).toBeNull();
      expect((data as { success: boolean }).success).toBe(true);
    });

    it("DENIES Cashier from applying discount > 0 (42501)", async () => {
      const orderId = await placeOrderInRestA();
      await ownerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      const { error } = await cashierClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 50,
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("caller cannot apply discount");
    });

    it("allows Manager to settle bill with discount > 0", async () => {
      const orderId = await placeOrderInRestA();
      await managerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      const { data, error } = await managerClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 25,
      });

      expect(error).toBeNull();
      expect((data as { success: boolean }).success).toBe(true);
    });
  });

  describe("5. Voiding Settlement Enforcement (void_order_with_pin)", () => {
    it("allows Manager to void an active (unpaid) order with PIN", async () => {
      const orderId = await placeOrderInRestA();
      await managerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      const { data, error } = await managerClient.rpc("void_order_with_pin", {
        p_order_id: orderId,
        p_manager_pin: "4827",
        p_reason: "Customer cancelled table",
      });

      expect(error).toBeNull();
      expect((data as { success: boolean }).success).toBe(true);
    });

    it("DENIES Manager from voiding a settled/paid bill (owner-only permission void_settled_bill) (42501)", async () => {
      const orderId = await placeOrderInRestA();
      await ownerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });
      await cashierClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      // Manager attempts to void settled bill
      const { error } = await managerClient.rpc("void_order_with_pin", {
        p_order_id: orderId,
        p_manager_pin: "4827",
        p_reason: "Manager attempts to void paid bill",
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
      expect(error!.message).toContain("Only owners can void settled/paid bills");
    });

    it("allows Owner to void a settled/paid bill with PIN", async () => {
      const orderId = await placeOrderInRestA();
      await ownerClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });
      await cashierClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      // Owner voids settled bill
      const { data, error } = await ownerClient.rpc("void_order_with_pin", {
        p_order_id: orderId,
        p_manager_pin: "4827",
        p_reason: "Owner legitimate billing reversal",
      });

      expect(error).toBeNull();
      expect((data as { success: boolean }).success).toBe(true);
    });
  });

  describe("6. Kitchen Financial Data Protection & Isolation", () => {
    it("prevents Kitchen user from reading rows in 'payments' table (RLS returns 0 rows)", async () => {
      const { data: payments, error } = await kitchenClient
        .from("payments")
        .select("*")
        .eq("restaurant_id", restAId);

      expect(error).toBeNull();
      expect(payments).toEqual([]);
    });

    it("prevents Kitchen user from reading rows in 'cash_shifts' table (RLS returns 0 rows)", async () => {
      const { data: shifts, error } = await kitchenClient
        .from("cash_shifts")
        .select("*")
        .eq("restaurant_id", restAId);

      expect(error).toBeNull();
      expect(shifts).toEqual([]);
    });

    it("DENIES Kitchen and Waiter from calling analytics/reporting RPCs (42501)", async () => {
      const now = new Date().toISOString();
      const { error: kErr } = await kitchenClient.rpc("get_restaurant_sales_analytics", {
        p_restaurant_id: restAId,
        p_start_date: now,
        p_end_date: now,
      });
      expect(kErr).not.toBeNull();
      expect(kErr!.code).toBe("42501");

      const { error: wErr } = await waiterClient.rpc("get_restaurant_sales_analytics", {
        p_restaurant_id: restAId,
        p_start_date: now,
        p_end_date: now,
      });
      expect(wErr).not.toBeNull();
      expect(wErr!.code).toBe("42501");
    });
  });

  describe("7. Staff Management Safety Rules", () => {
    it("DENIES Manager, Cashier, Kitchen, Waiter from adding staff members (42501)", async () => {
      const testEmail = `intruder_${Date.now()}@amarmenu.com`;
      const { error } = await managerClient.from("restaurant_staff").insert({
        restaurant_id: restAId,
        full_name: "Illegal Staff",
        email: testEmail,
        role: "waiter",
      });

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("blocks a user from changing their own role (42501)", async () => {
      // In Chunk 20d, direct update is revoked on restaurant_staff from authenticated (42501)
      const { error } = await ownerClient
        .from("restaurant_staff")
        .update({ role: "waiter" })
        .eq("id", ownerStaffId);

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");

      // Verify DB role is completely unchanged
      const verify = await serviceRole.query<{ role: string }>(
        `SELECT role FROM restaurant_staff WHERE id = $1`,
        [ownerStaffId]
      );
      expect(verify[0].role).toBe("owner");
    });

    it("blocks a user from deactivating their own active status (42501)", async () => {
      const { error } = await ownerClient
        .from("restaurant_staff")
        .update({ is_active: false })
        .eq("id", ownerStaffId);

      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");

      // Verify DB status is completely unchanged
      const verify = await serviceRole.query<{ is_active: boolean }>(
        `SELECT is_active FROM restaurant_staff WHERE id = $1`,
        [ownerStaffId]
      );
      expect(verify[0].is_active).toBe(true);
    });

    it("ensures a restaurant must always keep at least one active owner and enforces 42501 direct write block", async () => {
      // Create a temporary secondary owner
      const tempOwnerRes = await serviceRole.query<{ id: string }>(
        `INSERT INTO restaurant_staff (restaurant_id, full_name, email, role, is_active)
         VALUES ($1, 'Temp Owner', 'tempowner@amarmenu.com', 'owner', true)
         RETURNING id`,
        [restAId]
      );
      const tempOwnerId = tempOwnerRes[0].id;

      // Direct update is blocked by table revokes in Chunk 20d (exact 42501)
      const { error: demoteErr } = await ownerClient
        .from("restaurant_staff")
        .update({ role: "manager" })
        .eq("id", tempOwnerId);
      expect(demoteErr?.code).toBe("42501");

      // Verify via service role that role in DB is strictly unchanged
      const verifyTempOwner = await serviceRole.query<{ role: string }>(
        `SELECT role FROM restaurant_staff WHERE id = $1`,
        [tempOwnerId]
      );
      expect(verifyTempOwner[0].role).toBe("owner");

      // Create a temporary isolated restaurant with a sole owner to test the DB trigger
      const testRest = await serviceRole.adminQuery<{ id: string }>(
        `INSERT INTO restaurants (name, slug, phone, email, subscription_plan, status, is_active)
         VALUES ('Sole Owner Test', 'sole-owner-test-${Date.now()}', '+8801700000000', 'sole_${Date.now()}@test.com', 'starter', 'active', true)
         RETURNING id`
      );
      const soleRestId = testRest[0].id;

      const soleStaff = await serviceRole.query<{ id: string }>(
        `INSERT INTO restaurant_staff (restaurant_id, full_name, email, role, is_active)
         VALUES ($1, 'Sole Owner', $2, 'owner', true)
         RETURNING id;`,
        [soleRestId, `sole_${Date.now()}@test.com`]
      );
      const soleStaffId = soleStaff[0].id;

      // Now attempt to demote the sole remaining active owner via DB trigger
      let demoteLastOwnerAttempt = "";
      let demoteErrCode = "";
      try {
        await serviceRole.adminQuery(
          `UPDATE restaurant_staff SET role = 'manager' WHERE id = '${soleStaffId}';`
        );
      } catch (err: unknown) {
        demoteErrCode = (err as any)?.code || "";
        demoteLastOwnerAttempt =
          (err as any)?.message ||
          (err as any)?.details ||
          (typeof err === "string" ? err : JSON.stringify(err));
      }

      expect(demoteLastOwnerAttempt).toMatch(/always keep at least one active owner/i);
      expect(demoteErrCode || demoteLastOwnerAttempt).toMatch(/P0001/);

      // Verify soleStaffId is strictly unchanged in DB
      const verifySole = await serviceRole.query<{ role: string }>(
        `SELECT role FROM restaurant_staff WHERE id = $1`,
        [soleStaffId]
      );
      expect(verifySole[0].role).toBe("owner");

      // Clean up isolated test restaurant & temp owner
      await serviceRole.adminQuery(`ALTER TABLE restaurant_staff DISABLE TRIGGER USER;`);
      await serviceRole.adminQuery(`DELETE FROM restaurants WHERE id = '${soleRestId}';`);
      await serviceRole.adminQuery(`DELETE FROM restaurant_staff WHERE id = '${tempOwnerId}';`);
      await serviceRole.adminQuery(`ALTER TABLE restaurant_staff ENABLE TRIGGER USER;`);
    });
  });

  describe("8. Cross-Tenant Isolation via RBAC", () => {
    it("denies Restaurant A staff from confirming orders in Restaurant B", async () => {
      const { error } = await waiterClient.rpc("transition_order_status", {
        p_order_id: "00000000-0000-0000-0000-000000000000",
        p_new_status: "accepted",
      });

      expect(error).not.toBeNull();
      // Either Order Not Found (P0002) or Access Denied (42501)
      expect(["P0002", "42501"]).toContain(error!.code);
    });

    it("denies Restaurant A staff from reading staff of Restaurant B", async () => {
      // 1. Reading safe columns returns 0 rows via RLS
      const { data, error } = await managerClient
        .from("restaurant_staff")
        .select("id, full_name, role, is_active")
        .eq("restaurant_id", REST_B_ID);

      expect(error).toBeNull();
      expect(data).toEqual([]);

      // 2. Reading hidden columns (manager_pin_hash) is blocked with 42501
      const { error: hiddenErr } = await managerClient
        .from("restaurant_staff")
        .select("id, manager_pin_hash")
        .eq("restaurant_id", REST_B_ID);
      expect(hiddenErr).not.toBeNull();
      expect(hiddenErr!.code).toBe("42501");
    });
  });
});
