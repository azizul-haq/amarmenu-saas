import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import {
  openCashShift,
  getActiveCashShift,
  closeCashShift,
  getCashShiftsHistory,
} from "../services/shiftService";
import { settleOrderBill } from "../services/restaurantService";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 15: Cash Drawer Shifts, EOD Z-Report & Cash Reconciliation", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let testItemId: string;

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

    // Supabase singleton for service calls
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

    // Create a fresh test menu item
    const { data: itemData, error: itemError } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Shift Test Item ${Date.now()}`,
        base_price: 200.0,
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test menu item: ${itemError?.message}`);
    }
    testItemId = itemData.id;

    // Ensure any open shifts from prior aborted tests are closed
    const active = await getActiveCashShift(restAId);
    if (active.has_active_shift && active.shift_id) {
      await closeCashShift(active.shift_id, active.live_expected_cash || 0, "Cleanup prior shift");
    }
  });

  // Helper to place, advance, and settle a cash order
  const createAndSettleCashOrder = async (): Promise<number> => {
    const { data: orderData, error: orderError } = await anonClient.rpc("place_order", {
      p_restaurant_id: restAId,
      p_order_type: "counter",
      p_customer_name: "Shift Customer",
      p_customer_phone: `+88017${Date.now().toString().slice(-8)}`,
      p_items: [{ menu_item_id: testItemId, quantity: 1 }],
      p_idempotency_key: crypto.randomUUID(),
    });

    if (orderError || !orderData) {
      throw new Error(`Failed to place order: ${orderError?.message}`);
    }

    const orderId = orderData.order_id;
    await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "accepted" });
    await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "preparing" });
    await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "ready" });

    const { data: orderRow } = await ownerAClient
      .from("orders")
      .select("total")
      .eq("id", orderId)
      .single();

    const total = Number(orderRow?.total || 210);
    const settleRes = await settleOrderBill(orderId, "cash", total);
    if (!settleRes.success) {
      throw new Error(`Failed to settle order: ${settleRes.error}`);
    }

    return total;
  };

  describe("1. Cash Shift Opening & Float Management", () => {
    it("successfully opens a new shift with initial opening float", async () => {
      const openRes = await openCashShift(1500, "Morning shift opening with petty cash");
      expect(openRes.success).toBe(true);
      expect(openRes.data?.opening_float).toBe(1500);
      expect(openRes.data?.status).toBe("open");

      const active = await getActiveCashShift(restAId);
      expect(active.has_active_shift).toBe(true);
      expect(active.opening_float).toBe(1500);
      expect(active.live_expected_cash).toBe(1500);
    });

    it("prevents opening multiple overlapping shifts for the same restaurant", async () => {
      const duplicateRes = await openCashShift(2000, "Attempt duplicate open shift");
      expect(duplicateRes.success).toBe(false);
      expect(duplicateRes.error).toMatch(/An open shift is already active/i);
    });
  });

  describe("2. Live Sales Tracking & Balanced Shift Closure (Z-Report)", () => {
    it("tracks live cash sales and reconciles exact cash count with zero discrepancy", async () => {
      // Process a cash order during the open shift
      const settledAmount = await createAndSettleCashOrder();

      const active = await getActiveCashShift(restAId);
      expect(active.has_active_shift).toBe(true);
      expect(active.live_cash_sales).toBeGreaterThanOrEqual(settledAmount);
      expect(active.live_expected_cash).toBe(1500 + Number(active.live_cash_sales));

      const expectedTotal = active.live_expected_cash!;

      // Cashier counts the drawer and matches the expected cash
      const closeRes = await closeCashShift(active.shift_id!, expectedTotal, "Balanced end of morning shift");
      expect(closeRes.success).toBe(true);
      expect(closeRes.data?.status).toBe("closed");
      expect(closeRes.data?.z_report_number).toMatch(/^Z-\d{8}-/);
      expect(closeRes.data?.cash_reconciliation.is_balanced).toBe(true);
      expect(closeRes.data?.cash_reconciliation.discrepancy).toBe(0);
      expect(closeRes.data?.cash_reconciliation.actual_cash_counted).toBe(expectedTotal);

      // Verify active shift is now closed
      const activeAfter = await getActiveCashShift(restAId);
      expect(activeAfter.has_active_shift).toBe(false);
    });
  });

  describe("3. Discrepancy Detection: Shortage & Overage", () => {
    it("detects cash shortage when physical cash count is less than expected", async () => {
      // Open shift with float 2000
      const openRes = await openCashShift(2000, "Afternoon shift float");
      expect(openRes.success).toBe(true);

      const shiftId = openRes.data!.shift_id;
      const countedCash = 1850; // Short by 150
      const expectedCash = 2000;

      const closeRes = await closeCashShift(shiftId, countedCash, "Short by 150 due to missing change");
      expect(closeRes.success).toBe(true);
      expect(closeRes.data?.cash_reconciliation.expected_cash).toBe(expectedCash);
      expect(closeRes.data?.cash_reconciliation.has_shortage).toBe(true);
      expect(closeRes.data?.cash_reconciliation.discrepancy).toBe(-150);
      expect(closeRes.data?.cash_reconciliation.actual_cash_counted).toBe(1850);
    });

    it("detects cash overage when physical cash count exceeds expected", async () => {
      // Open shift with float 1000
      const openRes = await openCashShift(1000, "Evening shift float");
      expect(openRes.success).toBe(true);

      const shiftId = openRes.data!.shift_id;
      const countedCash = 1120; // Overage of 120
      const expectedCash = 1000;

      const closeRes = await closeCashShift(shiftId, countedCash, "Overage of 120 tips left in drawer");
      expect(closeRes.success).toBe(true);
      expect(closeRes.data?.cash_reconciliation.expected_cash).toBe(expectedCash);
      expect(closeRes.data?.cash_reconciliation.has_overage).toBe(true);
      expect(closeRes.data?.cash_reconciliation.discrepancy).toBe(120);
      expect(closeRes.data?.cash_reconciliation.actual_cash_counted).toBe(1120);
    });
  });

  describe("4. Shift History & Multi-Tenant Security", () => {
    it("retrieves past shift history with audit details", async () => {
      const history = await getCashShiftsHistory(restAId, 10);
      expect(history.length).toBeGreaterThanOrEqual(3);

      const latest = history[0];
      expect(latest.restaurant_id).toBe(restAId);
      expect(latest.status).toBe("closed");
      expect(latest.discrepancy).toBeDefined();
    });

    it("rejects anonymous shift opening and closing attempts", async () => {
      const { data: openData, error: openError } = await anonClient.rpc("open_cash_shift", {
        p_opening_float: 1000,
      });
      expect(openError).not.toBeNull();
      expect(openData).toBeNull();

      const { data: closeData, error: closeError } = await anonClient.rpc("close_cash_shift", {
        p_shift_id: crypto.randomUUID(),
        p_closing_count: 1000,
      });
      expect(closeError).not.toBeNull();
      expect(closeData).toBeNull();
    });

    it("enforces tenant RLS so Restaurant A cannot view Restaurant B shifts", async () => {
      const { data: bShifts } = await ownerAClient
        .from("cash_shifts")
        .select("*")
        .eq("restaurant_id", REST_B_ID);

      expect(bShifts?.length).toBe(0);
    });
  });
});
