import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getTestCredentials } from "./testCredentials";

describe("Multi-Tenant Row Level Security (RLS) Isolation", () => {
  let anonClient: SupabaseClient;
  let clientA: SupabaseClient;
  let adminClient: SupabaseClient;

  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeAll(async () => {
    // 1. Anon client
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const creds = getTestCredentials();

    // 2. Client A (Restaurant A Owner)
    clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authA = await clientA.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authA.error) throw new Error(`Auth A failed: ${authA.error.message}`);

    // 3. Admin Client (Super Admin)
    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) throw new Error(`Auth Admin failed: ${authAdmin.error.message}`);
  });

  describe("Anon Customer Access", () => {
    it("allows anon to view active menu categories and available items", async () => {
      const { data: categories, error: catError } = await anonClient
        .from("menu_categories")
        .select("id, name, restaurant_id")
        .limit(5);

      expect(catError).toBeNull();
      expect(Array.isArray(categories)).toBe(true);

      const { data: items, error: itemError } = await anonClient
        .from("menu_items")
        .select("id, name, base_price")
        .limit(5);

      expect(itemError).toBeNull();
      expect(Array.isArray(items)).toBe(true);
    });

    it("prevents anon from reading private restaurant orders", async () => {
      const { data: _orders, error } = await anonClient.from("orders").select("id");

      // In Chunk 20d, SELECT privilege on orders is revoked from anon (42501)
      expect(error?.code).toBe("42501");
    });

    it("prevents anon from invoking admin RPC procedures", async () => {
      const { data, error } = await anonClient.rpc("admin_toggle_restaurant_status", {
        p_restaurant_id: REST_B_ID,
        p_is_active: false,
      });

      // Permission was revoked or procedure rejects non-super_admin
      expect(error).not.toBeNull();
      expect(data).toBeFalsy();
    });
  });

  describe("Tenant Isolation: Restaurant A vs Restaurant B", () => {
    it("allows Restaurant A to see only its own orders and NOT Restaurant B orders", async () => {
      const { data: ordersA, error } = await clientA
        .from("orders")
        .select("id, order_number, restaurant_id");

      expect(error).toBeNull();
      expect(ordersA).toBeDefined();
      expect(ordersA!.length).toBeGreaterThan(0);

      // Verify no returned order belongs to Restaurant B
      const restBOrders = (ordersA || []).filter((o) => o.restaurant_id === REST_B_ID);
      expect(restBOrders.length).toBe(0);

      // Verify ORD-B-1001 is completely invisible to Restaurant A
      const hasOrderB = (ordersA || []).some((o) => o.order_number === "ORD-B-1001");
      expect(hasOrderB).toBe(false);
    });

    it("prevents Restaurant A from reading Restaurant B orders by specific ID query", async () => {
      const { data, error } = await clientA
        .from("orders")
        .select("*")
        .eq("restaurant_id", REST_B_ID);

      expect(error).toBeNull();
      expect(data).toEqual([]); // 0 rows returned due to RLS filter
    });

    it("prevents Restaurant A from modifying Restaurant B's menu categories", async () => {
      const { data, error } = await clientA
        .from("menu_categories")
        .update({ name: "Hacked Category By Rest A" })
        .eq("restaurant_id", REST_B_ID)
        .select();

      // RLS filters out rows that don't match current_restaurant_id()
      expect(error).toBeNull();
      expect(data).toEqual([]); // 0 rows updated
    });

    it("prevents Restaurant A from modifying Restaurant B's menu items", async () => {
      const { data, error } = await clientA
        .from("menu_items")
        .update({ name: "Hacked Item By Rest A" })
        .eq("restaurant_id", REST_B_ID)
        .select();

      expect(error).toBeNull();
      expect(data).toEqual([]); // 0 rows updated
    });

    it("prevents Restaurant A from updating Restaurant B's profile", async () => {
      const { data, error } = await clientA
        .from("restaurants")
        .update({ name: "Malicious Rename" })
        .eq("id", REST_B_ID)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]); // 0 rows updated
    });
  });

  describe("Super Admin Privileges", () => {
    it("allows Super Admin to view orders across multiple restaurants", async () => {
      const { data: allOrders, error } = await adminClient
        .from("orders")
        .select("id, order_number, restaurant_id");

      expect(error).toBeNull();
      expect(allOrders).toBeDefined();

      const hasOrderB = (allOrders || []).some((o) => o.restaurant_id === REST_B_ID);
      expect(hasOrderB).toBe(true);

      const hasOrderA = (allOrders || []).some((o) => o.restaurant_id !== REST_B_ID);
      expect(hasOrderA).toBe(true);
    });

    it("allows Super Admin to view all restaurants including inactive ones", async () => {
      const { data: restaurants, error } = await adminClient
        .from("restaurants")
        .select("id, name, slug");

      expect(error).toBeNull();
      expect(restaurants?.length).toBeGreaterThanOrEqual(2);
    });
  });
});
