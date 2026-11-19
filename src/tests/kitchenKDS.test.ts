import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { recordKOTPrint } from "../services/restaurantService";
import { supabase } from "../config/supabase";
import { getServiceRoleClient } from "./serviceRoleClient";
import { getTestCredentials } from "./testCredentials";

describe("Kitchen Display System (KDS) & KOT Thermal Print Tracking (Chunk 12)", () => {
  let anonClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restId: string;
  let testItemId: string;

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const creds = getTestCredentials();

    // Authenticate Owner
    const authOwner = await ownerClient.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authOwner.error) throw new Error(`Owner auth failed: ${authOwner.error.message}`);

    // Authenticate Supabase service client
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

    // Resolve Restaurant ID
    const { data: staffData } = await ownerClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();

    restId = staffData!.restaurant_id;

    // Create a fresh test menu item
    const { data: itemData, error: itemError } = await ownerClient
      .from("menu_items")
      .insert({
        restaurant_id: restId,
        name: `Kitchen Test Item ${Date.now()}`,
        base_price: 180.0,
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test menu item: ${itemError?.message}`);
    }

    testItemId = itemData.id;
  });

  const createAndAcceptOrder = async (): Promise<string> => {
    // 1. Customer places order (pending)
    const { data: placeData, error: placeError } = await anonClient.rpc("place_order", {
      p_restaurant_id: restId,
      p_order_type: "table",
      p_customer_name: "Kitchen Test Customer",
      p_customer_phone: `+88017${Date.now().toString().slice(-8)}`,
      p_items: [
        {
          menu_item_id: testItemId,
          quantity: 2,
        },
      ],
      p_idempotency_key: crypto.randomUUID(),
    });

    if (placeError || !placeData) {
      throw new Error(`Failed to create order: ${placeError?.message}`);
    }

    const orderId = placeData.order_id;

    // 2. Waiter verifies & confirms order (pending -> accepted)
    const { error: transError } = await ownerClient.rpc("transition_order_status", {
      p_order_id: orderId,
      p_new_status: "accepted",
      p_notes: "Waiter verified table for kitchen",
    });

    if (transError) {
      throw new Error(`Failed to confirm order: ${transError.message}`);
    }

    return orderId;
  };

  describe("1. Kitchen Queue Filtering", () => {
    it("retrieves confirmed kitchen orders in accepted, preparing, or ready status", async () => {
      const orderId = await createAndAcceptOrder();

      const { data: activeKitchenOrders, error } = await ownerClient
        .from("orders")
        .select("id, status, items, customer_name")
        .eq("restaurant_id", restId)
        .in("status", ["accepted", "preparing", "ready"]);

      expect(error).toBeNull();
      expect(activeKitchenOrders).toBeDefined();
      const matched = activeKitchenOrders?.find((o) => o.id === orderId);
      expect(matched).toBeDefined();
      expect(matched?.status).toBe("accepted");
    });

    it("excludes pending, completed, and cancelled orders from active kitchen queue", async () => {
      const orderId = await createAndAcceptOrder();

      // Progress order through kitchen to completed
      await ownerClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "preparing" });
      await ownerClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "ready" });
      await ownerClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "completed" });

      const { data: activeKitchenOrders } = await ownerClient
        .from("orders")
        .select("id, status")
        .eq("restaurant_id", restId)
        .in("status", ["accepted", "preparing", "ready"]);

      const completedMatched = activeKitchenOrders?.find((o) => o.id === orderId);
      expect(completedMatched).toBeUndefined();
    });
  });

  describe("2. Kitchen Workflow Progression", () => {
    it("transitions order through kitchen stages: accepted -> preparing -> ready", async () => {
      const orderId = await createAndAcceptOrder();

      // Chef starts cooking
      const { data: resPreparing, error: errPreparing } = await ownerClient.rpc(
        "transition_order_status",
        {
          p_order_id: orderId,
          p_new_status: "preparing",
        }
      );
      expect(errPreparing).toBeNull();
      expect(resPreparing.to_status).toBe("preparing");

      // Chef marks dishes ready
      const { data: resReady, error: errReady } = await ownerClient.rpc(
        "transition_order_status",
        {
          p_order_id: orderId,
          p_new_status: "ready",
        }
      );
      expect(errReady).toBeNull();
      expect(resReady.to_status).toBe("ready");

      const { data: orderRow } = await ownerClient
        .from("orders")
        .select("status, preparing_at, ready_at")
        .eq("id", orderId)
        .single();

      expect(orderRow?.status).toBe("ready");
      expect(orderRow?.preparing_at).not.toBeNull();
      expect(orderRow?.ready_at).not.toBeNull();
    });
  });

  describe("3. KOT Thermal Printing & Tracking", () => {
    it("atomically tracks KOT print timestamp and print count", async () => {
      const orderId = await createAndAcceptOrder();

      // Initial print
      const print1 = await ownerClient.rpc("record_kot_print", { p_order_id: orderId });
      expect(print1.error).toBeNull();
      expect(print1.data.success).toBe(true);
      expect(print1.data.kot_print_count).toBe(1);
      expect(print1.data.kot_printed_at).toBeDefined();

      // Reprint
      const print2 = await ownerClient.rpc("record_kot_print", { p_order_id: orderId });
      expect(print2.error).toBeNull();
      expect(print2.data.kot_print_count).toBe(2);

      const { data: orderRow } = await ownerClient
        .from("orders")
        .select("kot_print_count, kot_printed_at")
        .eq("id", orderId)
        .single();

      expect(orderRow?.kot_print_count).toBe(2);
      expect(orderRow?.kot_printed_at).not.toBeNull();
    });

    it("service wrapper recordKOTPrint updates print count", async () => {
      const orderId = await createAndAcceptOrder();

      const res = await recordKOTPrint(orderId);
      expect(res.success).toBe(true);
      expect(res.kot_print_count).toBe(1);
    });

    it("prevents unauthenticated callers from recording KOT print", async () => {
      const orderId = await createAndAcceptOrder();

      const { error } = await anonClient.rpc("record_kot_print", { p_order_id: orderId });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/(permission denied|Authentication required)/i);
    });

    it("prevents staff from printing KOT for another restaurant", async () => {
      // Create order for Restaurant B via service role
      const serviceRole = getServiceRoleClient();
      const [orderB] = await serviceRole.query<{ id: string }>(`
        INSERT INTO orders (
          restaurant_id,
          order_number,
          order_type,
          items,
          subtotal,
          tax,
          total,
          status
        ) VALUES (
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'ORD-KOT-B-' || floor(random() * 1000000)::text,
          'counter',
          '[]'::jsonb,
          150,
          7.5,
          157.5,
          'accepted'
        ) RETURNING id;
      `);

      // Owner A attempts to print KOT for Restaurant B's order
      const { error } = await ownerClient.rpc("record_kot_print", { p_order_id: orderB.id });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Unauthorized: You can only print KOT for your own restaurant");
    });
  });
});
