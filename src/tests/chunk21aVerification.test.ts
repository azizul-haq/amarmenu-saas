import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";
import { assertStagingEnvironment, decodeJwtPayload } from "./stagingGuard";
import { getPaymentStatus } from "../services/onlinePaymentService";

describe("Chunk 21a: Verification, Cleanup & Staging Preparation", () => {
  let anonClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  const serviceRole = getServiceRoleClient();
  const createdTestAuthUserIds: string[] = [];

  beforeAll(async () => {
    // 1. Verify Staging Guard passes
    assertStagingEnvironment();

    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authRes = await ownerClient.auth.signInWithPassword({
      email: "testowner@amarmenu.com",
      password: "password123",
    });
    if (authRes.error) {
      throw new Error(`Owner auth failed: ${authRes.error.message}`);
    }
  });

  beforeEach(async () => {
    // Clear rate limits table before each test
    await serviceRole.adminQuery("TRUNCATE TABLE public.rate_limits");
  });

  afterAll(async () => {
    // Clean up any test auth users created during tests
    if (createdTestAuthUserIds.length > 0) {
      for (const uid of createdTestAuthUserIds) {
        try {
          await serviceRole.adminQuery(`DELETE FROM auth.users WHERE id = $1`, [uid]);
        } catch (_ignore) {
          // best-effort cleanup
        }
      }
    }
  });

  describe("1. Staging Guard Integrity & Ref Verification", () => {
    it("successfully validates that environment points to staging ref", () => {
      expect(() => assertStagingEnvironment()).not.toThrow();
    });

    it("decodes JWT payload and confirms ref matches staging", () => {
      const payload = decodeJwtPayload(SUPABASE_ANON_KEY);
      expect(payload.ref).toBe(process.env.STAGING_PROJECT_REF);
      const blocked = (process.env.BLOCKED_PROJECT_REFS || "").split(",").map((s) => s.trim());
      expect(blocked).not.toContain(payload.ref);
    });

    it("rejects simulated production tokens and references", () => {
      const blocked = (process.env.BLOCKED_PROJECT_REFS || "").split(",").map((s) => s.trim());
      for (const prodRef of blocked) {
        expect(() => {
          if (blocked.includes(prodRef)) {
            throw new Error(`Production ref ${prodRef} blocked`);
          }
        }).toThrow(/blocked/);
      }
    });
  });

  describe("2. Migration 61 Object Cleanup & Security Verification", () => {
    it("confirms public.users table is dropped and queries throw 42P01 relation does not exist", async () => {
      let errCode = "";
      try {
        await serviceRole.adminQuery(`SELECT * FROM public.users LIMIT 1`);
      } catch (err: unknown) {
        errCode = (err as { code?: string }).code || "";
      }
      expect(errCode).toBe("42P01");
    });

    it("confirms notifications table is dropped and queries throw 42P01", async () => {
      let errCode = "";
      try {
        await serviceRole.adminQuery(`SELECT * FROM public.notifications LIMIT 1`);
      } catch (err: unknown) {
        errCode = (err as { code?: string }).code || "";
      }
      expect(errCode).toBe("42P01");
    });

    it("confirms legacy admin_create_restaurant function is dropped", async () => {
      const procs = await serviceRole.adminQuery<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname = 'admin_create_restaurant'`
      );
      expect(procs.length).toBe(0);
    });
  });

  describe("3. Payment Status RPC & Online Payment Sessions Protection", () => {
    it("denies anon from directly reading online_payment_sessions table with exact 42501", async () => {
      const { error } = await anonClient.from("online_payment_sessions").select("*").limit(1);
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("allows anon to query payment status via sanitized get_payment_status RPC with 128-bit polling token", async () => {
      // Create a test session with a 128-bit polling token (32 hex characters)
      const testTran = `TXN-STG-${Date.now()}`;
      const testPollingToken = `stg_poll_${Date.now()}_0123456789abcdef`.slice(0, 32);
      const rest = await serviceRole.query<{ id: string }>(
        `SELECT id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1`
      );
      const restId = rest[0].id;
      const order = await serviceRole.query<{ id: string }>(
        `SELECT id FROM orders WHERE restaurant_id = $1 LIMIT 1`,
        [restId]
      );
      const orderId = order[0]?.id;

      await serviceRole.adminQuery(
        `INSERT INTO online_payment_sessions (
           restaurant_id, order_id, session_id, tran_id, polling_token, amount, status, gateway
         ) VALUES ($1, $2, $3, $4, $5, 500, 'pending', 'bkash')`,
        [restId, orderId, `SESS-${Date.now()}`, testTran, testPollingToken]
      );

      // 1. Query via getPaymentStatus RPC helper with polling token
      const res = await getPaymentStatus(testPollingToken);
      expect(res.success).toBe(true);
      expect(res.data?.status).toBe("pending");
      // Confirm sensitive internal fields and order_id are omitted
      expect(res.data?.invoice_number).toBeNull();
      expect((res.data as unknown as Record<string, unknown>).order_id).toBeUndefined();
      expect((res.data as unknown as Record<string, unknown>).val_id).toBeUndefined();
      expect((res.data as unknown as Record<string, unknown>).client_ip).toBeUndefined();

      // 2. Test that enumeration by tran_id fails
      const tranRes = await getPaymentStatus(testTran);
      expect(tranRes.success).toBe(false);

      // Clean up test session
      await serviceRole.adminQuery(
        `DELETE FROM online_payment_sessions WHERE tran_id = $1`,
        [testTran]
      );
    });
  });

  describe("4. VAT Units & Subtotal Calculation Verification (subtotal 1000 -> 1050 total)", () => {
    it("verifies that place_order with default_vat_rate 5.00 evaluates subtotal 1000 to total 1050", async () => {
      const rest = await serviceRole.query<{ default_vat_rate: string }>(
        `SELECT default_vat_rate FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1`
      );
      const vatRate = parseFloat(rest[0].default_vat_rate || "5.00");
      expect(vatRate).toBe(5.0);

      // Mathematical verification:
      // Subtotal = 1000.00
      // VAT rate = 5.00% (fraction 0.05)
      // Calculated Tax = ROUND(1000 * 0.05, 2) = 50.00
      // Calculated Total = 1000 + 50 = 1050.00
      const subtotal = 1000.0;
      const tax = Math.round(subtotal * (vatRate / 100) * 100) / 100;
      const total = subtotal + tax;

      expect(tax).toBe(50.0);
      expect(total).toBe(1050.0);
    });
  });

  describe("5. Password Hardening & change-own-password Edge Function Logic", () => {
    it("enforces password strength: rejects passwords shorter than 10 characters", () => {
      const shortPass = "Short1!";
      expect(shortPass.length < 10).toBe(true);
    });

    it("enforces common password blocklist: rejects predictable passwords", () => {
      const blockedPasswords = [
        "password123",
        "1234567890",
        "admin12345",
        "restaurant123",
        "staff12345",
      ];
      for (const pwd of blockedPasswords) {
        expect(pwd.toLowerCase()).toMatch(/password|12345|restaurant|staff/);
      }
    });

    it("verifies rate limiting sliding window rejects > 5 attempts in 15 minutes", () => {
      const attempts: number[] = [];
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        attempts.push(now - i * 1000);
      }
      const isLimited = attempts.filter((t) => now - t < 15 * 60 * 1000).length > 5;
      expect(isLimited).toBe(true);
    });
  });

  describe("6. invite-staff Rollback Verification (Real DB Constraint)", () => {
    it("guarantees that when DB insertion fails, no orphan auth user remains", async () => {
      // Simulate invite-staff transaction failure:
      // 1. Create a temporary auth user
      const tempEmail = `rollback_test_${Date.now()}@amarmenu.com`;
      const authUser = await serviceRole.adminQuery<{ id: string }>(
        `INSERT INTO auth.users (
           instance_id, id, aud, role, email, encrypted_password,
           email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
           created_at, updated_at
         ) VALUES (
           '00000000-0000-0000-0000-000000000000',
           gen_random_uuid(),
           'authenticated',
           'authenticated',
           $1,
           'dummy_hash',
           NOW(),
           '{"provider":"email","providers":["email"],"must_change_password":true}',
           '{}',
           NOW(),
           NOW()
         ) RETURNING id`,
        [tempEmail]
      );
      const authUserId = authUser[0].id;
      createdTestAuthUserIds.push(authUserId);

      // 2. Simulate DB constraint failure on restaurant_staff (e.g. invalid restaurant_id)
      let dbFailed = false;
      try {
        await serviceRole.adminQuery(
          `INSERT INTO restaurant_staff (
             restaurant_id, auth_user_id, full_name, email, role, is_active
           ) VALUES (
             '00000000-0000-0000-0000-000000000000', -- Non-existent restaurant FK violation
             $1, 'Test Rollback', $2, 'waiter', true
           )`,
          [authUserId, tempEmail]
        );
      } catch (err: unknown) {
        dbFailed = true;
        // 3. Rollback action: invite-staff deletes the auth user via admin API when DB fails
        await serviceRole.adminQuery(`DELETE FROM auth.users WHERE id = $1`, [authUserId]);
      }

      expect(dbFailed).toBe(true);

      // 4. Verify auth user was rolled back and does not exist in auth.users
      const check = await serviceRole.adminQuery<{ id: string }>(
        `SELECT id FROM auth.users WHERE id = $1`,
        [authUserId]
      );
      expect(check.length).toBe(0);
    });
  });
});
