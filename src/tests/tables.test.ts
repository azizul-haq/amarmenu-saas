import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { restaurantTableSchema } from "../schemas/tableSchema";

describe("Restaurant Tables, QR Token & Customer Detection Flow", () => {
  let clientA: SupabaseClient;
  let anonClient: SupabaseClient;
  let restAId: string;
  let restASlug: string;
  let createdTableId: string | null = null;
  let createdQrToken: string | null = null;

  const REST_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authA = await clientA.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authA.error) throw new Error(`Auth A failed: ${authA.error.message}`);

    // Fetch Restaurant A details
    const { data: staffData } = await clientA
      .from("restaurant_staff")
      .select("restaurant_id, restaurants(id, slug)")
      .limit(1)
      .single();

    restAId = staffData?.restaurant_id;
    const restRecord = staffData?.restaurants as unknown as {
      id: string;
      slug: string;
    } | null;
    restASlug = restRecord?.slug || "demo-restaurant";

    expect(restAId).toBeDefined();
    expect(restASlug).toBeDefined();
  });

  describe("Zod Table Schema Validation", () => {
    it("validates valid table configurations", () => {
      const validTable = {
        table_number: "VIP Table 01",
        capacity: 6,
        is_active: true,
      };

      const result = restaurantTableSchema.safeParse(validTable);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.table_number).toBe("VIP Table 01");
        expect(result.data.capacity).toBe(6);
        expect(result.data.is_active).toBe(true);
      }
    });

    it("rejects invalid table numbers and capacities", () => {
      // Empty table number
      const emptyNum = restaurantTableSchema.safeParse({
        table_number: "   ",
        capacity: 4,
      });
      expect(emptyNum.success).toBe(false);

      // Negative or zero capacity
      const zeroCapacity = restaurantTableSchema.safeParse({
        table_number: "T-01",
        capacity: 0,
      });
      expect(zeroCapacity.success).toBe(false);

      // Excessive capacity
      const hugeCapacity = restaurantTableSchema.safeParse({
        table_number: "T-01",
        capacity: 500,
      });
      expect(hugeCapacity.success).toBe(false);
    });
  });

  describe("Tenant Isolation & Table CRUD", () => {
    it("allows Restaurant A to create a table with auto-generated 32-char QR token", async () => {
      const tableName = `T-Test-${Date.now().toString().slice(-4)}`;
      const { data, error } = await clientA
        .from("restaurant_tables")
        .insert({
          restaurant_id: restAId,
          table_number: tableName,
          capacity: 4,
          is_active: true,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.table_number).toBe(tableName);
      expect(data.qr_token).toBeDefined();
      expect(data.qr_token.length).toBe(32); // 16 bytes hex = 32 chars
      expect(data.is_active).toBe(true);

      createdTableId = data.id;
      createdQrToken = data.qr_token;
    });

    it("prevents Restaurant A from creating tables for Restaurant B", async () => {
      const { data, error } = await clientA
        .from("restaurant_tables")
        .insert({
          restaurant_id: REST_B_ID,
          table_number: "Intruder Table",
          capacity: 2,
        })
        .select();

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("allows Restaurant A to regenerate table QR token", async () => {
      expect(createdTableId).not.toBeNull();

      const { data: newToken, error } = await clientA.rpc(
        "regenerate_table_qr_token",
        { p_table_id: createdTableId }
      );

      expect(error).toBeNull();
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(createdQrToken);
      expect(newToken.length).toBe(32);

      // Update our reference token for subsequent tests
      createdQrToken = newToken as string;
    });
  });

  describe("Customer Table QR Detection Flow", () => {
    it("successfully verifies and detects table via valid QR token", async () => {
      expect(createdQrToken).not.toBeNull();

      const { data, error } = await anonClient.rpc("verify_table_qr_token", {
        p_slug: restASlug,
        p_token: createdQrToken,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.valid).toBe(true);
      expect(data.table).toBeDefined();
      expect(data.table.id).toBe(createdTableId);
      expect(data.table.capacity).toBe(4);
    });

    it("rejects manipulated or invalid QR token with clear error message", async () => {
      const { data, error } = await anonClient.rpc("verify_table_qr_token", {
        p_slug: restASlug,
        p_token: "manipulated_fake_token_9999",
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.valid).toBe(false);
      expect(data.error).toBe("Invalid table QR token");
      expect(data.table).toBeUndefined();
    });

    it("rejects token lookup if restaurant slug does not exist", async () => {
      const { data, error } = await anonClient.rpc("verify_table_qr_token", {
        p_slug: "non-existent-restaurant-slug-xyz",
        p_token: createdQrToken,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.valid).toBe(false);
      expect(data.error).toBe("Restaurant not found");
    });

    it("rejects QR token lookup if table is soft-deleted", async () => {
      expect(createdTableId).not.toBeNull();

      // Soft delete table
      const { error: deleteError } = await clientA
        .from("restaurant_tables")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", createdTableId!);

      expect(deleteError).toBeNull();

      // Attempt to verify the soft-deleted table
      const { data, error } = await anonClient.rpc("verify_table_qr_token", {
        p_slug: restASlug,
        p_token: createdQrToken,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.valid).toBe(false);
      expect(data.error).toBe("This table is no longer active");
    });
  });
});
