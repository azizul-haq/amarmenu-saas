import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import {
  getRestaurantSalesAnalytics,
  getMushak63Report,
} from "../services/reportService";
import { settleOrderBill } from "../services/restaurantService";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 16: Sales Analytics & Bangladesh NBR Mushak-6.3 VAT Reports", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;
  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let testItemId1: string;
  let testItemId2: string;
  let settledOrderId: string;
  let settledInvoiceNumber: string;

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

    const creds = getTestCredentials();

    // 1. Authenticate Owner A
    const authA = await ownerAClient.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Set singleton session for service calls
    await supabase.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });

    // 2. Authenticate Super Admin
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    // 3. Resolve Restaurant A ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();
    restAId = staffA!.restaurant_id;

    // 4. Ensure Restaurant A has VAT BIN and Trade License configured
    await adminClient
      .from("restaurants")
      .update({
        vat_bin_no: "123456789-0101",
        trade_license_no: "TRAD/DNCC/2026/0892",
        default_vat_rate: 5.00,
      })
      .eq("id", restAId);

    // 5. Create two distinct menu items for top items ranking test
    const { data: item1, error: err1 } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Kacchi Biryani Special ${Date.now()}`,
        base_price: 2500.0,
        is_available: true,
      })
      .select()
      .single();
    if (err1 || !item1) throw new Error(`Item 1 creation failed: ${err1?.message}`);
    testItemId1 = item1.id;

    const { data: item2, error: err2 } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Borhani Pitcher ${Date.now()}`,
        base_price: 4000.0,
        is_available: true,
      })
      .select()
      .single();
    if (err2 || !item2) throw new Error(`Item 2 creation failed: ${err2?.message}`);
    testItemId2 = item2.id;

    const customerPhone = `+88017${Date.now().toString().slice(-8)}`;
    // 6. Place, advance, and settle a test order with multiple items
    const { data: orderData, error: orderErr } = await anonClient.rpc("place_order", {
      p_restaurant_id: restAId,
      p_order_type: "counter",
      p_customer_name: "Tanvir Ahmed",
      p_customer_phone: customerPhone,
      p_items: [
        { menu_item_id: testItemId1, quantity: 2 }, // 2 x 2500 = 5000
        { menu_item_id: testItemId2, quantity: 1 }, // 1 x 4000 = 4000
      ], // Subtotal = 9000, VAT 5% = 450, Total = 9450
      p_idempotency_key: crypto.randomUUID(),
    });
    if (orderErr || !orderData) throw new Error(`Order placement failed: ${orderErr?.message}`);

    settledOrderId = orderData.order_id;
    await ownerAClient.rpc("transition_order_status", { p_order_id: settledOrderId, p_new_status: "accepted" });
    await ownerAClient.rpc("transition_order_status", { p_order_id: settledOrderId, p_new_status: "preparing" });
    await ownerAClient.rpc("transition_order_status", { p_order_id: settledOrderId, p_new_status: "ready" });

    // Settle bill via cash
    const settleRes = await settleOrderBill(settledOrderId, "cash", 10000, 50); // 50 discount -> payable 9400, change 600
    if (!settleRes.success) throw new Error(`Order settlement failed: ${settleRes.error}`);
    settledInvoiceNumber = settleRes.data!.invoice_number;
  });

  describe("1. Sales Analytics Stored Procedure (get_restaurant_sales_analytics)", () => {
    it("aggregates accurate gross sales, net sales, VAT, and discounts", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getRestaurantSalesAnalytics(restAId, start, end);
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      const summary = res.data!.summary;
      expect(summary.total_orders).toBeGreaterThanOrEqual(1);
      expect(summary.gross_sales).toBeGreaterThanOrEqual(9400);
      expect(summary.vat_collected).toBeGreaterThanOrEqual(450);
      expect(summary.discount_total).toBeGreaterThanOrEqual(50);
      expect(summary.avg_order_value).toBeGreaterThan(0);
    });

    it("aggregates payment method split correctly", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getRestaurantSalesAnalytics(restAId, start, end);
      expect(res.success).toBe(true);
      const payments = res.data!.payment_breakdown;
      expect(payments.cash_sales).toBeGreaterThanOrEqual(9400);
      expect(Array.isArray(payments.methods)).toBe(true);
    });

    it("aggregates top selling items from normalized order_items table", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getRestaurantSalesAnalytics(restAId, start, end);
      expect(res.success).toBe(true);

      const topItems = res.data!.top_items;
      expect(topItems.length).toBeGreaterThanOrEqual(2);

      const biryaniItem = topItems.find((i) => i.name.includes("Kacchi Biryani Special"));
      expect(biryaniItem).toBeDefined();
      expect(biryaniItem!.quantity).toBeGreaterThanOrEqual(2);
      expect(biryaniItem!.revenue).toBeGreaterThanOrEqual(5000);

      const borhaniItem = topItems.find((i) => i.name.includes("Borhani Pitcher"));
      expect(borhaniItem).toBeDefined();
      expect(borhaniItem!.quantity).toBeGreaterThanOrEqual(1);
      expect(borhaniItem!.revenue).toBeGreaterThanOrEqual(4000);
    });

    it("includes daily sales time-series data for charting", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getRestaurantSalesAnalytics(restAId, start, end);
      expect(res.success).toBe(true);
      expect(Array.isArray(res.data!.daily_sales)).toBe(true);
      expect(res.data!.daily_sales.length).toBeGreaterThanOrEqual(1);

      const todayEntry = res.data!.daily_sales[0];
      expect(todayEntry).toHaveProperty("date");
      expect(todayEntry).toHaveProperty("gross_sales");
      expect(todayEntry).toHaveProperty("orders_count");
    });
  });

  describe("2. Bangladesh NBR Mushak-6.3 Tax Invoice Register (get_mushak_6_3_report)", () => {
    it("returns official NBR header with BIN and Trade License", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getMushak63Report(restAId, start, end);
      expect(res.success).toBe(true);
      expect(res.data!.mushak_form).toBe("Mushak-6.3");
      expect(res.data!.restaurant.vat_bin_no).toBe("123456789-0101");
      expect(res.data!.restaurant.trade_license_no).toBe("TRAD/DNCC/2026/0892");
      expect(res.data!.restaurant.vat_rate).toBe(5.00);
    });

    it("lists sequential fiscal invoices with customer and VAT details", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getMushak63Report(restAId, start, end);
      expect(res.success).toBe(true);
      expect(res.data!.invoices.length).toBeGreaterThanOrEqual(1);

      const invoice = res.data!.invoices.find((i) => i.invoice_number === settledInvoiceNumber);
      expect(invoice).toBeDefined();
      expect(invoice!.customer_name).toBe("Tanvir Ahmed");
      expect(invoice!.customer_phone).toMatch(/^\+88017/);
      expect(invoice!.subtotal).toBe(9000);
      expect(invoice!.discount).toBe(50);
      expect(invoice!.taxable_amount).toBe(8950);
      expect(invoice!.vat_rate).toBe(5);
      expect(invoice!.vat_amount).toBe(450);
      expect(invoice!.total_amount).toBe(9400);
      expect(invoice!.payment_method).toBe("cash");
    });

    it("calculates accurate summary totals across all register rows", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getMushak63Report(restAId, start, end);
      expect(res.success).toBe(true);

      const summary = res.data!.summary;
      expect(summary.total_invoices).toBeGreaterThanOrEqual(1);
      expect(summary.total_gross).toBeGreaterThanOrEqual(9400);
      expect(summary.total_vat).toBeGreaterThanOrEqual(450);
    });
  });

  describe("3. Date Range Filtering & Edge Cases", () => {
    it("excludes orders outside the selected date boundary", async () => {
      // Query a past window (10 days ago to 5 days ago)
      const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      const res = await getMushak63Report(restAId, pastStart, pastEnd);
      expect(res.success).toBe(true);
      // Our today order should NOT appear in this past window
      const found = res.data!.invoices.some((i) => i.invoice_number === settledInvoiceNumber);
      expect(found).toBe(false);
    });

    it("rejects invalid date parameters via Zod schema", async () => {
      const invalidRes = await getRestaurantSalesAnalytics(restAId, "", "");
      expect(invalidRes.success).toBe(false);
      expect(invalidRes.error).not.toBeNull();
    });
  });

  describe("4. Security & Tenant Isolation", () => {
    it("strictly prevents Owner A from accessing Restaurant B analytics (P0002)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      // Owner A calls RPC directly for Restaurant B
      const { data, error } = await ownerAClient.rpc("get_restaurant_sales_analytics", {
        p_restaurant_id: REST_B_ID,
        p_start_date: start,
        p_end_date: end,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/Access denied/i);
    });

    it("strictly prevents Owner A from accessing Restaurant B Mushak-6.3 register (P0002)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await ownerAClient.rpc("get_mushak_6_3_report", {
        p_restaurant_id: REST_B_ID,
        p_start_date: start,
        p_end_date: end,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/Access denied/i);
    });

    it("allows Super Admin to view analytics for any restaurant", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await adminClient.rpc("get_restaurant_sales_analytics", {
        p_restaurant_id: restAId,
        p_start_date: start,
        p_end_date: end,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
    });
  });
});
