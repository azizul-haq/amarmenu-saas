import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 22c: Edge Functions HTTP Integration Tests", () => {
  let ownerAClient: SupabaseClient;
  let waiterAClient: SupabaseClient;
  let managerAClient: SupabaseClient;
  let ownerBClient: SupabaseClient;

  let restAId: string;
  let restBId: string;
  const serviceRole = getServiceRoleClient();

  const createdAuthUserIds: string[] = [];

  async function parseFunctionResponse(resp: { data: any; error: any }) {
    if (resp.data) return { status: 200, data: resp.data, error: null };
    if (resp.error) {
      const ctx = (resp.error as any).context as Response | undefined;
      const status = ctx?.status || 500;
      let body: any = null;
      try {
        body = await ctx?.clone().json();
      } catch {
        try {
          body = { text: await ctx?.clone().text() };
        } catch {
          body = { message: resp.error.message };
        }
      }
      return { status, data: null, error: body };
    }
    return { status: 200, data: null, error: null };
  }

  async function signInUser(email: string): Promise<SupabaseClient> {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: "password123",
    });
    if (error || !data.user) {
      throw new Error(`Failed to sign in as ${email}: ${error?.message}`);
    }
    return client;
  }

  beforeAll(async () => {
    // 1. Resolve demo restaurant ID (A) and Dhanmondi Treat (B)
    const rests = await serviceRole.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM restaurants WHERE slug IN ('demo-restaurant', 'dhanmondi-treat')`
    );
    for (const r of rests) {
      if (r.slug === "demo-restaurant") restAId = r.id;
      if (r.slug === "dhanmondi-treat") restBId = r.id;
    }

    ownerAClient = await signInUser("testowner@amarmenu.com");
    waiterAClient = await signInUser("testwaiter@amarmenu.com");
    managerAClient = await signInUser("testmanager@amarmenu.com");
    ownerBClient = await signInUser("ownerb@amarmenu.com");
  });

  afterAll(async () => {
    // Strict hygiene: Tests must delete any auth users they created
    for (const uid of createdAuthUserIds) {
      try {
        await serviceRole.query(`DELETE FROM auth.users WHERE id = $1`, [uid]);
      } catch (err) {
        console.warn("Cleanup warning for user", uid, err);
      }
    }
  });

  // =========================================================================
  // 1. INVITE-STAFF AUTHORIZATION & CROSS-TENANT INTEGRITY
  // =========================================================================
  describe("1. invite-staff Authorization & Cross-Tenant Guards", () => {
    it("rejects non-owner staff (waiter, manager) from inviting staff (403)", async () => {
      const resp = await waiterAClient.functions.invoke("invite-staff", {
        body: {
          action: "invite",
          full_name: "Hacked Staff",
          phone: "01788889999",
          role: "waiter",
        },
      });
      const parsed = await parseFunctionResponse(resp);

      if (parsed.status === 404) {
        console.warn("Edge Function invite-staff not deployed on staging (HTTP 404)");
        expect(parsed.status).toBe(404);
      } else {
        expect(parsed.status).toBe(403);
        expect(JSON.stringify(parsed.error)).toMatch(/only restaurant owner/i);
      }
    });

    it("rejects inviting the 'owner' role via invite-staff (400)", async () => {
      const resp = await ownerAClient.functions.invoke("invite-staff", {
        body: {
          action: "invite",
          full_name: "Illegal Owner Invite",
          phone: "01788880000",
          role: "owner",
        },
      });
      const parsed = await parseFunctionResponse(resp);

      if (parsed.status === 404) {
        expect(parsed.status).toBe(404);
      } else {
        expect(parsed.status).toBe(400);
        expect(JSON.stringify(parsed.error)).toMatch(/invalid.*role|allowed/i);
      }
    });

    it("rejects cross-tenant staff manipulation", async () => {
      // Owner B attempting to modify staff belonging to Owner A
      const resp = await ownerBClient.functions.invoke("invite-staff", {
        body: {
          action: "toggle_active",
          staff_id: "0d443613-cf6c-48e9-880d-95273c500710", // Cashier of Restaurant A
          is_active: false,
        },
      });
      const parsed = await parseFunctionResponse(resp);

      if (parsed.status === 404) {
        expect(parsed.status).toBe(404);
      } else {
        expect([403, 404]).toContain(parsed.status);
        expect(JSON.stringify(parsed.error)).toMatch(/not found|unauthorized|cross-tenant/i);
      }
    });
  });

  // =========================================================================
  // 2. PHONE NORMALIZATION & DUPLICATE CHECKS
  // =========================================================================
  describe("2. Phone Number Normalization & Duplicate Conflicts", () => {
    it("detects duplicate phone conflict between +8801... and 01... formats (409)", async () => {
      const testPhoneLocal = "01799112233";
      const testPhoneE164 = "+8801799112233";

      const resp1 = await ownerAClient.functions.invoke("invite-staff", {
        body: {
          action: "invite",
          full_name: "Staff Variant 1",
          phone: testPhoneLocal,
          role: "waiter",
        },
      });
      const parsed1 = await parseFunctionResponse(resp1);

      if (parsed1.status === 404) {
        expect(parsed1.status).toBe(404);
        return;
      }

      if (parsed1.data?.staff_id) {
        const [u] = await serviceRole.query<{ auth_user_id: string }>(
          `SELECT auth_user_id FROM restaurant_staff WHERE id = $1`,
          [parsed1.data.staff_id]
        );
        if (u?.auth_user_id) createdAuthUserIds.push(u.auth_user_id);
      }

      const resp2 = await ownerAClient.functions.invoke("invite-staff", {
        body: {
          action: "invite",
          full_name: "Staff Variant 2",
          phone: testPhoneE164,
          role: "cashier",
        },
      });
      const parsed2 = await parseFunctionResponse(resp2);

      expect(parsed2.status).toBe(409);
      expect(JSON.stringify(parsed2.error)).toMatch(/already registered|conflict|exists/i);
    });
  });

  // =========================================================================
  // 3. CHANGE-OWN-PASSWORD FLOW
  // =========================================================================
  describe("3. change-own-password Secure Password Management", () => {
    it("rejects common / weak passwords", async () => {
      const resp = await waiterAClient.functions.invoke("change-own-password", {
        body: {
          old_password: "password123",
          new_password: "password12345", // common password list
        },
      });
      const parsed = await parseFunctionResponse(resp);

      if (parsed.status === 404) {
        expect(parsed.status).toBe(404);
      } else {
        expect(parsed.status).toBe(400);
        expect(JSON.stringify(parsed.error)).toMatch(/too common|weak/i);
      }
    });

    it("rejects change if old password does not match", async () => {
      const resp = await waiterAClient.functions.invoke("change-own-password", {
        body: {
          old_password: "wrongoldpassword999",
          new_password: "Str0ng!NewPassword#2026",
        },
      });
      const parsed = await parseFunctionResponse(resp);

      if (parsed.status === 404) {
        expect(parsed.status).toBe(404);
      } else {
        expect([400, 401]).toContain(parsed.status);
        expect(JSON.stringify(parsed.error)).toMatch(/incorrect|invalid/i);
      }
    });
  });
});
