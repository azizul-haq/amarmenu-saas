import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import {
  settleOrderBill,
  getOrderPayments,
  getOrderItemsNormalized,
} from "../services/restaurantService";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 13: Billing (Cash), Normalized Order Items, Payments & Table Reset", () => {
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

    // Authenticate Owner A
    const authA = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Authenticate Supabase singleton for service functions
    await supabase.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });

    // Authenticate Admin
    const creds = getTestCredentials();
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    // Resolve Restaurant A ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();
    restAId = staffA!.restaurant_id;

    // Create a fresh test menu item in Restaurant A
    const { data: itemData, error: itemError } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Billing Test Item ${Date.now()}`,
        base_price: 300.0,
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test menu item: ${itemError?.message}`);
    }
    testItemId = itemData.id;

    // Create a test table in Restaurant A
    const { data: tableData, error: tableError } = await ownerAClient
      .from("restaurant_tables")
      .insert({
        restaurant_id: restAId,
        table_number: `T-${Date.now().toString().slice(-4)}`,
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

  // Helper to place an order and transition it to ready
  const createReadyOrder = async (isDineIn: boolean = false): Promise<{
    orderId: string;
    total: number;
    subtotal: number;
    tax: number;
  }> => {
    const payload: Record<string, unknown> = {
      p_restaurant_id: restAId,
      p_order_type: isDineIn ? "table" : "counter",
      p_customer_name: "Billing Customer",
      p_customer_phone: `+88017${Date.now().toString().slice(-8)}`,
      p_items: [
        {
          menu_item_id: testItemId,
          quantity: 2, // 2 x 300 = 600
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

    // Advance order to 'ready'
    await ownerAClient.rpc("transition_order_status", {
      p_order_id: orderId,
      p_new_status: "accepted",
    });
    await ownerAClient.rpc("transition_order_status", {
      p_order_id: orderId,
      p_new_status: "preparing",
    });
    await ownerAClient.rpc("transition_order_status", {
      p_order_id: orderId,
      p_new_status: "ready",
    });

    const { data: orderRow } = await ownerAClient
      .from("orders")
      .select("total, subtotal, tax")
      .eq("id", orderId)
      .single();

    return {
      orderId,
      total: Number(orderRow?.total || 630),
      subtotal: Number(orderRow?.subtotal || 600),
      tax: Number(orderRow?.tax || 30),
    };
  };

  describe("1. Normalized order_items Table Synchronization & Price Immutability", () => {
    it("automatically synchronizes order_items via database trigger on order placement and guarantees price immutability", async () => {
      const { orderId } = await createReadyOrder(false);

      const items = await getOrderItemsNormalized(orderId);
      expect(items.length).toBeGreaterThan(0);

      const firstItem = items[0];
      expect(firstItem.order_id).toBe(orderId);
      expect(firstItem.restaurant_id).toBe(restAId);
      expect(firstItem.menu_item_id).toBe(testItemId);
      expect(firstItem.quantity).toBe(2);
      expect(Number(firstItem.unit_price)).toBe(300);
      expect(Number(firstItem.item_total)).toBe(600);

      // Mutate menu item price in menu_items table
      await ownerAClient
        .from("menu_items")
        .update({ base_price: 550, price: 550 } as any)
        .eq("id", testItemId);

      // Re-fetch historical order_items -> price must remain completely unchanged
      const historicalItems = await getOrderItemsNormalized(orderId);
      expect(Number(historicalItems[0].unit_price)).toBe(300);
      expect(Number(historicalItems[0].item_total)).toBe(600);

      // Restore base price back to 300
      await ownerAClient
        .from("menu_items")
        .update({ base_price: 300, price: 300 } as any)
        .eq("id", testItemId);
    });
  });

  describe("2. Dine-In Table Status Lifecycle & Reset", () => {
    it("marks table as 'occupied' when active order exists and resets to 'available' on bill settlement", async () => {
      // Place a dine-in order
      const { orderId, total } = await createReadyOrder(true);

      // Verify table is occupied
      const { data: occupiedTable } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect(occupiedTable?.status).toBe("occupied");

      // Settle the bill
      const settleRes = await settleOrderBill(orderId, "cash", total, 0, "Table bill settled");
      expect(settleRes.success).toBe(true);

      // Verify table is automatically reset to 'available'
      const { data: availableTable } = await ownerAClient
        .from("restaurant_tables")
        .select("status")
        .eq("id", testTableId)
        .single();
      expect(availableTable?.status).toBe("available");
    });
  });

  describe("3. Sequential Fiscal Invoice Numbering", () => {
    it("generates gap-free sequential invoice numbers (INV-YYYYMMDD-XXXX)", async () => {
      const order1 = await createReadyOrder(false);
      const order2 = await createReadyOrder(false);

      const res1 = await settleOrderBill(order1.orderId, "cash", order1.total);
      expect(res1.success).toBe(true);
      expect(res1.data?.invoice_number).toMatch(/^INV-\d{8}-\d{4}$/);

      const res2 = await settleOrderBill(order2.orderId, "cash", order2.total);
      expect(res2.success).toBe(true);
      expect(res2.data?.invoice_number).toMatch(/^INV-\d{8}-\d{4}$/);

      // Check sequence increment
      const seq1 = parseInt(res1.data!.invoice_number.slice(-4), 10);
      const seq2 = parseInt(res2.data!.invoice_number.slice(-4), 10);
      expect(seq2).toBe(seq1 + 1);
    });
  });

  describe("4. Cash Settlement & Financial Calculations", () => {
    it("calculates exact change return and creates payment record", async () => {
      const { orderId, total } = await createReadyOrder(false);

      const tenderedAmount = total + 370; // e.g. total is 630, customer pays 1000 cash
      const expectedChange = 370;

      const res = await settleOrderBill(orderId, "cash", tenderedAmount, 0, "Paid with 1000 note");
      expect(res.success).toBe(true);
      expect(res.data?.tendered_amount).toBe(tenderedAmount);
      expect(res.data?.change_amount).toBe(expectedChange);
      expect(res.data?.settled_at).toBeDefined();

      // Verify order record updated
      const { data: completedOrder } = await ownerAClient
        .from("orders")
        .select("status, invoice_number, tendered_amount, change_amount, payment_method")
        .eq("id", orderId)
        .single();

      expect(completedOrder?.status).toBe("completed");
      expect(completedOrder?.invoice_number).toBe(res.data?.invoice_number);
      expect(Number(completedOrder?.tendered_amount)).toBe(tenderedAmount);
      expect(Number(completedOrder?.change_amount)).toBe(expectedChange);
      expect(completedOrder?.payment_method).toBe("cash");

      // Verify payment record
      const payments = await getOrderPayments(orderId);
      expect(payments.length).toBe(1);
      const p = payments[0];
      expect(p.order_id).toBe(orderId);
      expect(p.restaurant_id).toBe(restAId);
      expect(p.payment_method).toBe("cash");
      expect(Number(p.amount)).toBe(total);
      expect(Number(p.tendered_amount)).toBe(tenderedAmount);
      expect(Number(p.change_amount)).toBe(expectedChange);
      expect(p.status).toBe("completed");
      expect(p.collected_by).toBeDefined();
    });

    it("applies cashier discount and re-evaluates payable total", async () => {
      const { orderId, total } = await createReadyOrder(false);
      const discount = 50;
      const netPayable = total - discount;

      const res = await settleOrderBill(orderId, "cash", netPayable, discount, "50 taka discount");
      expect(res.success).toBe(true);
      expect(res.data?.discount).toBe(discount);
      expect(res.data?.total).toBe(netPayable);
      expect(res.data?.change_amount).toBe(0);
    });

    it("rejects settlement when tendered cash is less than net payable", async () => {
      const { orderId, total } = await createReadyOrder(false);

      const insufficientCash = total - 100;
      const res = await settleOrderBill(orderId, "cash", insufficientCash, 0);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/is less than payable total/i);
    });
  });

  describe("5. Authorization & Multi-Tenant Security", () => {
    it("rejects anonymous bill settlement", async () => {
      const { orderId, total } = await createReadyOrder(false);

      const { data, error } = await anonClient.rpc("settle_order_bill", {
        p_order_id: orderId,
        p_payment_method: "cash",
        p_tendered_amount: total,
      });

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("rejects settlement of an order belonging to another restaurant by staff without access", async () => {
      // Create an order belonging to Restaurant B using admin
      const { data: bOrder, error: bError } = await adminClient
        .from("orders")
        .insert({
          restaurant_id: REST_B_ID,
          order_number: `B-${Date.now().toString().slice(-6)}`,
          order_type: "counter",
          items: [{ menu_item_id: testItemId, name: "B Item", quantity: 1, base_price: 100, item_total: 100 }],
          subtotal: 100,
          tax: 5,
          total: 105,
          status: "ready",
        })
        .select()
        .single();

      if (bError || !bOrder) {
        throw new Error(`Failed to create restaurant B order: ${bError?.message}`);
      }

      // Owner A attempts to settle Restaurant B's order
      const { data, error } = await ownerAClient.rpc("settle_order_bill", {
        p_order_id: bOrder.id,
        p_payment_method: "cash",
        p_tendered_amount: 105,
      });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Unauthorized: You can only settle bills for your own restaurant/i);
      expect(data).toBeNull();
    });

    it("enforces tenant RLS on payments table so anonymous or foreign users cannot access other tenant payments", async () => {
      const { orderId, total } = await createReadyOrder(false);
      await settleOrderBill(orderId, "cash", total);

      // Query payments as Anon (SELECT privilege on payments revoked from anon in Chunk 20d)
      const { data: _anonPayments, error: anonErr } = await anonClient
        .from("payments")
        .select("*")
        .eq("order_id", orderId);

      expect(anonErr?.code).toBe("42501");

      // Query payments as Owner A (authorized)
      const { data: aPayments } = await ownerAClient
        .from("payments")
        .select("*")
        .eq("order_id", orderId);

      expect(aPayments?.length).toBeGreaterThan(0);
    });
  });
});
