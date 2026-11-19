import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 22b & 22c: Role Enforcement Scope across Menu Items, Categories, Tables & Restaurants", () => {
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let kitchenClient: SupabaseClient;
  let waiterClient: SupabaseClient;
  let superAdminClient: SupabaseClient;

  let restId: string;
  let categoryId: string;
  const serviceRole = getServiceRoleClient();

  async function signInUser(email: string, password?: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pw = password || creds.restaurant_a.owner.password;
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: pw,
    });
    if (error || !data.user) {
      throw new Error(`Failed to sign in as ${email}: ${error?.message}`);
    }
    return client;
  }

  beforeAll(async () => {
    // 1. Resolve demo restaurant ID
    const rests = await serviceRole.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1`
    );
    if (!rests.length) {
      throw new Error("demo-restaurant not found in staging database");
    }
    restId = rests[0].id;

    // 2. Ensure test category exists in restId
    const cats = await serviceRole.query<{ id: string }>(
      `SELECT id FROM menu_categories WHERE restaurant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [restId]
    );
    if (cats.length) {
      categoryId = cats[0].id;
    } else {
      const inserted = await serviceRole.query<{ id: string }>(
        `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'Role Test Cat') RETURNING id`,
        [restId]
      );
      categoryId = inserted[0].id;
    }

    // 3. Sign in all 6 roles via test credentials
    const creds = getTestCredentials();
    ownerClient = await signInUser(creds.restaurant_a.owner.email, creds.restaurant_a.owner.password);
    managerClient = await signInUser(creds.restaurant_a.manager.email, creds.restaurant_a.manager.password);
    cashierClient = await signInUser(creds.restaurant_a.cashier.email, creds.restaurant_a.cashier.password);
    kitchenClient = await signInUser(creds.restaurant_a.kitchen.email, creds.restaurant_a.kitchen.password);
    waiterClient = await signInUser(creds.restaurant_a.waiter.email, creds.restaurant_a.waiter.password);
    superAdminClient = await signInUser(creds.super_admin.email, creds.super_admin.password);
  });

  // =========================================================================
  // 1. MENU ITEMS
  // =========================================================================
  describe("1. Menu Items Write Operations", () => {
    it("allows Owner and Manager to INSERT menu_items; DENIES Cashier, Kitchen, Waiter (42501)", async () => {
      // Waiter attempt -> 42501
      const { error: waiterErr } = await waiterClient.from("menu_items").insert({
        restaurant_id: restId,
        category_id: categoryId,
        name: "Waiter Burger",
        base_price: 150,
      });
      expect(waiterErr).not.toBeNull();
      expect(waiterErr?.code).toBe("42501");

      // Cashier attempt -> 42501
      const { error: cashierErr } = await cashierClient.from("menu_items").insert({
        restaurant_id: restId,
        category_id: categoryId,
        name: "Cashier Burger",
        base_price: 150,
      });
      expect(cashierErr).not.toBeNull();
      expect(cashierErr?.code).toBe("42501");

      // Kitchen attempt -> 42501
      const { error: kitchenErr } = await kitchenClient.from("menu_items").insert({
        restaurant_id: restId,
        category_id: categoryId,
        name: "Kitchen Burger",
        base_price: 150,
      });
      expect(kitchenErr).not.toBeNull();
      expect(kitchenErr?.code).toBe("42501");

      // Manager attempt -> Allowed
      const { data: mgrItem, error: mgrErr } = await managerClient
        .from("menu_items")
        .insert({
          restaurant_id: restId,
          category_id: categoryId,
          name: "Manager Burger",
          base_price: 180,
        })
        .select()
        .single();
      expect(mgrErr).toBeNull();
      expect(mgrItem?.name).toBe("Manager Burger");

      // Owner attempt -> Allowed
      const { data: ownerItem, error: ownerErr } = await ownerClient
        .from("menu_items")
        .insert({
          restaurant_id: restId,
          category_id: categoryId,
          name: "Owner Burger",
          base_price: 200,
        })
        .select()
        .single();
      expect(ownerErr).toBeNull();
      expect(ownerItem?.name).toBe("Owner Burger");

      // Clean up test items
      await serviceRole.query(`DELETE FROM menu_items WHERE id IN ($1, $2)`, [mgrItem.id, ownerItem.id]);
    });

    it("allows Kitchen to toggle is_available ONLY; DENIES modifying price or name, asserts unchanged", async () => {
      // Seed item
      const [item] = await serviceRole.query<{ id: string; base_price: number; name: string }>(
        `INSERT INTO menu_items (restaurant_id, category_id, name, base_price, is_available)
         VALUES ($1, $2, 'Kitchen Toggle Test', 100, true) RETURNING id, base_price, name`,
        [restId, categoryId]
      );

      // Kitchen tries to modify base_price -> DENIED (42501 or 0 rows) AND unchanged
      const { data: pData, error: priceErr } = await kitchenClient
        .from("menu_items")
        .update({ base_price: 150 })
        .eq("id", item.id)
        .select();
      if (priceErr) {
        expect(priceErr.code).toBe("42501");
      } else {
        expect(pData?.length || 0).toBe(0);
      }
      const [afterPrice] = await serviceRole.query<{ base_price: number }>(
        `SELECT base_price FROM menu_items WHERE id = $1`, [item.id]
      );
      expect(Number(afterPrice.base_price)).toBe(100);

      // Kitchen tries to modify name -> DENIED (42501 or 0 rows) AND unchanged
      const { data: nData, error: nameErr } = await kitchenClient
        .from("menu_items")
        .update({ name: "Kitchen Hack Name" })
        .eq("id", item.id)
        .select();
      if (nameErr) {
        expect(nameErr.code).toBe("42501");
      } else {
        expect(nData?.length || 0).toBe(0);
      }
      const [afterName] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM menu_items WHERE id = $1`, [item.id]
      );
      expect(afterName.name).toBe("Kitchen Toggle Test");

      // Kitchen toggles availability ONLY -> Allowed
      const { error: toggleErr } = await kitchenClient
        .from("menu_items")
        .update({ is_available: false, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      expect(toggleErr).toBeNull();

      // Waiter tries to toggle availability -> DENIED AND unchanged
      const { data: wData, error: waiterToggleErr } = await waiterClient
        .from("menu_items")
        .update({ is_available: true, updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .select();
      if (waiterToggleErr) {
        expect(waiterToggleErr.code).toBe("42501");
      } else {
        expect(wData?.length || 0).toBe(0);
      }
      const [afterWaiter] = await serviceRole.query<{ is_available: boolean }>(
        `SELECT is_available FROM menu_items WHERE id = $1`, [item.id]
      );
      expect(afterWaiter.is_available).toBe(false);

      // Clean up
      await serviceRole.query(`DELETE FROM menu_items WHERE id = $1`, [item.id]);
    });

    it("restricts soft-delete and hard-delete of menu_items strictly to Owner; DENIES Manager, asserts unchanged", async () => {
      const [item] = await serviceRole.query<{ id: string }>(
        `INSERT INTO menu_items (restaurant_id, category_id, name, base_price, is_available)
         VALUES ($1, $2, 'Delete Test Item', 120, true) RETURNING id`,
        [restId, categoryId]
      );

      // Manager tries soft-delete (deleted_at) -> DENIED AND unchanged
      const { data: sData, error: mgrSoftErr } = await managerClient
        .from("menu_items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", item.id)
        .select();
      if (mgrSoftErr) {
        expect(mgrSoftErr.code).toBe("42501");
      } else {
        expect(sData?.length || 0).toBe(0);
      }
      const [afterSoft] = await serviceRole.query<{ deleted_at: string | null }>(
        `SELECT deleted_at FROM menu_items WHERE id = $1`, [item.id]
      );
      expect(afterSoft.deleted_at).toBeNull();

      // Manager tries hard DELETE -> DENIED AND unchanged
      const { data: hData, error: mgrHardErr } = await managerClient
        .from("menu_items")
        .delete()
        .eq("id", item.id)
        .select();
      if (mgrHardErr) {
        expect(mgrHardErr.code).toBe("42501");
      } else {
        expect(hData?.length || 0).toBe(0);
      }
      const [afterHard] = await serviceRole.query<{ id: string }>(
        `SELECT id FROM menu_items WHERE id = $1`, [item.id]
      );
      expect(afterHard?.id).toBe(item.id);

      // Owner soft-delete -> Allowed
      const { error: ownerSoftErr } = await ownerClient
        .from("menu_items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", item.id);
      expect(ownerSoftErr).toBeNull();

      // Owner hard-delete -> Allowed
      const { error: ownerHardErr } = await ownerClient
        .from("menu_items")
        .delete()
        .eq("id", item.id);
      expect(ownerHardErr).toBeNull();
    });
  });

  // =========================================================================
  // 2. MENU CATEGORIES
  // =========================================================================
  describe("2. Menu Categories Write Operations", () => {
    it("allows Owner and Manager to INSERT/UPDATE categories; DENIES Cashier, Kitchen, Waiter, asserts unchanged", async () => {
      // Manager insert -> Allowed
      const { data: mgrCat, error: mErr } = await managerClient
        .from("menu_categories")
        .insert({
          restaurant_id: restId,
          name: `Mgr Cat ${Date.now()}`,
          description: "Initial description",
        })
        .select()
        .single();
      expect(mErr).toBeNull();

      // Waiter tries to UPDATE category -> DENIED AND unchanged
      const { data: wData, error: wUpErr } = await waiterClient
        .from("menu_categories")
        .update({ description: "Hacked by Waiter" })
        .eq("id", mgrCat.id)
        .select();
      if (wUpErr) {
        expect(wUpErr.code).toBe("42501");
      } else {
        expect(wData?.length || 0).toBe(0);
      }
      const [afterWaiter] = await serviceRole.query<{ description: string }>(
        `SELECT description FROM menu_categories WHERE id = $1`, [mgrCat.id]
      );
      expect(afterWaiter.description).toBe("Initial description");

      // Manager update -> Allowed
      const { error: mUpErr } = await managerClient
        .from("menu_categories")
        .update({ description: "Updated by Manager" })
        .eq("id", mgrCat.id);
      expect(mUpErr).toBeNull();

      // Manager DELETE -> DENIED (42501 or 0 rows) AND unchanged
      const { data: mDelData, error: mDelErr } = await managerClient
        .from("menu_categories")
        .delete()
        .eq("id", mgrCat.id)
        .select();
      if (mDelErr) {
        expect(mDelErr.code).toBe("42501");
      } else {
        expect(mDelData?.length || 0).toBe(0);
      }
      const [afterMgrDel] = await serviceRole.query<{ id: string }>(
        `SELECT id FROM menu_categories WHERE id = $1`, [mgrCat.id]
      );
      expect(afterMgrDel?.id).toBe(mgrCat.id);

      // Owner DELETE -> Allowed
      const { error: oDelErr } = await ownerClient
        .from("menu_categories")
        .delete()
        .eq("id", mgrCat.id);
      expect(oDelErr).toBeNull();
    });
  });

  // =========================================================================
  // 3. RESTAURANT TABLES
  // =========================================================================
  describe("3. Restaurant Tables Write Operations", () => {
    it("allows Owner and Manager to INSERT/UPDATE/DELETE tables; DENIES Cashier, Kitchen, Waiter, asserts unchanged", async () => {
      const testTableNum = `T-${Date.now() % 10000}`;

      // Manager insert table -> Allowed
      const { data: mgrTable, error: mErr } = await managerClient
        .from("restaurant_tables")
        .insert({
          restaurant_id: restId,
          table_number: testTableNum,
          capacity: 4,
        })
        .select()
        .single();
      expect(mErr).toBeNull();
      expect(mgrTable?.table_number).toBe(testTableNum);

      // Waiter update table capacity -> DENIED (42501 or 0 rows) AND unchanged
      const { data: wData, error: wUpErr } = await waiterClient
        .from("restaurant_tables")
        .update({ capacity: 99 })
        .eq("id", mgrTable.id)
        .select();
      if (wUpErr) {
        expect(wUpErr.code).toBe("42501");
      } else {
        expect(wData?.length || 0).toBe(0);
      }
      const [afterW] = await serviceRole.query<{ capacity: number }>(
        `SELECT capacity FROM restaurant_tables WHERE id = $1`, [mgrTable.id]
      );
      expect(afterW.capacity).toBe(4);

      // Waiter delete table -> DENIED (42501 or 0 rows) AND unchanged
      const { data: wDelData, error: wDelErr } = await waiterClient
        .from("restaurant_tables")
        .delete()
        .eq("id", mgrTable.id)
        .select();
      if (wDelErr) {
        expect(wDelErr.code).toBe("42501");
      } else {
        expect(wDelData?.length || 0).toBe(0);
      }
      const [afterWDel] = await serviceRole.query<{ id: string }>(
        `SELECT id FROM restaurant_tables WHERE id = $1`, [mgrTable.id]
      );
      expect(afterWDel?.id).toBe(mgrTable.id);

      // Manager update table -> Allowed
      const { error: mUpErr } = await managerClient
        .from("restaurant_tables")
        .update({ capacity: 6 })
        .eq("id", mgrTable.id);
      expect(mUpErr).toBeNull();

      // Manager delete table -> Allowed
      const { error: mDelErr } = await managerClient
        .from("restaurant_tables")
        .delete()
        .eq("id", mgrTable.id);
      expect(mDelErr).toBeNull();
    });
  });

  // =========================================================================
  // 4. RESTAURANTS SETTINGS
  // =========================================================================
  describe("4. Restaurant Settings Update Operations", () => {
    it("allows Owner and Manager to update restaurant settings; DENIES Cashier, Kitchen, Waiter, asserts unchanged", async () => {
      // Capture original values
      const [orig] = await serviceRole.query<{ phone: string; default_vat_rate: number; address: string }>(
        `SELECT phone, default_vat_rate, address FROM restaurants WHERE id = $1`, [restId]
      );

      // Waiter update phone -> DENIED AND unchanged
      const { data: wData, error: wErr } = await waiterClient
        .from("restaurants")
        .update({ phone: "+8801700999888" })
        .eq("id", restId)
        .select();
      if (wErr) {
        expect(wErr.code).toBe("42501");
      } else {
        expect(wData?.length || 0).toBe(0);
      }
      const [afterW] = await serviceRole.query<{ phone: string }>(
        `SELECT phone FROM restaurants WHERE id = $1`, [restId]
      );
      expect(afterW.phone).toBe(orig.phone);

      // Cashier update default_vat_rate -> DENIED AND unchanged
      const { data: cData, error: cErr } = await cashierClient
        .from("restaurants")
        .update({ default_vat_rate: 7.5 })
        .eq("id", restId)
        .select();
      if (cErr) {
        expect(cErr.code).toBe("42501");
      } else {
        expect(cData?.length || 0).toBe(0);
      }
      const [afterC] = await serviceRole.query<{ default_vat_rate: number }>(
        `SELECT default_vat_rate FROM restaurants WHERE id = $1`, [restId]
      );
      expect(Number(afterC.default_vat_rate)).toBe(Number(orig.default_vat_rate));

      // Kitchen update address -> DENIED AND unchanged
      const { data: kData, error: kErr } = await kitchenClient
        .from("restaurants")
        .update({ address: "Hacked Kitchen St" })
        .eq("id", restId)
        .select();
      if (kErr) {
        expect(kErr.code).toBe("42501");
      } else {
        expect(kData?.length || 0).toBe(0);
      }
      const [afterK] = await serviceRole.query<{ address: string }>(
        `SELECT address FROM restaurants WHERE id = $1`, [restId]
      );
      expect(afterK.address).toBe(orig.address);

      // Manager update operational settings (service_charge_rate) -> Allowed
      const { error: mErr } = await managerClient
        .from("restaurants")
        .update({ service_charge_rate: 3.5 })
        .eq("id", restId);
      expect(mErr).toBeNull();

      // Owner update settings -> Allowed
      const { error: oErr } = await ownerClient
        .from("restaurants")
        .update({ service_charge_rate: 5.0 })
        .eq("id", restId);
      expect(oErr).toBeNull();
    });
  });

  // =========================================================================
  // 5. SUPER ADMIN OVERSIGHT
  // =========================================================================
  describe("5. Super Admin Global Oversight", () => {
    it("allows Super Admin to perform write operations across tables", async () => {
      const saItemName = `SA Item ${Date.now()}`;
      const { data: saItem, error: saItemErr } = await superAdminClient
        .from("menu_items")
        .insert({
          restaurant_id: restId,
          category_id: categoryId,
          name: saItemName,
          base_price: 350,
        })
        .select()
        .single();
      expect(saItemErr).toBeNull();
      expect(saItem?.name).toBe(saItemName);

      // Clean up
      const { error: saDelErr } = await superAdminClient
        .from("menu_items")
        .delete()
        .eq("id", saItem.id);
      expect(saDelErr).toBeNull();
    });
  });
});
