import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { customerCheckoutSchema } from "../schemas/orderSchema";
import { getCustomerOrder } from "../services/restaurantService";
import { getTestCredentials } from "./testCredentials";

describe("Customer Ordering, Cart Schema & Order Tracking (Chunk 10)", () => {
  let anonClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let testOrderId: string;

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const creds = getTestCredentials();
    const authRes = await ownerClient.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authRes.error) {
      console.warn("Owner signin warning:", authRes.error.message);
    }

    // Get an existing order for testing status tracking
    const { data: orders } = await ownerClient
      .from("orders")
      .select("id, restaurant_id")
      .limit(1);

    if (orders && orders.length > 0) {
      testOrderId = orders[0].id;
    }
  });

  describe("1. Customer Checkout Zod Schema Validation", () => {
    it("accepts valid checkout data with BD local phone", () => {
      const res = customerCheckoutSchema.safeParse({
        customer_name: "Tanvir Ahmed",
        customer_phone: "01712345678",
        order_type: "takeaway",
        customer_notes: "Please add extra napkins",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.customer_name).toBe("Tanvir Ahmed");
        expect(res.data.customer_phone).toBe("01712345678");
      }
    });

    it("accepts valid checkout data with E.164 BD phone", () => {
      const res = customerCheckoutSchema.safeParse({
        customer_name: "Rahim Chowdhury",
        customer_phone: "+8801812345678",
        order_type: "counter",
      });

      expect(res.success).toBe(true);
    });

    it("requires table_number when order_type is table", () => {
      const missingTable = customerCheckoutSchema.safeParse({
        customer_name: "Karim Mia",
        customer_phone: "01912345678",
        order_type: "table",
      });

      expect(missingTable.success).toBe(false);
      if (!missingTable.success) {
        expect(missingTable.error.issues[0].message).toContain("table number");
      }

      const withTable = customerCheckoutSchema.safeParse({
        customer_name: "Karim Mia",
        customer_phone: "01912345678",
        order_type: "table",
        table_number: "T-05",
      });

      expect(withTable.success).toBe(true);
    });

    it("rejects invalid phone numbers", () => {
      const invalidPhones = ["01234567890", "12345", "+14155552671", "abcdefghijk"];
      for (const phone of invalidPhones) {
        const res = customerCheckoutSchema.safeParse({
          customer_name: "Test User",
          customer_phone: phone,
          order_type: "counter",
        });
        expect(res.success).toBe(false);
      }
    });

    it("rejects names shorter than 2 characters", () => {
      const res = customerCheckoutSchema.safeParse({
        customer_name: "A",
        customer_phone: "01712345678",
        order_type: "takeaway",
      });
      expect(res.success).toBe(false);
    });
  });

  describe("2. Public Order Tracking RPC (get_customer_order)", () => {
    it("allows anonymous customer to retrieve sanitized order details by UUID", async () => {
      if (!testOrderId) {
        console.warn("Skipping: No existing test order found");
        return;
      }

      const { data, error } = await anonClient.rpc("get_customer_order", {
        p_order_id: testOrderId,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.found).toBe(true);
      expect(data.order).toBeDefined();
      expect(data.order.id).toBe(testOrderId);
      expect(data.order.order_number).toBeDefined();
      expect(data.order.status).toBeDefined();
      expect(data.restaurant).toBeDefined();
      expect(data.restaurant.name).toBeDefined();
      expect(Array.isArray(data.order.items)).toBe(true);
    });

    it("returns found: false when queried with nonexistent order UUID", async () => {
      const nonExistentUuid = "00000000-0000-0000-0000-000000000000";
      const { data, error } = await anonClient.rpc("get_customer_order", {
        p_order_id: nonExistentUuid,
      });

      expect(error).toBeNull();
      expect(data.found).toBe(false);
      expect(data.error).toBe("Order not found");
    });

    it("enforces RLS: anon cannot query arbitrary rows directly from orders table", async () => {
      const { data } = await anonClient
        .from("orders")
        .select("*")
        .limit(10);

      // Either error or empty array due to tenant-scoped RLS
      expect(data === null || data.length === 0).toBe(true);
    });
  });

  describe("3. restaurantService getCustomerOrder wrapper", () => {
    it("retrieves order details through service wrapper cleanly", async () => {
      if (!testOrderId) return;

      const res = await getCustomerOrder(testOrderId);
      expect(res.found).toBe(true);
      expect(res.order).toBeDefined();
      expect(res.restaurant).toBeDefined();
    });

    it("handles invalid order ID gracefully through service wrapper", async () => {
      const res = await getCustomerOrder("00000000-0000-0000-0000-000000000000");
      expect(res.found).toBe(false);
    });
  });
});
