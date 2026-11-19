import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import { getPlatformAnalytics } from "../services/platformAnalyticsService";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 18: Super Admin Platform Analytics & Cross-Tenant Oversight", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;

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

    // Authenticate Owner A
    const authA = await ownerAClient.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Set singleton session to Super Admin for service call tests
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    await supabase.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });

    // Resolve Restaurant A ID
    const { data: staffA } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();
    restAId = staffA!.restaurant_id;

    // Ensure Restaurant A has city set
    await adminClient
      .from("restaurants")
      .update({ city: "Dhaka" })
      .eq("id", restAId);

    // Create a completed order so analytics aggregation has data on fresh replay
    const { data: item } = await ownerAClient
      .from("menu_items")
      .select("id")
      .eq("restaurant_id", restAId)
      .limit(1)
      .single();

    if (item) {
      const randomPhone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
      const { data: orderRes } = await anonClient.rpc("place_order", {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Analytics Seeder",
        p_customer_phone: randomPhone,
        p_items: [{ menu_item_id: item.id, quantity: 1 }],
      });
      if (orderRes?.order_id) {
        await ownerAClient.rpc("settle_order_bill", {
          p_order_id: orderRes.order_id,
          p_payment_method: "cash",
          p_tendered_amount: 500,
          p_discount: 0,
        });
      }
    }
  });

  describe("1. Platform GMV & Order Volume Aggregations", () => {
    it("aggregates cross-tenant GMV, completed orders, and average ticket value (asserts deltas)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const beforeRes = await getPlatformAnalytics(start, end);
      expect(beforeRes.success).toBe(true);
      const beforeGmv = beforeRes.data!.overview.total_gmv;
      const beforeOrders = beforeRes.data!.overview.total_orders;

      // Place and settle a test order of known price
      const { data: items } = await ownerAClient
        .from("menu_items")
        .select("id, base_price")
        .eq("restaurant_id", restAId)
        .limit(1);

      let item = items?.[0];
      if (!item) {
        const { data: cat } = await ownerAClient
          .from("menu_categories")
          .select("id")
          .eq("restaurant_id", restAId)
          .limit(1)
          .single();
        const catId = cat?.id;
        const { data: newItem } = await ownerAClient
          .from("menu_items")
          .insert({
            restaurant_id: restAId,
            category_id: catId,
            name: "Analytics Delta Item",
            base_price: 280,
          })
          .select("id, base_price")
          .single();
        item = newItem!;
      }

      expect(item).not.toBeNull();
      const orderPrice = Number(item!.base_price || 280);

      const randomPhone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
      const { data: orderRes } = await anonClient.rpc("place_order", {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Delta Test Customer",
        p_customer_phone: randomPhone,
        p_items: [{ menu_item_id: item!.id, quantity: 1 }],
      });
      expect(orderRes?.order_id).toBeDefined();

      await ownerAClient.rpc("settle_order_bill", {
        p_order_id: orderRes.order_id,
        p_payment_method: "cash",
        p_tendered_amount: 1000,
        p_discount: 0,
      });

      const afterRes = await getPlatformAnalytics(start, end);
      expect(afterRes.success).toBe(true);

      const afterGmv = afterRes.data!.overview.total_gmv;
      const afterOrders = afterRes.data!.overview.total_orders;

      // Assert deltas rather than relying on absolute totals
      expect(afterGmv - beforeGmv).toBeGreaterThanOrEqual(orderPrice);
      expect(afterOrders - beforeOrders).toBeGreaterThanOrEqual(1);
      expect(afterRes.data!.overview.active_tenants).toBeGreaterThanOrEqual(1);
    });

    it("aggregates daily time-series trend in Asia/Dhaka timezone", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);
      expect(Array.isArray(res.data!.daily_trend)).toBe(true);

      if (res.data!.daily_trend.length > 0) {
        const day = res.data!.daily_trend[0];
        expect(day).toHaveProperty("date");
        expect(day).toHaveProperty("label");
        expect(day).toHaveProperty("gmv");
        expect(day).toHaveProperty("orders_count");
      }
    });

    it("ranks top performing restaurants by total GMV contribution (top 10 slice)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);

      const topRestaurants = res.data!.top_restaurants;
      expect(Array.isArray(topRestaurants)).toBe(true);
      expect(topRestaurants.length).toBeGreaterThanOrEqual(1);

      // Verify descending order of GMV across leaderboard
      for (let i = 0; i < topRestaurants.length - 1; i++) {
        expect(topRestaurants[i].total_gmv).toBeGreaterThanOrEqual(topRestaurants[i + 1].total_gmv);
      }
    });

    it("aggregates geographic distribution using test-created unique city", async () => {
      const uniqueCity = `City_${Date.now()}`;
      await adminClient.from("restaurants").update({ city: uniqueCity }).eq("id", restAId);

      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);

      const cities = res.data!.city_distribution;
      expect(Array.isArray(cities)).toBe(true);

      const matchEntry = cities.find((c) => c.city.toLowerCase() === uniqueCity.toLowerCase());
      expect(matchEntry).toBeDefined();
      expect(matchEntry!.restaurant_count).toBeGreaterThanOrEqual(1);

      // Restore city back to Dhaka
      await adminClient.from("restaurants").update({ city: "Dhaka" }).eq("id", restAId);
    });

    it("breaks down ordering channels (dine-in QR vs counter)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);

      const types = res.data!.order_types;
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("2. Date Range Boundaries & Validation", () => {
    it("excludes orders placed outside the selected period window", async () => {
      // Past window (50 days ago to 40 days ago)
      const pastStart = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(pastStart, pastEnd);
      expect(res.success).toBe(true);
      // In this historical past window, our recent test orders are not counted
      expect(res.data!.daily_trend.length).toBe(0);
    });

    it("rejects empty date inputs via Zod schema", async () => {
      const invalidRes = await getPlatformAnalytics("", "");
      expect(invalidRes.success).toBe(false);
      expect(invalidRes.error).not.toBeNull();
    });
  });

  describe("3. Security & Super Admin Authorization Enforcement", () => {
    it("strictly prevents regular restaurant staff from accessing platform analytics (P0002)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await ownerAClient.rpc("get_platform_analytics", {
        p_start_date: start,
        p_end_date: end,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe("P0002");
      expect(error?.message).toMatch(/Super Admin authorization required/i);
    });

    it("strictly prevents anonymous callers from accessing platform analytics (P0001)", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await anonClient.rpc("get_platform_analytics", {
        p_start_date: start,
        p_end_date: end,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(["42501", "P0001", "P0002"]).toContain(error?.code);
      expect(error?.message).toMatch(/(Authentication required|permission denied)/i);
    });
  });
});
