import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { supabase } from "../config/supabase";
import { updateOrderStatus, getOrderStatusHistory } from "../services/restaurantService";
import { getTestCredentials } from "./testCredentials";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Order State Machine, Server Transitions & Waiter Verification (Chunk 11)", () => {
  let anonClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let adminClient: SupabaseClient;
  const serviceDbClient = getServiceRoleClient();

  let restAId: string;
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

    const creds = getTestCredentials();

    // Authenticate Owner A
    const authA = await ownerAClient.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authA.error) throw new Error(`Owner A auth failed: ${authA.error.message}`);

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

    // Resolve Restaurant A ID
    const { data: staffData } = await ownerAClient
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();

    restAId = staffData!.restaurant_id;

    // Create a fresh test menu item for creating test orders
    const { data: itemData, error: itemError } = await ownerAClient
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `State Machine Item ${Date.now()}`,
        base_price: 250.0,
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test menu item: ${itemError?.message}`);
    }

    testItemId = itemData.id;
  });

  const createPendingOrder = async (): Promise<string> => {
    const { data, error } = await anonClient.rpc("place_order", {
      p_restaurant_id: restAId,
      p_order_type: "counter",
      p_customer_name: "Test Customer",
      p_customer_phone: `+88017${Date.now().toString().slice(-8)}`,
      p_items: [
        {
          menu_item_id: testItemId,
          quantity: 1,
        },
      ],
      p_idempotency_key: crypto.randomUUID(),
    });

    if (error || !data) {
      throw new Error(`Failed to place pending test order: ${error?.message}`);
    }

    return data.order_id;
  };

  describe("1. Valid Order State Machine Progression", () => {
    it("progresses step-by-step: pending -> accepted -> preparing -> ready -> completed", async () => {
      const orderId = await createPendingOrder();

      // Step 1: Waiter verifies & confirms order (pending -> accepted)
      const step1 = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
        p_notes: "Waiter confirmed table availability",
      });
      expect(step1.error).toBeNull();
      expect(step1.data.success).toBe(true);
      expect(step1.data.to_status).toBe("accepted");

      const { data: orderAfter1 } = await ownerAClient
        .from("orders")
        .select("status, accepted_at, verified_by")
        .eq("id", orderId)
        .single();
      expect(orderAfter1?.status).toBe("accepted");
      expect(orderAfter1?.accepted_at).not.toBeNull();
      expect(orderAfter1?.verified_by).not.toBeNull();

      // Step 2: Kitchen starts cooking (accepted -> preparing)
      const step2 = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "preparing",
      });
      expect(step2.error).toBeNull();
      expect(step2.data.to_status).toBe("preparing");

      const { data: orderAfter2 } = await ownerAClient
        .from("orders")
        .select("status, preparing_at")
        .eq("id", orderId)
        .single();
      expect(orderAfter2?.status).toBe("preparing");
      expect(orderAfter2?.preparing_at).not.toBeNull();

      // Step 3: Kitchen marks food ready (preparing -> ready)
      const step3 = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "ready",
      });
      expect(step3.error).toBeNull();
      expect(step3.data.to_status).toBe("ready");

      const { data: orderAfter3 } = await ownerAClient
        .from("orders")
        .select("status, ready_at")
        .eq("id", orderId)
        .single();
      expect(orderAfter3?.status).toBe("ready");
      expect(orderAfter3?.ready_at).not.toBeNull();

      // Step 4: Waiter serves & completes order (ready -> completed)
      const step4 = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "completed",
        p_payment_method: "cash",
        p_payment_status: "paid",
      });
      expect(step4.error).toBeNull();
      expect(step4.data.to_status).toBe("completed");

      const { data: orderAfter4 } = await ownerAClient
        .from("orders")
        .select("status, completed_at, payment_method, payment_status")
        .eq("id", orderId)
        .single();
      expect(orderAfter4?.status).toBe("completed");
      expect(orderAfter4?.completed_at).not.toBeNull();
      expect(orderAfter4?.payment_method).toBe("cash");
    });
  });

  describe("2. Server-Enforced Rejection of Invalid Transitions", () => {
    it("rejects jumping directly from pending to completed", async () => {
      const orderId = await createPendingOrder();

      const { error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "completed",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Invalid order status transition from "pending" to "completed"');
    });

    it("rejects jumping directly from pending to ready", async () => {
      const orderId = await createPendingOrder();

      const { error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "ready",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Invalid order status transition from "pending" to "ready"');
    });

    it("rejects transitioning backwards from completed to pending", async () => {
      const orderId = await createPendingOrder();

      // Progress to completed legally
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "accepted" });
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "preparing" });
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "ready" });
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "completed" });

      // Attempt invalid reversal
      const { error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "pending",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Invalid order status transition from "completed" to "pending"');
    });

    it("rejects cancelling a completed order (completed is terminal)", async () => {
      const orderId = await createPendingOrder();

      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "accepted" });
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "preparing" });
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "ready" });
      await ownerAClient.rpc("transition_order_status", { p_order_id: orderId, p_new_status: "completed" });

      const { error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "cancelled",
        p_notes: "Attempted customer dispute after completion",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Invalid order status transition from "completed" to "cancelled"');
    });
  });

  describe("3. Waiter Rejection & Cancellation Handling", () => {
    it("allows waiter to reject a pending order with reasons", async () => {
      const orderId = await createPendingOrder();

      const { data, error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "rejected",
        p_notes: "Kitchen out of ingredients for this item",
      });

      expect(error).toBeNull();
      expect(data.to_status).toBe("rejected");

      const { data: orderRow } = await ownerAClient
        .from("orders")
        .select("status, rejection_reason, cancelled_at")
        .eq("id", orderId)
        .single();

      expect(orderRow?.status).toBe("rejected");
      expect(orderRow?.rejection_reason).toBe("Kitchen out of ingredients for this item");
      expect(orderRow?.cancelled_at).not.toBeNull();

      // Rejected is terminal: cannot be moved to preparing
      const invalidNext = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "preparing",
      });
      expect(invalidNext.error).not.toBeNull();
      expect(invalidNext.error!.message).toContain('Invalid order status transition from "rejected" to "preparing"');
    });
  });

  describe("4. Security, Tenant Isolation & Audit Trail", () => {
    it("prevents anonymous callers from transitioning order status", async () => {
      const orderId = await createPendingOrder();

      const { error } = await anonClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
      });

      expect(error).not.toBeNull();
      // Unauthenticated callers fail execute grant or auth.uid() check
      expect(error!.message).toMatch(/(permission denied|Authentication required)/i);
    });

    it("prevents staff from transitioning orders belonging to another restaurant", async () => {
      // Create an order belonging to Restaurant B using service role
      const bRows = await serviceDbClient.adminQuery<{ id: string }>(
        `INSERT INTO orders (restaurant_id, order_number, order_type, items, subtotal, tax, total, status)
         VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ORD-B-${Date.now()}', 'counter', '[]'::jsonb, 100, 5, 105, 'pending')
         RETURNING id;`
      );
      const orderB = bRows[0];
      expect(orderB).toBeDefined();

      // Owner A (staff of Restaurant A) attempts to transition Restaurant B's order
      const { error } = await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderB.id,
        p_new_status: "accepted",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain("Unauthorized: You can only transition orders for your own restaurant");
    });

    it("records full audit history trail in order_status_history", async () => {
      const orderId = await createPendingOrder();

      await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "accepted",
        p_notes: "Confirmed by waiter",
      });

      await ownerAClient.rpc("transition_order_status", {
        p_order_id: orderId,
        p_new_status: "preparing",
        p_notes: "Sent to kitchen",
      });

      const { data: history, error } = await ownerAClient
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      expect(error).toBeNull();
      expect(history).toBeDefined();
      expect(history!.length).toBe(2);

      expect(history![0].from_status).toBe("pending");
      expect(history![0].to_status).toBe("accepted");
      expect(history![0].notes).toBe("Confirmed by waiter");

      expect(history![1].from_status).toBe("accepted");
      expect(history![1].to_status).toBe("preparing");
      expect(history![1].notes).toBe("Sent to kitchen");
    });
  });

  describe("5. restaurantService Helper Wrappers", () => {
    it("updateOrderStatus and getOrderStatusHistory work via authenticated client", async () => {
      const orderId = await createPendingOrder();

      // Sign in supabase client for restaurantService
      const res = await updateOrderStatus(orderId, "accepted", "Service helper confirmation");
      expect(res.success).toBe(true);
      expect(res.data?.to_status).toBe("accepted");

      const history = await getOrderStatusHistory(orderId);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[history.length - 1].to_status).toBe("accepted");
    });
  });
});
