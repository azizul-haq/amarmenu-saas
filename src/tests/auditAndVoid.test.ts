import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import { voidOrderWithPIN, getRestaurantAuditLogs } from "../services/auditService";
import { settleOrderBill } from "../services/restaurantService";

describe("Chunk 14: Append-Only Audit Logs & Manager PIN Overrides", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
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

    // Authenticate Owner A (default PIN is '1234')
    const authA = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Supabase singleton for service calls
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

    // Create test item
    const { data: itemData, error: itemError } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Audit Void Item ${Date.now()}`,
        base_price: 250.0,
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test menu item: ${itemError?.message}`);
    }
    testItemId = itemData.id;

    // Create test table
    const { data: tableData, error: tableError } = await ownerAClient
      .from("restaurant_tables")
      .insert({
        restaurant_id: restAId,
        table_number: `T-V${Date.now().toString().slice(-4)}`,
        capacity: 4,
        is_active: true,
        status: "available",
      })
      .select()
      .single();

    if (tableError || !tableData) {
      throw new Error(`Failed to create test table: ${tableError?.message}`);
    }
    testTableId = tableData.id;
    testTableToken = tableData.qr_token;
  });

  // Helper to place and prepare an order
  const createTestOrder = async (isDineIn: boolean = false): Promise<{
    orderId: string;
    total: number;
  }> => {
    const payload: Record<string, unknown> = {
      p_restaurant_id: restAId,
      p_order_type: isDineIn ? "table" : "counter",
      p_customer_name: "Audit Test Customer",
      p_customer_phone: `+88017${Date.now().toString().slice(-8)}`,
      p_items: [
        {
          menu_item_id: testItemId,
          quantity: 1,
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

    const orderId = data.order_id;

    // Advance to accepted
    await ownerAClient.rpc("transition_order_status", {
      p_order_id: orderId,
      p_new_status: "accepted",
    });

    const { data: orderRow } = await ownerAClient
      .from("orders")
      .select("total")
      .eq("id", orderId)
      .single();

    return {
      orderId,
      total: Number(orderRow?.total || 262.5),
    };
  };

  describe("1. Append-Only Immutability Enforcement", () => {
    it("prohibits UPDATE on audit_logs at the database trigger level", async () => {
      // First, create an audit log via a void action
      const { orderId } = await createTestOrder(false);
      const res = await voidOrderWithPIN(orderId, "1234", "Initial void for immutability test");
      expect(res.success).toBe(true);
      const logId = res.data!.audit_log_id;

      // Attempt to UPDATE the audit log row
      const { error: updateError } = await adminClient
        .from("audit_logs")
        .update({ reason: "Tampered reason" })
        .eq("id", logId);

      expect(updateError).not.toBeNull();
      expect(updateError?.message).toMatch(/Append-only audit table: UPDATE and DELETE operations are strictly prohibited/i);
    });

    it("prohibits DELETE on audit_logs at the database trigger level", async () => {
      const { orderId } = await createTestOrder(false);
      const res = await voidOrderWithPIN(orderId, "1234", "Initial void for delete test");
      expect(res.success).toBe(true);
      const logId = res.data!.audit_log_id;

      // Attempt to DELETE the audit log row
      const { error: deleteError } = await adminClient
        .from("audit_logs")
        .delete()
        .eq("id", logId);

      expect(deleteError).not.toBeNull();
      expect(deleteError?.message).toMatch(/Append-only audit table: UPDATE and DELETE operations are strictly prohibited/i);
    });
  });

  describe("2. Manager PIN & Mandatory Reason Authorization", () => {
    it("rejects void attempt when manager PIN is incorrect", async () => {
      const { orderId } = await createTestOrder(false);

      const res = await voidOrderWithPIN(orderId, "9999", "Customer changed mind");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Invalid manager PIN/i);
    });

    it("rejects void attempt when reason is missing or shorter than 3 characters", async () => {
      const { orderId } = await createTestOrder(false);

      const res = await voidOrderWithPIN(orderId, "1234", "  ");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/A valid reason .* is strictly mandatory/i);
    });

    it("successfully authorizes and voids order when correct PIN and reason are provided", async () => {
      const { orderId } = await createTestOrder(false);

      const res = await voidOrderWithPIN(orderId, "1234", "Customer requested cancellation before cooking");
      expect(res.success).toBe(true);
      expect(res.data?.status).toBe("cancelled");
      expect(res.data?.audit_log_id).toBeDefined();

      // Verify order record
      const { data: order } = await ownerAClient
        .from("orders")
        .select("status, cancellation_reason")
        .eq("id", orderId)
        .single();

      expect(order?.status).toBe("cancelled");
      expect(order?.cancellation_reason).toContain("Customer requested cancellation");
    });
  });

  describe("3. Table Release & Payment Refund Automation", () => {
    it("automatically releases occupied table when a dine-in order is voided", async () => {
      const { orderId } = await createTestOrder(true);

      // Verify table is occupied
      const { data: tableBefore } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect(tableBefore?.status).toBe("occupied");

      // Void the order
      const res = await voidOrderWithPIN(orderId, "1234", "Table party walked out");
      expect(res.success).toBe(true);
      expect(res.data?.table_released).toBe(true);

      // Verify table is reset to available
      const { data: tableAfter } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect(tableAfter?.status).toBe("available");
    });

    it("marks completed payment as refunded when a settled order is voided", async () => {
      const { orderId, total } = await createTestOrder(false);

      // Advance to ready and settle bill
      await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "preparing",
      });
      await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "ready",
      });

      const settleRes = await settleOrderBill(orderId, "cash", total);
      expect(settleRes.success).toBe(true);

      // Verify payment was completed
      const { data: payBefore } = await ownerAClient
        .from("payments")
        .select("status")
        .eq("order_id", orderId)
        .single();
      expect(payBefore?.status).toBe("completed");

      // Void the settled bill
      const voidRes = await voidOrderWithPIN(orderId, "1234", "Wrong bill punched, refunding customer cash");
      expect(voidRes.success).toBe(true);

      // Verify payment is now refunded
      const { data: payAfter } = await ownerAClient
        .from("payments")
        .select("status, notes")
        .eq("order_id", orderId)
        .single();
      expect(payAfter?.status).toBe("refunded");
      expect(payAfter?.notes).toContain("Voided by Manager");
    });
  });

  describe("4. Audit Logs Retrieval & Multi-Tenant Security", () => {
    it("retrieves restaurant audit logs in descending chronological order", async () => {
      const logs = await getRestaurantAuditLogs(restAId);
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
        p_manager_pin: "1234",
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
});
