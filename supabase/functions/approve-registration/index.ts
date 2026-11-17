import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestPayload {
  requestId: string;
  subscriptionPlan?: string;
  internalNotes?: string;
  appUrl?: string;
}

serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables on server");
    }

    // 2. Validate Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Verify user calling this function is an authenticated Super Admin
    const userClient = createClient(supabaseUrl, supabaseAnonKey || "", {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check platform_admins table
    const { data: adminRecord, error: adminError } = await userClient
      .from("platform_admins")
      .select("id, role, is_active")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminError || !adminRecord) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Super Admin privileges required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Parse request payload
    const body: RequestPayload = await req.json();
    const { requestId, subscriptionPlan = "free_trial", internalNotes, appUrl } = body;

    if (!requestId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: requestId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Initialize Privileged Service Role Client (Edge server only)
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // 6. Fetch Registration Request
    const { data: request, error: requestError } = await adminClient
      .from("registration_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (requestError || !request) {
      return new Response(
        JSON.stringify({ error: "Registration request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (request.status === "approved") {
      return new Response(
        JSON.stringify({ error: "Registration request has already been approved" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Generate unique slug from restaurant name
    const baseSlug = request.restaurant_name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    let slug = baseSlug;
    const { data: existingRestaurant } = await adminClient
      .from("restaurants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingRestaurant) {
      slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // 8. Create the Restaurant
    const { data: newRestaurant, error: createRestError } = await adminClient
      .from("restaurants")
      .insert({
        name: request.restaurant_name,
        slug: slug,
        phone: request.phone,
        email: request.email,
        city: request.city,
        address: request.address || null,
        subscription_plan: subscriptionPlan,
        is_active: true,
        currency: "৳",
        default_vat_rate: 0.05,
      })
      .select()
      .single();

    if (createRestError || !newRestaurant) {
      throw new Error(`Failed to create restaurant: ${createRestError?.message}`);
    }

    // 9. Provision Subscription
    const { data: planRecord } = await adminClient
      .from("plans")
      .select("id")
      .eq("slug", subscriptionPlan)
      .maybeSingle();

    await adminClient.from("subscriptions").insert({
      restaurant_id: newRestaurant.id,
      plan_id: planRecord?.id || null,
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // 10. Generate Set-Password / Invite Link via GoTrue Admin API
    const targetAppUrl = appUrl || "http://localhost:5173";
    const redirectUrl = `${targetAppUrl}/set-password`;

    let actionLink = "";
    let authUserId: string | null = null;

    // Check if user already exists in auth.users
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === request.email.toLowerCase()
    );

    if (existingUser) {
      authUserId = existingUser.id;
      // Generate password recovery / set password link
      const { data: recoveryData, error: recoveryError } =
        await adminClient.auth.admin.generateLink({
          type: "recovery",
          email: request.email,
          options: { redirectTo: redirectUrl },
        });

      if (!recoveryError && recoveryData?.properties?.action_link) {
        actionLink = recoveryData.properties.action_link;
      }
    } else {
      // Generate invite link (creates user in auth.users with no password yet)
      const { data: inviteData, error: inviteError } =
        await adminClient.auth.admin.generateLink({
          type: "invite",
          email: request.email,
          options: {
            redirectTo: redirectUrl,
            data: {
              full_name: request.owner_name,
              restaurant_id: newRestaurant.id,
            },
          },
        });

      if (inviteError) {
        throw new Error(`Failed to generate invite link: ${inviteError.message}`);
      }

      authUserId = inviteData?.user?.id || null;
      actionLink = inviteData?.properties?.action_link || "";
    }

    // 11. Create or update restaurant_staff record linking owner to restaurant
    await adminClient.from("restaurant_staff").insert({
      auth_user_id: authUserId,
      restaurant_id: newRestaurant.id,
      full_name: request.owner_name,
      phone: request.phone,
      email: request.email,
      role: "owner",
      is_active: true,
    });

    // 12. Update Registration Request status to approved
    await adminClient
      .from("registration_requests")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        internal_notes: internalNotes || null,
      })
      .eq("id", requestId);

    return new Response(
      JSON.stringify({
        success: true,
        restaurant: {
          id: newRestaurant.id,
          name: newRestaurant.name,
          slug: newRestaurant.slug,
        },
        inviteLink: actionLink,
        email: request.email,
        ownerName: request.owner_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error("Error in approve-registration:", err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
