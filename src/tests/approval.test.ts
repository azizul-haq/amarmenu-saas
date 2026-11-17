import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/config";

describe("Super Admin Registration Approval & Onboarding", () => {
  let anonClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let sampleRequestId: string;

  beforeAll(async () => {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    adminClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Sign in as Super Admin
    const authAdmin = await adminClient.auth.signInWithPassword({
      email: "admin@foodorder.com",
      password: "admin123",
    });
    if (authAdmin.error) throw new Error(`Admin Auth failed: ${authAdmin.error.message}`);

    // Create a fresh test registration request using admin client
    const testReqEmail = `testrest_${Date.now()}@amarmenu.com`;
    const { data: newReq, error: reqError } = await adminClient
      .from("registration_requests")
      .insert({
        restaurant_name: "Chittagong Biryani House",
        owner_name: "Rafiqul Islam",
        phone: "+8801811223344",
        email: testReqEmail,
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

    // Verify restaurant is created and active
    const { data: restaurant } = await adminClient
      .from("restaurants")
      .select("id, name, subscription_plan, is_active")
      .eq("id", rpcData.restaurant_id)
      .single();

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
  });
});
