import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import { voidOrderWithPIN, getRestaurantAuditLogs } from "../services/auditService";
import { settleOrderBill } from "../services/restaurantService";
import { getTestCredentials } from "./testCredentials";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 14: Append-Only Audit Logs & Manager PIN Overrides", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let testItemId: string;
  let testTableId: string;
  let testTableToken: string;
  const serviceDbClient = getServiceRoleClient();
  const creds = getTestCredentials();
  const PIN = creds.manager_pin || "4827";

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
    const authA = await ownerAClient.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Supabase singleton for service calls
    await supabase.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });

    // Authenticate Admin
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    // Resolve Restaurant A ID & seed fixtures
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();
    restAId = staffA!.restaurant_id;

    // Ensure manager PIN is configured to PIN for Owner A
    const { data: staffRow } = await ownerAClient
      .from("restaurant_staff")
      .select("id")
      .eq("auth_user_id", authA.data.user!.id)
      .single();

    if (staffRow) {
      await ownerAClient.rpc("set_staff_manager_pin", {
        p_staff_id: staffRow.id,
        p_new_pin: PIN,
      });
    }

    // Get an existing menu item
    const { data: items } = await ownerAClient
      .from("menu_items")
      .select("id")
      .eq("restaurant_id", restAId)
      .limit(1);

    if (items && items.length > 0) {
      testItemId = items[0].id;
    } else {
      const { data: cat } = await ownerAClient
        .from("menu_categories")
        .insert({ restaurant_id: restAId, name: "Audit Test Cat" })
        .select()
        .single();

      const { data: item } = await ownerAClient
        .from("menu_items")
        .insert({
          restaurant_id: restAId,
          category_id: cat!.id,
          name: "Audit Test Item",
          price: 150.0,
        })
        .select()
        .single();
      testItemId = item!.id;
    }

    // Get an existing active table
    const { data: tables } = await ownerAClient
      .from("restaurant_tables")
      .select("id, qr_token")
      .eq("restaurant_id", restAId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(1);

    if (tables && tables.length > 0) {
      testTableId = tables[0].id;
      testTableToken = tables[0].qr_token;
      await serviceDbClient.adminQuery(
        `UPDATE restaurant_tables SET status = 'available' WHERE id = '${testTableId}';`
      );
    } else {
      const { data: table } = await ownerAClient
        .from("restaurant_tables")
        .insert({
          restaurant_id: restAId,
          table_number: "T-AUDIT-1",
          capacity: 4,
          qr_token: "test_audit_token_12345",
        })
        .select()
        .single();
      testTableId = table!.id;
      testTableToken = table!.qr_token;
    }
  });

  // Helper to place an order and get ID
  const createTestOrder = async (dineIn: boolean = true) => {
    if (dineIn && testTableId) {
      await serviceDbClient.adminQuery(
        `UPDATE restaurant_tables SET status = 'available' WHERE id = '${testTableId}';`
      );
    }
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const { data: orderRes, error } = await anonClient.rpc("place_order", {
      p_restaurant_id: restAId,
      p_order_type: dineIn ? "table" : "counter",
      p_qr_token: dineIn ? testTableToken : null,
      p_customer_name: "Audit Tester",
      p_customer_phone: `017${randomSuffix}`,
      p_items: [{ menu_item_id: testItemId, quantity: 2 }],
    });

    if (error || !orderRes?.order_id) {
      throw new Error(`Failed to place test order: ${error?.message}`);
    }

    return {
      orderId: orderRes.order_id as string,
      orderNumber: orderRes.order_number as string,
    };
  };

  describe("1. Append-Only Immutability Enforcement", () => {
    it("prohibits UPDATE on audit_logs at the database trigger level", async () => {
      const { orderId } = await createTestOrder(true);
      const res = await voidOrderWithPIN(orderId, PIN, "Initial void for immutability test");
      expect(res.success).toBe(true);

      const logId = res.data!.audit_log_id;

      // Attempt direct UPDATE via owner client
      const { data, error } = await ownerAClient
        .from("audit_logs")
        .update({ reason: "Tampered reason" })
        .eq("id", logId);

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Append-only audit table.*prohibited/i);
    });

    it("prohibits DELETE on audit_logs at the database trigger level", async () => {
      const { orderId } = await createTestOrder(true);
      const res = await voidOrderWithPIN(orderId, PIN, "Initial void for delete test");
      expect(res.success).toBe(true);

      const logId = res.data!.audit_log_id;

      // Attempt direct DELETE via owner client
      const { data, error } = await ownerAClient
        .from("audit_logs")
        .delete()
        .eq("id", logId);

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Append-only audit table.*prohibited/i);
    });
  });

  describe("2. Manager PIN & Mandatory Reason Authorization", () => {
    it("rejects void attempt when manager PIN is incorrect", async () => {
      const { orderId } = await createTestOrder(false);

      const res = await voidOrderWithPIN(orderId, "9999", "Legitimate reason");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/invalid manager pin/i);
    });

    it("rejects void attempt when reason is missing or shorter than 3 characters", async () => {
      const { orderId } = await createTestOrder(false);

      const res = await voidOrderWithPIN(orderId, PIN, "  ");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/minimum 3 characters/i);
    });

    it("successfully authorizes and voids order when correct PIN and reason are provided", async () => {
      const { orderId } = await createTestOrder(false);

      const res = await voidOrderWithPIN(
        orderId,
        PIN,
        "Customer requested cancellation before cooking"
      );

      expect(res.success).toBe(true);
      expect(res.data?.status).toBe("cancelled");
      expect(res.data?.audit_log_id).toBeDefined();

      // Verify in database
      const { data: order } = await ownerAClient
        .from("orders")
        .select("status, cancellation_reason")
        .eq("id", orderId)
        .single();

      expect(order?.status).toBe("cancelled");
      expect(order?.cancellation_reason).toBe("Customer requested cancellation before cooking");
    });
  });

  describe("3. Table Release & Payment Refund Automation", () => {
    it("automatically releases occupied table when a dine-in order is voided", async () => {
      const { orderId } = await createTestOrder(true);

      // Verify table is initially marked occupied
      const { data: tableBefore } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect(tableBefore?.status).toBe("occupied");

      // Void the dine-in order
      const res = await voidOrderWithPIN(orderId, PIN, "Table party walked out");
      expect(res.success).toBe(true);
      expect(res.data?.table_released).toBe(true);

      // Verify table is released
      const { data: tableAfter } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect(tableAfter?.status).toBe("available");
    });

    it("marks completed payment as refunded when a settled order is voided", async () => {
      const { orderId } = await createTestOrder(false);

      // Settle bill first (tender amount greater than or equal to total)
      const { data: ord } = await ownerAClient
        .from("orders")
        .select("total")
        .eq("id", orderId)
        .single();
      const settleAmount = Number(ord?.total || 400) + 500;

      const settleRes = await settleOrderBill(orderId, "cash", settleAmount);
      expect(settleRes.success).toBe(true);

      // Verify payment row is completed
      const { data: paymentBefore } = await ownerAClient
        .from("payments")
        .select("id, status")
        .eq("order_id", orderId)
        .single();
      expect(paymentBefore?.status).toBe("completed");

      // Manager voids the settled bill
      const voidRes = await voidOrderWithPIN(
        orderId,
        PIN,
        "Wrong bill punched, refunding customer cash"
      );
      expect(voidRes.success).toBe(true);

      // Verify payment is transitioned to refunded
      const { data: paymentAfter } = await ownerAClient
        .from("payments")
        .select("status")
        .eq("id", paymentBefore!.id)
        .single();
      expect(paymentAfter?.status).toBe("refunded");
    });
  });

  describe("4. Audit Logs Retrieval & Multi-Tenant Security", () => {
    it("retrieves restaurant audit logs in descending chronological order", async () => {
      const logs = await getRestaurantAuditLogs(restAId, 10);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);

      const first = logs[0];
      expect(first.restaurant_id).toBe(restAId);
      expect(first.action).toBe("void_order");
      expect(first.reason).toBeDefined();
      expect(first.old_values).toBeDefined();
    });

    it("rejects anonymous order voiding attempts", async () => {
      const { orderId } = await createTestOrder(false);

      const { data, error } = await anonClient.rpc("void_order_with_pin", {
        p_order_id: orderId,
        p_manager_pin: PIN,
        p_reason: "Anon void attempt",
      });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("enforces tenant RLS so Restaurant A staff cannot view Restaurant B audit logs", async () => {
      // Query audit logs for Restaurant B as Owner A
      const { data: bLogs } = await ownerAClient
        .from("audit_logs")
        .select("*")
        .eq("restaurant_id", REST_B_ID);

      expect(bLogs?.length).toBe(0);
    });
  });

  describe("5. Manager PIN Validation Rules (Non-Trivial PIN Enforcement)", () => {
    it("rejects trivial manager PINs: 0000, 1234, 4321, 12345, 1111", async () => {
      const { data: staffList } = await ownerAClient
        .from("restaurant_staff")
        .select("id")
        .eq("restaurant_id", restAId)
        .eq("role", "manager")
        .limit(1);

      const targetStaffId = staffList?.[0]?.id;
      if (!targetStaffId) return;

      const invalidPins = [
        "0000", "1111", "1234", "4321", "12345",
        "01234", "012345", "43210", "543210",
        "7890", "234567", "1212"
      ];
      for (const badPin of invalidPins) {
        const { data, error } = await ownerAClient.rpc("set_staff_manager_pin", {
          p_staff_id: targetStaffId,
          p_new_pin: badPin,
        });

        expect(error).not.toBeNull();
        expect(error?.code).toBe("P0009");
        expect(error?.message).toMatch(/cannot.*repeating|cannot.*sequential|blocklist|numeric digits/i);
      }
    });

    it("allows Owner to set manager PIN and asserts audit_logs record exists with actor_role = 'owner'", async () => {
      const { data: staffList } = await ownerAClient
        .from("restaurant_staff")
        .select("id")
        .eq("restaurant_id", restAId)
        .eq("role", "manager")
        .limit(1);

      const targetStaffId = staffList?.[0]?.id;
      if (!targetStaffId) return;

      const { data, error } = await ownerAClient.rpc("set_staff_manager_pin", {
        p_staff_id: targetStaffId,
        p_new_pin: "4827",
      });

      expect(error).toBeNull();
      expect(data).toHaveProperty("success", true);

      // Verify audit_logs row created with actor_role = 'owner'
      const logs = await serviceDbClient.query<{ actor_role: string; entity_type: string; entity_id: string; action: string }>(
        "SELECT actor_role, entity_type, entity_id, action FROM audit_logs WHERE entity_id = $1 AND action = 'manager_pin_set' ORDER BY created_at DESC LIMIT 1",
        [targetStaffId]
      );
      const logEntry = logs[0];
      expect(logEntry).toBeDefined();
      expect(logEntry?.actor_role).toBe("owner");
      expect(logEntry?.entity_type).toBe("restaurant_staff");
    });

    it("allows Super Admin to set manager PIN and asserts audit_logs record exists with actor_role = 'super_admin'", async () => {
      const { data: staffList } = await ownerAClient
        .from("restaurant_staff")
        .select("id")
        .eq("restaurant_id", restAId)
        .eq("role", "manager")
        .limit(1);

      const targetStaffId = staffList?.[0]?.id;
      if (!targetStaffId) return;

      const { data, error } = await adminClient.rpc("set_staff_manager_pin", {
        p_staff_id: targetStaffId,
        p_new_pin: "9513",
      });

      expect(error).toBeNull();
      expect(data).toHaveProperty("success", true);

      // Verify audit_logs row created with actor_role = 'super_admin'
      const saLogs = await serviceDbClient.query<{ actor_role: string; actor_name: string; entity_type: string; entity_id: string; action: string }>(
        "SELECT actor_role, actor_name, entity_type, entity_id, action FROM audit_logs WHERE entity_id = $1 AND action = 'manager_pin_set' ORDER BY created_at DESC LIMIT 1",
        [targetStaffId]
      );
      const saLogEntry = saLogs[0];
      expect(saLogEntry).toBeDefined();
      expect(saLogEntry?.actor_role).toBe("super_admin");
      expect(saLogEntry?.actor_name).toBe("Super Admin");
      expect(saLogEntry?.entity_type).toBe("restaurant_staff");
    });
  });
});
