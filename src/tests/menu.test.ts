import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import {
  menuItemSchema,
  menuCategorySchema,
  sizeVariantSchema,
  addonVariantSchema,
} from "../schemas/menuSchema";

describe("Bilingual Menu Management, Validation & Soft Delete", () => {
  let clientA: SupabaseClient;
  let anonClient: SupabaseClient;

  let createdItemId: string | null = null;
  let testCategoryId: string | null = null;
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
  });

  describe("Zod Validation Schemas", () => {
    it("validates a proper bilingual menu item with sizes and addons", () => {
      const validItem = {
        name: "Shahi Morog Polao",
        name_bn: "শাহী মোরগ পোলাও",
        description: "Aromatic chinigura rice with tender chicken roast",
        description_bn: "সুগন্ধি চিনিগুঁড়া চাল ও মুরগির রোস্ট",
        base_price: 320,
        sizes: [
          { name: "Regular", name_bn: "রেগুলার", price: 320 },
          { name: "Special with Egg", name_bn: "স্পেশাল ডিম সহ", price: 360 },
        ],
        addons: [
          { name: "Borhani", name_bn: "বোরহানি", price: 60 },
          { name: "Jorda", name_bn: "জর্দা", price: 50 },
        ],
        is_available: true,
      };

      const result = menuItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Shahi Morog Polao");
        expect(result.data.sizes.length).toBe(2);
        expect(result.data.addons.length).toBe(2);
      }
    });

    it("rejects items with negative price or empty name", () => {
      const invalidItem = {
        name: "X", // too short
        base_price: -50, // negative price
      };

      const result = menuItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.issues.map((e) => e.message);
        expect(errorMessages.some((m) => m.includes("at least 2 characters"))).toBe(true);
        expect(errorMessages.some((m) => m.includes("negative"))).toBe(true);
      }
    });

    it("validates size and add-on variant constraints", () => {
      expect(
        sizeVariantSchema.safeParse({ name: "Full", price: 400 }).success
      ).toBe(true);
      expect(
        sizeVariantSchema.safeParse({ name: "", price: 400 }).success
      ).toBe(false);
      expect(
        sizeVariantSchema.safeParse({ name: "Half", price: -10 }).success
      ).toBe(false);

      expect(
        addonVariantSchema.safeParse({ name: "Extra Cheese", price: 50 }).success
      ).toBe(true);
      expect(
        addonVariantSchema.safeParse({ name: "", price: 50 }).success
      ).toBe(false);
    });

    it("validates bilingual category inputs", () => {
      expect(
        menuCategorySchema.safeParse({
          name: "Biryani & Polao",
          name_bn: "বিরিয়ানি ও পোলাও",
          display_order: 1,
        }).success
      ).toBe(true);

      expect(
        menuCategorySchema.safeParse({
          name: "",
          display_order: 1,
        }).success
      ).toBe(false);
    });
  });

  describe("Database Operations & Tenant Isolation", () => {
    it("allows Restaurant A to create a bilingual category", async () => {
      // Fetch Restaurant A ID
      const { data: staffData } = await clientA
        .from("restaurant_staff")
        .select("restaurant_id")
        .limit(1)
        .single();

      const restId = staffData?.restaurant_id;
      expect(restId).toBeDefined();

      const catName = `Traditional Platters ${Date.now()}`;
      const { data: catData, error: catError } = await clientA
        .from("menu_categories")
        .insert({
          restaurant_id: restId,
          name: catName,
          name_bn: "ঐতিহ্যবাহী প্ল্যাটার",
          display_order: 1,
          is_active: true,
        })
        .select()
        .single();

      expect(catError).toBeNull();
      expect(catData).toBeDefined();
      expect(catData?.name).toBe(catName);
      expect(catData?.name_bn).toBe("ঐতিহ্যবাহী প্ল্যাটার");
      testCategoryId = catData?.id || null;
    });

    it("allows Restaurant A to create a bilingual menu item with sizes and addons", async () => {
      const { data: staffData } = await clientA
        .from("restaurant_staff")
        .select("restaurant_id")
        .limit(1)
        .single();

      const restId = staffData?.restaurant_id;

      const { data: itemData, error: itemError } = await clientA
        .from("menu_items")
        .insert({
          restaurant_id: restId,
          category_id: testCategoryId,
          name: "Old Dhaka Beef Tehari",
          name_bn: "পুরান ঢাকা বিফ তেহারী",
          description: "Mustard oil cooked tehari with small tender beef pieces",
          description_bn: "খাঁটি সরিষার তেলে রান্না করা গরুর মাংসের তেহারী",
          base_price: 260,
          is_available: true,
          sizes: [
            { name: "Single", name_bn: "হাফ", price: 260 },
            { name: "Double", name_bn: "ফুল", price: 420 },
          ],
          addons: [{ name: "Extra Beef", name_bn: "অতিরিক্ত মাংস", price: 100 }],
        })
        .select()
        .single();

      expect(itemError).toBeNull();
      expect(itemData).toBeDefined();
      expect(itemData?.name).toBe("Old Dhaka Beef Tehari");
      expect(itemData?.name_bn).toBe("পুরান ঢাকা বিফ তেহারী");
      expect(itemData?.sizes?.length).toBe(2);
      expect(itemData?.addons?.length).toBe(1);
      createdItemId = itemData?.id || null;
    });

    it("prevents Restaurant A from inserting menu items into Restaurant B", async () => {
      const { data, error } = await clientA
        .from("menu_items")
        .insert({
          restaurant_id: REST_B_ID,
          name: "Intruder Item",
          base_price: 100,
        })
        .select();

      // RLS policy prevents cross-tenant insert
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("performs soft-delete on menu item and verifies it is excluded from active queries", async () => {
      expect(createdItemId).not.toBeNull();

      // 1. Soft-delete the item by setting deleted_at
      const { error: updateError } = await clientA
        .from("menu_items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", createdItemId!);

      expect(updateError).toBeNull();

      // 2. Querying with deleted_at IS NULL filter should not return it
      const { data: activeItems } = await clientA
        .from("menu_items")
        .select("id, name")
        .eq("id", createdItemId!)
        .is("deleted_at", null);

      expect(activeItems).toEqual([]);

      // 3. Customer query through anon client respects RLS soft-delete filter
      const { data: anonItems, error: anonError } = await anonClient
        .from("menu_items")
        .select("id, name")
        .eq("id", createdItemId!);

      if (anonError) console.error("Anon select error in menu.test:", anonError);
      expect(anonError).toBeNull();
      expect(anonItems).toEqual([]);
    });
  });
});
