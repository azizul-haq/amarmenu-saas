import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";

describe("Chunk 22c: Permanent Privilege Truth & Lockdown Regression Suite", () => {
  let waiterAClient: SupabaseClient;
  let cashierAClient: SupabaseClient;
  let adminClient: SupabaseClient;

  let restAId: string;
  let sampleOrderId: string;
  let samplePaymentId: string;

  const serviceRole = getServiceRoleClient();

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
    // Resolve demo restaurant and sample order/payment
    const rests = await serviceRole.query<{ id: string }>(
      `SELECT id FROM restaurants WHERE slug = 'demo-restaurant' LIMIT 1`
    );
    restAId = rests[0].id;

    const orders = await serviceRole.query<{ id: string }>(
      `SELECT id FROM orders WHERE restaurant_id = $1 LIMIT 1`,
      [restAId]
    );
    sampleOrderId = orders[0]?.id;

    const payments = await serviceRole.query<{ id: string }>(
      `SELECT id FROM payments LIMIT 1`
    );
    samplePaymentId = payments[0]?.id;

    waiterAClient = await signInUser("testwaiter@amarmenu.com");
    cashierAClient = await signInUser("testcashier@amarmenu.com");
    adminClient = await signInUser("admin@foodorder.com");
  });

  it("(a) blocks anon from reading sensitive columns of restaurants (42501)", async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/restaurants?select=email,owner_name,vat_bin_no,subscription_plan&limit=1`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      }
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("42501");
    expect(body.message).toContain("permission denied for table restaurants");
  });

  it("(b) blocks anon from reading qr_token on restaurant_tables (42501)", async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/restaurant_tables?select=qr_token&limit=1`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      }
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("42501");
    expect(body.message).toContain("permission denied for table restaurant_tables");
  });

  it("(c) blocks waiter of restaurant A from selecting sensitive columns of restaurant B (42501)", async () => {
    const session = (await waiterAClient.auth.getSession()).data.session;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/restaurants?slug=eq.dhanmondi-treat&select=email,owner_name,vat_bin_no,subscription_plan,trade_license_no`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session!.access_token}`,
        },
      }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("42501");
    expect(body.message).toContain("permission denied for table restaurants");
  });

  it("(d) blocks waiter and cashier from directly PATCHing orders and payments (42501)", async () => {
    // 1. Waiter PATCH orders
    const { error: wOrderErr } = await waiterAClient
      .from("orders")
      .update({ total: 1, discount: 999, subtotal: 1000 })
      .eq("id", sampleOrderId);
    expect(wOrderErr).not.toBeNull();
    expect(wOrderErr?.code).toBe("42501");
    expect(wOrderErr?.message).toContain("permission denied for table orders");

    // 2. Cashier PATCH orders
    const { error: cOrderErr } = await cashierAClient
      .from("orders")
      .update({ total: 1, discount: 999, subtotal: 1000 })
      .eq("id", sampleOrderId);
    expect(cOrderErr).not.toBeNull();
    expect(cOrderErr?.code).toBe("42501");
    expect(cOrderErr?.message).toContain("permission denied for table orders");

    // 3. Cashier PATCH payments
    const { error: cPayErr } = await cashierAClient
      .from("payments")
      .update({ amount: 1, status: "completed" })
      .eq("id", samplePaymentId);
    expect(cPayErr).not.toBeNull();
    expect(cPayErr?.code).toBe("42501");
    expect(cPayErr?.message).toContain("permission denied for table payments");
  });

  it("(e) blocks reading hidden columns and writing to restaurant_staff via PostgREST (42501)", async () => {
    const session = (await waiterAClient.auth.getSession()).data.session;

    // 1. SELECT manager_pin_hash
    const readRes = await fetch(
      `${SUPABASE_URL}/rest/v1/restaurant_staff?select=id,full_name,manager_pin_hash&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session!.access_token}`,
        },
      }
    );
    expect(readRes.status).toBe(403);
    const readBody = await readRes.json();
    expect(readBody.code).toBe("42501");
    expect(readBody.message).toContain("permission denied for table restaurant_staff");

    // 2. PATCH restaurant_staff
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/restaurant_staff?auth_user_id=eq.${session!.user.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ manager_pin_hash: "tampered_pin", failed_pin_attempts: 0 }),
      }
    );
    expect(patchRes.status).toBe(403);
    const patchBody = await patchRes.json();
    expect(patchBody.code).toBe("42501");
    expect(patchBody.message).toContain("permission denied for table restaurant_staff");
  });

  it("(f) allows Super Admin to read registration_requests (200)", async () => {
    const session = (await adminClient.auth.getSession()).data.session;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/registration_requests?select=id,restaurant_name,email,status&limit=2`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session!.access_token}`,
        },
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
