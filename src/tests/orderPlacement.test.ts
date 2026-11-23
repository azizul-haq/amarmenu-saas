import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getTestCredentials } from "./testCredentials";
import { generateUUID } from "../utils/uuid";

describe("Atomic place_order Procedure, Anti-Tampering & Idempotency", () => {
  let anonClient: SupabaseClient;
  let clientA: SupabaseClient;

  let restAId: string;
  let testItemId: string;
  let testItemBasePrice: number;
  let testTableToken: string;

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const creds = getTestCredentials();
    const authA = await clientA.auth.signInWithPassword({
      email: creds.restaurant_a.owner.email,
      password: creds.restaurant_a.owner.password,
    });
    if (authA.error) throw new Error(`Auth failed: ${authA.error.message}`);

    // Get Restaurant A ID
    const { data: staffData } = await clientA
      .from("restaurant_staff")
      .select("restaurant_id")
      .limit(1)
      .single();

    restAId = staffData?.restaurant_id;

    // Create a verified menu item with sizes and addons for testing
    const { data: itemData, error: itemError } = await clientA
      .from("menu_items")
      .insert({
        restaurant_id: restAId,
        name: `Kacchi Test ${Date.now()}`,
        base_price: 350.0,
        sizes: [
          { name: "Half", price: 350.0 },
          { name: "Full", price: 550.0 },
        ],
        addons: [{ name: "Extra Borhani", price: 70.0 }],
        is_available: true,
      })
      .select()
      .single();

    if (itemError || !itemData) {
      throw new Error(`Failed to create test item: ${itemError?.message}`);
    }

    testItemId = itemData.id;
    testItemBasePrice = Number(itemData.base_price);

    // Create a verified table for QR testing
    const { data: tableData, error: tableError } = await clientA
      .from("restaurant_tables")
      .insert({
        restaurant_id: restAId,
        table_number: `T-ORD-${Date.now().toString().slice(-4)}`,
        capacity: 4,
        is_active: true,
      })
      .select()
      .single();

    if (tableError || !tableData) {
      throw new Error(`Failed to create test table: ${tableError?.message}`);
    }

    testTableToken = tableData.qr_token;
  });

  describe("Server-Side Price Calculation & Anti-Tampering", () => {
    it("places a legitimate order and computes gap-free order number, subtotal, and VAT", async () => {
      const idempotencyKey = generateUUID();
      const phone = "+8801719999001";

      const orderPayload = {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Genuine Customer",
        p_customer_phone: phone,
        p_items: [
          {
            menu_item_id: testItemId,
            quantity: 2,
            selected_size: { name: "Full", price: 550.0 },
            selected_addons: [{ name: "Extra Borhani", price: 70.0 }],
          },
        ],
        p_customer_notes: "Please deliver warm",
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await anonClient.rpc("place_order", orderPayload);

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
      expect(data.order_id).toBeDefined();
      expect(data.order_number).toMatch(/^ORD-\d{8}-\d{4}$/); // Gap-free format

      // Server calculations:
      // Unit price: 550 (Full) + 70 (Borhani) = 620
      // Subtotal for qty 2 = 1240.00
      // VAT (5% default) = 62.00
      // Total = 1302.00
      expect(Number(data.subtotal)).toBe(1240.0);
      expect(Number(data.tax)).toBe(62.0);
      expect(Number(data.total)).toBe(1302.0);
      expect(data.is_duplicate).toBe(false);
    });

    it("REJECTS order if client tries to send tampered/fake item price", async () => {
      const phone = "+8801719999002";

      // Malicious client tries to buy a ৳350 dish for ৳1
      const tamperedPayload = {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Hacker Customer",
        p_customer_phone: phone,
        p_items: [
          {
            menu_item_id: testItemId,
            quantity: 1,
            client_price: 1.0, // FAKE PRICE!
            item_total: 1.0, // FAKE TOTAL!
          },
        ],
        p_client_subtotal: 1.0,
        p_client_total: 1.05,
      };

      const { data, error } = await anonClient.rpc("place_order", tamperedPayload);

      // Server must reject with price tampering error
      expect(error).not.toBeNull();
      expect(error?.message).toContain("Price tampering detected");
      expect(data).toBeNull();
    });

    it("REJECTS order if client tries to forge subtotal or total", async () => {
      const phone = "+8801719999003";

      const forgedTotalPayload = {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Forged Total Customer",
        p_customer_phone: phone,
        p_items: [
          {
            menu_item_id: testItemId,
            quantity: 1,
            // valid item price matches 350
            item_total: testItemBasePrice,
          },
        ],
        // Client sends fake subtotal 50 instead of 350
        p_client_subtotal: 50.0,
        p_client_total: 52.5,
      };

      const { data, error } = await anonClient.rpc("place_order", forgedTotalPayload);

      expect(error).not.toBeNull();
      expect(error?.message).toContain("Subtotal mismatch detected");
      expect(data).toBeNull();
    });
  });

  describe("Idempotency Protection", () => {
    it("returns existing order without duplicate insertion on same idempotency_key", async () => {
      const idempotencyKey = generateUUID();
      const phone = "+8801719999004";

      const payload = {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Double Clicker",
        p_customer_phone: phone,
        p_items: [
          {
            menu_item_id: testItemId,
            quantity: 1,
          },
        ],
        p_idempotency_key: idempotencyKey,
      };

      // 1. First submission
      const { data: firstOrder, error: err1 } = await anonClient.rpc("place_order", payload);
      expect(err1).toBeNull();
      expect(firstOrder.success).toBe(true);
      expect(firstOrder.is_duplicate).toBe(false);

      // 2. Second submission with the same idempotency key (network retry / double-click)
      const { data: secondOrder, error: err2 } = await anonClient.rpc("place_order", payload);
      expect(err2).toBeNull();
      expect(secondOrder.success).toBe(true);
      expect(secondOrder.is_duplicate).toBe(true);
      expect(secondOrder.order_id).toBe(firstOrder.order_id);
      expect(secondOrder.order_number).toBe(firstOrder.order_number);
    });
  });

  describe("QR Token Table Verification", () => {
    it("successfully places QR dine-in order with valid qr_token", async () => {
      const phone = "+8801719999005";

      const payload = {
        p_restaurant_id: restAId,
        p_order_type: "qr",
        p_customer_name: "Dine-In Customer",
        p_customer_phone: phone,
        p_items: [
          {
            menu_item_id: testItemId,
            quantity: 1,
          },
        ],
        p_qr_token: testTableToken,
      };

      const { data, error } = await anonClient.rpc("place_order", payload);

      expect(error).toBeNull();
      expect(data.success).toBe(true);
      expect(data.order_id).toBeDefined();

      // Verify in DB that table_id was populated from verified token
      const { data: orderRow } = await clientA
        .from("orders")
        .select("table_id, table_number")
        .eq("id", data.order_id)
        .single();

      expect(orderRow?.table_id).not.toBeNull();
      expect(orderRow?.table_number).toMatch(/^T-ORD-/);
    });

    it("REJECTS QR order if qr_token is invalid or missing", async () => {
      const phone = "+8801719999006";

      const payload = {
        p_restaurant_id: restAId,
        p_order_type: "qr",
        p_customer_name: "Spoofer Customer",
        p_customer_phone: phone,
        p_items: [
          {
            menu_item_id: testItemId,
            quantity: 1,
          },
        ],
        p_qr_token: "bogus_tampered_token_999",
      };

      const { data, error } = await anonClient.rpc("place_order", payload);

      expect(error).not.toBeNull();
      expect(error?.message).toContain("Invalid table QR token");
      expect(data).toBeNull();
    });
  });

  describe("Rate Limiting", () => {
    it("blocks spam orders when phone exceeds 5 orders within 5 minutes", async () => {
      // Use dynamic phone number so prior test runs don't leak into rate window
      const spamPhone = `+880171${Date.now().toString().slice(-7)}`;

      // Submit 5 orders in succession
      for (let i = 1; i <= 5; i++) {
        const { error } = await anonClient.rpc("place_order", {
          p_restaurant_id: restAId,
          p_order_type: "counter",
          p_customer_name: `Spam ${i}`,
          p_customer_phone: spamPhone,
          p_items: [{ menu_item_id: testItemId, quantity: 1 }],
          p_idempotency_key: generateUUID(),
        });
        expect(error).toBeNull();
      }

      // 6th order must be blocked by rate limit
      const { data, error } = await anonClient.rpc("place_order", {
        p_restaurant_id: restAId,
        p_order_type: "counter",
        p_customer_name: "Spam 6",
        p_customer_phone: spamPhone,
        p_items: [{ menu_item_id: testItemId, quantity: 1 }],
        p_idempotency_key: generateUUID(),
      });

      expect(error).not.toBeNull();
      expect(error?.message).toContain("Rate limit exceeded");
      expect(data).toBeNull();
    });
  });
});
