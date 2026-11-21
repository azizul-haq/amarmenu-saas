import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestPayload {
  action?: string;
  requestId?: string;
  restaurantId?: string;
  subscriptionPlan?: string;
  internalNotes?: string;
}

interface SendEmailParams {
  to: string;
  ownerName?: string;
  restaurantName?: string;
  actionLink: string;
  linkType: "invite" | "recovery";
}

async function sendOnboardingEmail({
  to,
  ownerName,
  restaurantName,
  actionLink,
  linkType,
}: SendEmailParams): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.log(
      `[Email Dispatch] RESEND_API_KEY secret not found in environment. Email not dispatched via Resend. Generated Link: ${actionLink}`
    );
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") || "AmarMenu <onboarding@resend.dev>";
  const isInvite = linkType === "invite";
  const subject = isInvite
    ? `Welcome to AmarMenu! Set up your restaurant: ${restaurantName || ""}`
    : `Set your password for AmarMenu: ${restaurantName || ""}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background: linear-gradient(135deg, #ea580c 0%, #f97316 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
        .content { padding: 32px 24px; line-height: 1.6; }
        .button { display: inline-block; background-color: #ea580c; color: #ffffff !important; font-weight: 700; font-size: 14px; text-decoration: none; padding: 14px 28px; border-radius: 10px; margin: 24px 0; text-align: center; }
        .footer { background: #f1f5f9; padding: 16px 24px; text-align: center; font-size: 12px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin:0; font-size: 24px; font-weight: 800;">AmarMenu</h1>
          <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.9;">Smart Restaurant POS & QR Ordering</p>
        </div>
        <div class="content">
          <p>Hello <strong>${ownerName || "Restaurant Partner"}</strong>,</p>
          <p>Congratulations! Your restaurant <strong>${restaurantName || "Partner Restaurant"}</strong> is ready on the AmarMenu platform.</p>
          <p>Please click the button below to set your password and access your restaurant management portal:</p>
          <div style="text-align: center;">
            <a href="${actionLink}" class="button" target="_blank">Set Your Password & Log In</a>
          </div>
          <p style="font-size: 13px; color: #64748b;">If the button above does not work, copy and paste this link into your browser:<br/><a href="${actionLink}" style="color: #ea580c; word-break: break-all;">${actionLink}</a></p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">For your security, this link is valid for 24 hours.</p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} AmarMenu Cloud Technologies. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderEmail,
        to: [to],
        subject: subject,
        html: html,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[Email Dispatch Success] Sent onboarding email to ${to}, ID: ${data?.id}`);
      return { sent: true, messageId: data?.id };
    } else {
      const errorText = await res.text();
      console.error(`[Email Dispatch Failed] Resend API responded with: ${errorText}`);
      return { sent: false, error: errorText };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Email Dispatch Exception] ${errorMsg}`);
    return { sent: false, error: errorMsg };
  }
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
    // Base URL strictly comes from server environment variable, never from client body or headers
    const targetAppUrl = Deno.env.get("APP_URL") || "http://localhost:5173";

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

    // 3. Initialize Privileged Service Role Client (Edge server only)
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check platform_admins table strictly for active super_admin
    const { data: adminRecord, error: adminError } = await adminClient
      .from("platform_admins")
      .select("id, role, is_active")
      .eq("auth_user_id", user.id)
      .eq("role", "super_admin")
      .eq("is_active", true)
      .maybeSingle();

    if (adminError || !adminRecord) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Super Admin privileges required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestPayload = await req.json();

    // =========================================================================
    // ACTION: RESEND INVITE LINK (Items 7, 8, 9)
    // =========================================================================
    if (body.action === "resend_invite") {
      const restaurantId = body.restaurantId;
      if (!restaurantId || typeof restaurantId !== "string" || !/^[0-9a-f-]{36}$/i.test(restaurantId)) {
        return new Response(
          JSON.stringify({ error: "Missing or invalid required parameter: restaurantId (UUID required, free-form email not permitted)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Atomic DB Rate Limiting: max 5 resend requests per 5 minutes per restaurant
      const { data: allowed } = await adminClient.rpc("check_and_increment_rate_limit", {
        p_bucket: `resend_invite:${restaurantId}`,
        p_identifier: user.id,
        p_max_attempts: 5,
        p_window_seconds: 300,
      });

      if (allowed === false) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Maximum 5 invite resends per 5 minutes allowed." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Resolve owner server-side (strictly no free-form email allowed)
      const { data: ownerStaff, error: staffError } = await adminClient
        .from("restaurant_staff")
        .select("id, auth_user_id, email, full_name, restaurant_id")
        .eq("restaurant_id", restaurantId)
        .eq("role", "owner")
        .eq("is_active", true)
        .maybeSingle();

      if (staffError || !ownerStaff || !ownerStaff.email) {
        return new Response(
          JSON.stringify({ error: "Active restaurant owner not found for this restaurant" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check whether user has ever signed in
      let userLastSignIn: string | null = null;
      if (ownerStaff.auth_user_id) {
        const { data: authUserData } = await adminClient.auth.admin.getUserById(ownerStaff.auth_user_id);
        userLastSignIn = authUserData?.user?.last_sign_in_at || null;
      }

      // If already active: do NOT return a link; trigger normal GoTrue password reset email instead
      if (userLastSignIn !== null) {
        await adminClient.auth.resetPasswordForEmail(ownerStaff.email, {
          redirectTo: `${targetAppUrl}/set-password`,
        });

        // Audit log WITHOUT token or URL
        await adminClient.from("platform_audit_logs").insert({
          actor_id: user.id,
          actor_email: user.email,
          action: "resend_invite_password_reset_dispatched",
          target_type: "restaurant",
          target_id: restaurantId,
          old_values: null,
          new_values: {
            owner_email: ownerStaff.email,
            status: "already_active",
            path_run: "reset_email",
          },
          reason: "Account already active; dispatched standard GoTrue password reset email",
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Account is already active. A standard password reset email has been dispatched directly to the owner.",
            inviteLink: null,
            linkType: null,
            ownerEmail: ownerStaff.email,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Account has never signed in: generate recovery link for existing owner user
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: ownerStaff.email,
        options: {
          redirectTo: `${targetAppUrl}/set-password`,
        },
      });

      if (linkError || !linkData) {
        throw new Error(`Failed to generate activation recovery link: ${linkError?.message}`);
      }

      const tokenHash = linkData.properties?.hashed_token || "";
      const freshLink = `${targetAppUrl}/set-password?token_hash=${tokenHash}&type=recovery`;

      // Dispatch real email via Resend if configured, otherwise dispatch via Supabase Auth SMTP (e.g. Gmail SMTP)
      const emailResult = await sendOnboardingEmail({
        to: ownerStaff.email,
        ownerName: ownerStaff.full_name,
        restaurantName: "Your Restaurant",
        actionLink: freshLink,
        linkType: "recovery",
      });

      if (!emailResult.sent) {
        try {
          await adminClient.auth.resetPasswordForEmail(ownerStaff.email, {
            redirectTo: `${targetAppUrl}/set-password`,
          });
          console.log(`[SMTP Delivery Success] Dispatched recovery email via Supabase SMTP to ${ownerStaff.email}`);
        } catch (smtpErr) {
          console.warn(`[SMTP Delivery Warning] ${smtpErr}`);
        }
      }

      // Audit log WITHOUT token or URL
      await adminClient.from("platform_audit_logs").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "resend_invite_recovery_link_generated",
        target_type: "restaurant",
        target_id: restaurantId,
        old_values: null,
        new_values: {
          owner_email: ownerStaff.email,
          status: "pending_activation",
          path_run: "recovery",
        },
        reason: "Super Admin regenerated activation recovery link for never-signed-in owner",
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Activation link generated successfully.",
          inviteLink: freshLink,
          linkType: "recovery",
          ownerEmail: ownerStaff.email,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // DEFAULT ACTION: APPROVE REGISTRATION REQUEST
    // =========================================================================
    const { requestId, subscriptionPlan = "free_trial", internalNotes } = body;

    if (!requestId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: requestId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch Registration Request
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

    // Generate unique slug
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

    // Create the Restaurant
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

    // Provision Subscription
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

    // Generate Set-Password / Invite Link via GoTrue Admin API
    const redirectUrl = `${targetAppUrl}/set-password`;
    let actionLink = "";
    let authUserId: string | null = null;
    let effectiveLinkType: "invite" | "recovery" = "invite";

    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === request.email.toLowerCase()
    );

    if (existingUser) {
      authUserId = existingUser.id;
      const { data: recoveryData, error: recoveryError } =
        await adminClient.auth.admin.generateLink({
          type: "recovery",
          email: request.email,
          options: { redirectTo: redirectUrl },
        });

      if (!recoveryError && recoveryData?.properties?.hashed_token) {
        effectiveLinkType = "recovery";
        actionLink = `${targetAppUrl}/set-password?token_hash=${recoveryData.properties.hashed_token}&type=recovery`;
      }
    } else {
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
      const tokenHash = inviteData?.properties?.hashed_token || "";
      effectiveLinkType = "invite";
      actionLink = `${targetAppUrl}/set-password?token_hash=${tokenHash}&type=invite`;
    }

    // Link owner to restaurant in restaurant_staff
    await adminClient.from("restaurant_staff").insert({
      auth_user_id: authUserId,
      restaurant_id: newRestaurant.id,
      full_name: request.owner_name,
      phone: request.phone,
      email: request.email,
      role: "owner",
      is_active: true,
    });

    // Dispatch real onboarding email with set-password link via Resend if configured,
    // otherwise dispatch via Supabase Auth SMTP (e.g. Gmail SMTP configured in Supabase Dashboard)
    const emailResult = await sendOnboardingEmail({
      to: request.email,
      ownerName: request.owner_name,
      restaurantName: request.restaurant_name,
      actionLink: actionLink,
      linkType: effectiveLinkType,
    });

    if (!emailResult.sent) {
      try {
        await adminClient.auth.resetPasswordForEmail(request.email, {
          redirectTo: redirectUrl,
        });
        console.log(`[SMTP Delivery Success] Dispatched onboarding email via Supabase SMTP to ${request.email}`);
      } catch (smtpErr) {
        console.warn(`[SMTP Delivery Warning] ${smtpErr}`);
      }
    }

    // Update Registration Request status to approved
    await adminClient
      .from("registration_requests")
      .update({
        status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    // Audit log in platform_audit_logs (no tokens/links)
    await adminClient.from("platform_audit_logs").insert({
      actor_id: user.id,
      actor_email: user.email || "superadmin@amarmenu.com",
      action: "approve_registration_edge_function",
      target_type: "restaurant",
      target_id: newRestaurant.id,
      old_values: { registration_request_id: requestId, status: "pending" },
      new_values: {
        restaurant_id: newRestaurant.id,
        status: "approved",
        plan: subscriptionPlan,
        email: request.email,
        link_type: effectiveLinkType,
      },
      reason: internalNotes || "Approved via Edge Function",
    });

    return new Response(
      JSON.stringify({
        success: true,
        restaurantId: newRestaurant.id,
        restaurantSlug: newRestaurant.slug,
        ownerEmail: request.email,
        inviteLink: actionLink,
        linkType: effectiveLinkType,
        message: "Registration approved successfully and onboarding link generated",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const error = err as Error;
    return new Response(
      JSON.stringify({ error: error.message || "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
