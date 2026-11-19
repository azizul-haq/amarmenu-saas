import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";
import { getServiceRoleClient } from "./serviceRoleClient";
import { getTestCredentials } from "./testCredentials";

describe("Super Admin Registration Approval & Onboarding", () => {
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let sampleRequestId: string;
  let sampleEmail: string;
  const serviceDbClient = getServiceRoleClient();

  beforeAll(async () => {
    const creds = getTestCredentials();
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Sign in as Super Admin
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    });
    if (authAdmin.error) throw new Error(`Admin Auth failed: ${authAdmin.error.message}`);

    // Create a fresh test registration request using admin client
    sampleEmail = `testrest_${Date.now()}@amarmenu.com`;
    const { data: newReq, error: reqError } = await adminClient
      .from("registration_requests")
      .insert({
        restaurant_name: "Chittagong Biryani House",
        owner_name: "Rafiqul Islam",
        phone: "+8801811223344",
        email: sampleEmail,
        city: "Chittagong",
        address: "GEC Circle, Chittagong",
        restaurant_type: "fine_dining",
        status: "pending",
      })
      .select()
      .single();

    if (reqError || !newReq) {
      throw new Error(`Failed to create sample registration: ${reqError?.message}`);
    }
    sampleRequestId = newReq.id;
  });

  it("prevents unauthenticated callers from executing approval procedure", async () => {
    const { data, error } = await anonClient.rpc("approve_registration_request", {
      p_request_id: sampleRequestId,
      p_subscription_plan: "starter",
    });

    expect(error).not.toBeNull();
    expect(data).toBeFalsy();
  });

  it("successfully approves registration without generating temporary passwords", async () => {
    // Call approval procedure as Super Admin
    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      "approve_registration_request",
      {
        p_request_id: sampleRequestId,
        p_subscription_plan: "starter",
        p_internal_notes: "Approved after document verification",
      }
    );

    expect(rpcError).toBeNull();
    expect(rpcData).toBeDefined();
    expect(rpcData.success).toBe(true);
    expect(rpcData.restaurant_id).toBeDefined();
    expect(rpcData.slug).toContain("chittagong-biryani-house");

    // Verify no temporary password field is exposed
    expect(rpcData.password).toBeUndefined();
    expect(rpcData.temp_password).toBeUndefined();

    // Verify registration status updated to 'approved'
    const { data: updatedReq } = await adminClient
      .from("registration_requests")
      .select("status, internal_notes, reviewed_at")
      .eq("id", sampleRequestId)
      .single();

    expect(updatedReq?.status).toBe("approved");
    expect(updatedReq?.internal_notes).toBe("Approved after document verification");
    expect(updatedReq?.reviewed_at).not.toBeNull();

    // Verify restaurant is created and active via admin_list_restaurants RPC
    const { data: allRest } = await adminClient.rpc("admin_list_restaurants");
    const restaurant = (allRest || []).find((r: any) => r.id === rpcData.restaurant_id);

    expect(restaurant?.name).toBe("Chittagong Biryani House");
    expect(restaurant?.is_active).toBe(true);
    expect(restaurant?.subscription_plan).toBe("starter");

    // Verify subscription record is provisioned
    const { data: subscription } = await adminClient
      .from("subscriptions")
      .select("status, restaurant_id")
      .eq("restaurant_id", rpcData.restaurant_id)
      .single();

    expect(subscription?.status).toBe("active");

    // Verify restaurant staff owner record is provisioned
    const { data: staff } = await adminClient
      .from("restaurant_staff")
      .select("full_name, role, is_active")
      .eq("restaurant_id", rpcData.restaurant_id)
      .single();

    expect(staff?.role).toBe("owner");
    expect(staff?.full_name).toBe("Rafiqul Islam");
    expect(staff?.is_active).toBe(true);

    // 7. Verify set_initial_owner_password allows newly approved owner to set password and log in
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Rejection for non-existent email
    const { error: invalidEmailErr } = await anonClient.rpc("set_initial_owner_password", {
      p_email: "nonexistent_owner_email@example.com",
      p_password: "NewPassword123!",
    });
    expect(invalidEmailErr).not.toBeNull();

    // Success for approved owner
    const newOwnerPassword = "RafiqSecurePass2026!";
    const { data: setPassResult, error: setPassErr } = await anonClient.rpc(
      "set_initial_owner_password",
      {
        p_email: sampleEmail,
        p_password: newOwnerPassword,
      }
    );
    expect(setPassErr).toBeNull();
    expect(setPassResult?.success).toBe(true);
    expect(setPassResult?.user_id).toBeDefined();

    // Verify owner can now sign in with their new password
    const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signInRes = await ownerClient.auth.signInWithPassword({
      email: sampleEmail,
      password: newOwnerPassword,
    });
    expect(signInRes.error).toBeNull();
    expect(signInRes.data.user?.email_confirmed_at).not.toBeNull();

    // Verify owner has access to their restaurant
    const { data: myRest, error: myRestErr } = await ownerClient.rpc("get_my_restaurant");
    expect(myRestErr).toBeNull();
    expect(myRest?.id).toBe(rpcData.restaurant_id);
    expect(myRest?.name).toBe("Chittagong Biryani House");

    // Clean up created test auth user (sets auth_user_id to null on staff)
    await serviceDbClient.adminQuery("DELETE FROM auth.identities WHERE user_id = $1", [
      setPassResult.user_id,
    ]);
    await serviceDbClient.adminQuery("DELETE FROM auth.users WHERE id = $1", [
      setPassResult.user_id,
    ]);
  });
});
