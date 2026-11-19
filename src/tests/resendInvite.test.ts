import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assertStagingEnvironment } from "./stagingGuard";
import { getTestCredentials } from "./testCredentials";
import { getServiceRoleClient, ServiceRoleClientInterface } from "./serviceRoleClient";

/**
 * HTTP Integration Test Suite for resend_invite Edge Function action
 * 
 * Tests the complete lifecycle:
 * 1. Non-super-admin denied (403/401)
 * 2. Free-form email rejected (400)
 * 3. Never-signed-in owner gets a recovery link with type 'recovery'
 * 4. verifyOtp redemption sets password and login works
 * 5. Already-active owner receives no link (triggers password reset email)
 * 6. Rate limiting (429 on > 5 requests per 5 minutes)
 * 7. Audit log verification (ensures zero tokens or URLs in platform_audit_logs)
 */

describe("resend_invite Edge Function Lifecycle & Security", () => {
  let superAdminClient: SupabaseClient;
  let waiterClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let serviceRole: ServiceRoleClientInterface;
  let edgeFunctionUrl: string;

  const creds = getTestCredentials();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

  beforeAll(async () => {
    assertStagingEnvironment();

    serviceRole = getServiceRoleClient();
    edgeFunctionUrl = `${supabaseUrl}/functions/v1/approve-registration`;

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    // Authenticate as Super Admin
    superAdminClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data: saAuth, error: saErr } = await superAdminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (saErr || !saAuth.session) {
      throw new Error(`Failed to sign in as super admin: ${saErr?.message}`);
    }

    // Authenticate as Waiter
    waiterClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data: wAuth, error: wErr } = await waiterClient.auth.signInWithPassword({
      email: creds.restaurant_a.waiter.email,
      password: creds.restaurant_a.waiter.password,
    });
    if (wErr || !wAuth.session) {
      throw new Error(`Failed to sign in as waiter: ${wErr?.message}`);
    }
  });

  it("denies unauthenticated anonymous callers with 401", async () => {
    const res = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({
        action: "resend_invite",
        restaurantId: creds.restaurant_a.id,
      }),
    });

    expect(res.status).toBe(401);
  });

  it("denies authenticated non-super-admin (waiter) with 403 Forbidden", async () => {
    const { data: { session } } = await waiterClient.auth.getSession();
    const res = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        action: "resend_invite",
        restaurantId: creds.restaurant_a.id,
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Forbidden|Super Admin/i);
  });

  it("rejects free-form email or invalid/missing restaurantId parameter with 400", async () => {
    const { data: { session } } = await superAdminClient.auth.getSession();

    // 1. Attempt passing free-form email instead of UUID
    const resEmail = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        action: "resend_invite",
        email: "random-target@example.com",
      }),
    });
    expect(resEmail.status).toBe(400);

    // 2. Attempt passing non-UUID restaurantId
    const resInvalidId = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        action: "resend_invite",
        restaurantId: "not-a-valid-uuid",
      }),
    });
    expect(resInvalidId.status).toBe(400);
  });

  it("generates recovery link for never-signed-in owner, redeems via verifyOtp, and handles already-active account", async () => {
    const { data: { session } } = await superAdminClient.auth.getSession();

    // 1. Create an isolated test restaurant with a never-signed-in owner
    const testSlug = `resend-test-${Date.now()}`;
    const testOwnerEmail = `never_logged_${Date.now()}@example.com`;

    const restRow = await serviceRole.adminQuery<{ id: string }>(
      `INSERT INTO restaurants (name, slug, phone, email, subscription_plan, status, is_active)
       VALUES ('Resend Test Cafe', '${testSlug}', '+8801799990000', '${testOwnerEmail}', 'starter', 'active', true)
       RETURNING id;`
    );
    const testRestId = restRow[0].id;

    // Create user in auth schema via service role admin API
    const adminSupabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data: newAuthUser, error: authErr } = await adminSupabase.auth.admin.createUser({
      email: testOwnerEmail,
      email_confirm: true,
      user_metadata: { full_name: "Never Logged Owner" },
    });
    expect(authErr).toBeNull();
    const ownerUid = newAuthUser.user.id;

    // Link in restaurant_staff
    await serviceRole.query(
      `INSERT INTO restaurant_staff (restaurant_id, auth_user_id, full_name, email, role, is_active)
       VALUES ($1, $2, 'Never Logged Owner', $3, 'owner', true);`,
      [testRestId, ownerUid, testOwnerEmail]
    );

    // Verify last_sign_in_at is strictly null
    const { data: freshUser } = await adminSupabase.auth.admin.getUserById(ownerUid);
    expect(freshUser?.user?.last_sign_in_at).toBeFalsy();

    // 2. Invoke resend_invite as Super Admin
    const res = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        action: "resend_invite",
        restaurantId: testRestId,
      }),
    });

    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody.success).toBe(true);
    expect(resBody.inviteLink).not.toBeNull();
    expect(resBody.linkType).toBe("recovery");
    expect(resBody.ownerEmail).toBe(testOwnerEmail);

    // Parse the generated link
    const url = new URL(resBody.inviteLink);
    const tokenHash = url.searchParams.get("token_hash");
    const linkType = url.searchParams.get("type");

    expect(tokenHash).not.toBeNull();
    expect(tokenHash!.length).toBeGreaterThan(10);
    expect(linkType).toBe("recovery");

    // 3. Redeem token via verifyOtp and set a permanent password
    const newPassword = "P@ssword12345!";
    const redeemClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    const { data: verifyData, error: verifyError } = await redeemClient.auth.verifyOtp({
      token_hash: tokenHash!,
      type: "recovery",
    });

    expect(verifyError).toBeNull();
    expect(verifyData?.session).not.toBeNull();

    // Established session -> update password
    const { error: updateErr } = await redeemClient.auth.updateUser({
      password: newPassword,
    });
    expect(updateErr).toBeNull();

    // Verify sign in works with new password
    const testLoginClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data: loginData, error: loginErr } = await testLoginClient.auth.signInWithPassword({
      email: testOwnerEmail,
      password: newPassword,
    });
    expect(loginErr).toBeNull();
    expect(loginData.session).not.toBeNull();

    // 4. Test Already-Active account path: invoke resend_invite again
    // Now last_sign_in_at is populated
    const resActive = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        action: "resend_invite",
        restaurantId: testRestId,
      }),
    });

    expect(resActive.status).toBe(200);
    const activeBody = await resActive.json();
    expect(activeBody.success).toBe(true);
    // Already active account MUST return null inviteLink
    expect(activeBody.inviteLink).toBeNull();
    expect(activeBody.linkType).toBeNull();
    expect(activeBody.message).toMatch(/already active/i);

    // 5. Verify Audit Logs: platform_audit_logs must record actions without secrets
    const auditLogs = await serviceRole.query<{
      action: string;
      new_values: any;
      reason: string;
    }>(
      `SELECT action, new_values, reason FROM platform_audit_logs 
       WHERE target_id = $1 ORDER BY created_at ASC;`,
      [testRestId]
    );

    expect(auditLogs.length).toBeGreaterThanOrEqual(2);

    for (const log of auditLogs) {
      const logStr = JSON.stringify(log);
      // Ensure zero token or raw link leaked into database audit tables
      expect(logStr).not.toContain(tokenHash);
      expect(logStr).not.toContain("set-password?token_hash=");
    }

    // Clean up test data
    await adminSupabase.auth.admin.deleteUser(ownerUid);
    await serviceRole.adminQuery(`
      ALTER TABLE restaurant_staff DISABLE TRIGGER USER;
      DELETE FROM restaurants WHERE id = '${testRestId}';
      ALTER TABLE restaurant_staff ENABLE TRIGGER USER;
    `);
  });

  it("enforces rate limit: returns 429 when exceeding 5 requests in 5 minutes", async () => {
    const { data: { session } } = await superAdminClient.auth.getSession();
    const rateLimitRestId = creds.restaurant_a.id;

    let hitRateLimit = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "resend_invite",
          restaurantId: rateLimitRestId,
        }),
      });

      if (res.status === 429) {
        hitRateLimit = true;
        const body = await res.json();
        expect(body.error).toMatch(/Rate limit exceeded/i);
        break;
      }
    }

    expect(hitRateLimit).toBe(true);
  });
});
