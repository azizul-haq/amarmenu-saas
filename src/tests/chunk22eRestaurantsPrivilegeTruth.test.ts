import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";
import { getTestCredentials } from "./testCredentials";

describe("Chunk 22e: Restaurants Column-Level Privileges, Resend Invite & Security Truth", () => {
  let ownerAClient: SupabaseClient;
  let managerAClient: SupabaseClient;
  let cashierAClient: SupabaseClient;
  let kitchenAClient: SupabaseClient;
  let waiterAClient: SupabaseClient;
  let superAdminClient: SupabaseClient;

  let restAId: string;
  const serviceRole = getServiceRoleClient();
  const creds = getTestCredentials();

  async function signInUser(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      throw new Error(`Failed to sign in as ${email}: ${error?.message}`);
    }
    return client;
  }

  beforeAll(async () => {
    // Resolve Restaurant A ID
    const [restA] = await serviceRole.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1`
    );
    restAId = restA.id;

    ownerAClient = await signInUser(creds.restaurant_a.owner.email, creds.restaurant_a.owner.password);
    managerAClient = await signInUser(creds.restaurant_a.manager.email, creds.restaurant_a.manager.password);
    cashierAClient = await signInUser(creds.restaurant_a.cashier.email, creds.restaurant_a.cashier.password);
    kitchenAClient = await signInUser(creds.restaurant_a.kitchen.email, creds.restaurant_a.kitchen.password);
    waiterAClient = await signInUser(creds.restaurant_a.waiter.email, creds.restaurant_a.waiter.password);
    superAdminClient = await signInUser(creds.super_admin.email, creds.super_admin.password);
  });

  // =========================================================================
  // 1. POSTGREST PATCH ON RESTAURANTS VIA COLUMN-LEVEL GRANTS
  // =========================================================================
  describe("1. restaurants Column-Level Update Privileges", () => {
    it("allows Owner to PATCH allowed settings column 'name'", async () => {
      const newName = `Demo Rest ${Date.now()}`;
      const { error, status } = await ownerAClient
        .from("restaurants")
        .update({ name: newName })
        .eq("id", restAId);

      expect(error).toBeNull();
      expect([200, 204]).toContain(status);

      // Verify row updated
      const [row] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(row.name).toBe(newName);
    });

    it("DENIES Owner from updating subscription_plan (42501)", async () => {
      const { error } = await ownerAClient
        .from("restaurants")
        .update({ subscription_plan: "enterprise" } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/permission denied for table restaurants/i);
    });

    it("DENIES Owner from updating slug (42501)", async () => {
      const { error } = await ownerAClient
        .from("restaurants")
        .update({ slug: "hacked-slug" } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/permission denied for table restaurants/i);
    });

    it("DENIES Owner from updating is_active (42501)", async () => {
      const { error } = await ownerAClient
        .from("restaurants")
        .update({ is_active: false } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/permission denied for table restaurants/i);
    });

    it("DENIES Owner from updating trial_ends_at (42501)", async () => {
      const { error } = await ownerAClient
        .from("restaurants")
        .update({ trial_ends_at: new Date().toISOString() } as any)
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/permission denied for table restaurants/i);
    });

    it("allows Manager to update default_vat_rate (has change_settings and column in grant)", async () => {
      const { error, status } = await managerAClient
        .from("restaurants")
        .update({ default_vat_rate: 0.075 })
        .eq("id", restAId);

      expect(error).toBeNull();
      expect([200, 204]).toContain(status);
    });

    it("DENIES Cashier from updating restaurant name (lacks change_settings, row unchanged)", async () => {
      const [before] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );

      const { error } = await cashierAClient
        .from("restaurants")
        .update({ name: "Cashier Hacked Name" })
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");

      const [after] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(after.name).toBe(before.name);
    });

    it("DENIES Kitchen from updating restaurant name (lacks change_settings, row unchanged)", async () => {
      const [before] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );

      const { error } = await kitchenAClient
        .from("restaurants")
        .update({ name: "Kitchen Hacked Name" })
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");

      const [after] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(after.name).toBe(before.name);
    });

    it("DENIES Waiter from updating restaurant name (lacks change_settings, row unchanged)", async () => {
      const [before] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );

      const { error } = await waiterAClient
        .from("restaurants")
        .update({ name: "Waiter Hacked Name" })
        .eq("id", restAId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");

      const [after] = await serviceRole.query<{ name: string }>(
        `SELECT name FROM restaurants WHERE id = $1`,
        [restAId]
      );
      expect(after.name).toBe(before.name);
    });
  });

  // =========================================================================
  // 2. OPEN SIGNUPS DISABLED CHECK
  // =========================================================================
  describe("2. Open Signups Disabled (Item 11)", () => {
    it("rejects anonymous auth.signUp (open signups disabled on instance)", async () => {
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });

      const { data, error } = await anonClient.auth.signUp({
        email: `hacker_${Date.now()}@example.com`,
        password: "DangerousPassword123!",
      });

      // When open signups are disabled in GoTrue config:
      // error.message: "Signups not allowed for this instance" or 400 Bad Request
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/signups not allowed|disabled|forbidden|not permitted/i);
    });
  });

  // =========================================================================
  // 3. RESEND INVITE ACTION RULES (Item 3)
  // =========================================================================
  describe("3. resend_invite Edge Function Rules", () => {
    it("rejects non-super-admin caller from resending invite (403)", async () => {
      const resp = await ownerAClient.functions.invoke("approve-registration", {
        body: {
          action: "resend_invite",
          restaurantId: restAId,
        },
      });

      expect(resp.error).toBeDefined();
      expect(resp.error?.message).toMatch(/forbidden|super admin/i);
    });

    it("rejects invocation without restaurantId (400)", async () => {
      const resp = await superAdminClient.functions.invoke("approve-registration", {
        body: {
          action: "resend_invite",
        },
      });

      expect(resp.error).toBeDefined();
      expect(resp.error?.message).toMatch(/missing or invalid.*restaurantId/i);
    });

    it("verifies platform_audit_logs never contains the token or link", async () => {
      // Query platform_audit_logs for resend_invite actions
      const logs = await serviceRole.query<{ action: string; new_values: any }>(
        `SELECT action, new_values FROM platform_audit_logs WHERE action LIKE 'resend_invite%' ORDER BY created_at DESC LIMIT 5`
      );

      for (const log of logs) {
        const str = JSON.stringify(log);
        expect(str).not.toMatch(/token_hash/i);
        expect(str).not.toMatch(/hashed_token/i);
        expect(str).not.toMatch(/action_link/i);
      }
    });
  });
});
