import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import { getPlatformAnalytics } from "../services/platformAnalyticsService";

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

    // Authenticate Owner A
    const authA = await ownerAClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

    // Set singleton session to Super Admin for service call tests
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: "admin123",
    });
    if (authAdmin.error) throw new Error(`Admin auth failed: ${authAdmin.error.message}`);

    await supabase.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: "admin123",
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
  });

  describe("1. Platform GMV & Order Volume Aggregations", () => {
    it("aggregates cross-tenant GMV, completed orders, and average ticket value", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();

      const overview = res.data!.overview;
      expect(overview.total_gmv).toBeGreaterThan(0);
      expect(overview.total_orders).toBeGreaterThan(0);
      expect(overview.avg_order_value).toBeGreaterThan(0);
      expect(overview.total_vat).toBeGreaterThanOrEqual(0);
      expect(overview.active_tenants).toBeGreaterThanOrEqual(1);
      expect(overview.total_tenants).toBeGreaterThanOrEqual(1);
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

    it("ranks top performing restaurants by total GMV contribution", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);

      const topRestaurants = res.data!.top_restaurants;
      expect(Array.isArray(topRestaurants)).toBe(true);
      expect(topRestaurants.length).toBeGreaterThanOrEqual(1);

      // Verify descending order of GMV
      for (let i = 0; i < topRestaurants.length - 1; i++) {
        expect(topRestaurants[i].total_gmv).toBeGreaterThanOrEqual(topRestaurants[i + 1].total_gmv);
      }
    });

    it("aggregates geographic distribution across cities and divisions", async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const res = await getPlatformAnalytics(start, end);
      expect(res.success).toBe(true);

      const cities = res.data!.city_distribution;
      expect(Array.isArray(cities)).toBe(true);
      expect(cities.length).toBeGreaterThanOrEqual(1);

      const dhakaEntry = cities.find((c) => c.city.toLowerCase() === "dhaka");
      expect(dhakaEntry).toBeDefined();
      expect(dhakaEntry!.restaurant_count).toBeGreaterThanOrEqual(1);
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
      expect(invalidRes.error).toBeDefined();
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
      expect(error).toBeDefined();
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
      expect(error).toBeDefined();
      expect(["42501", "P0001", "P0002"]).toContain(error?.code);
      expect(error?.message).toMatch(/(Authentication required|permission denied)/i);
    });
  });
});
