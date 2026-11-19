import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Common password blocklist (case-insensitive check)
const COMMON_PASSWORDS = new Set([
  "password123",
  "password1234",
  "password12345",
  "1234567890",
  "12345678901",
  "qwertyuiop",
  "admin12345",
  "letmein123",
  "welcome123",
  "changeme123",
  "restaurant123",
  "amarmenu123",
  "staff12345",
  "bangladesh123",
  "secret12345",
  "iloveyou123",
  "supersecret123",
  "testing12345",
  "abc1234567",
]);

serve(async (req: Request) => {
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Admin client for privileged operations and user identity verification
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user: callerUser },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);

    if (authErr || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce DB-backed rate limiting keyed by caller user ID
    const { data: isAllowed, error: rlErr } = await supabaseAdmin.rpc(
      "check_and_increment_rate_limit",
      {
        p_bucket: "change-own-password",
        p_identifier: callerUser.id,
        p_max_attempts: 5,
        p_window_seconds: 900,
      }
    );

    if (rlErr) {
      console.warn("Rate limit check warning:", rlErr.message);
    } else if (isAllowed === false) {
      return new Response(
        JSON.stringify({ error: "Too many password change attempts. Please try again in 15 minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch fresh user record and app_metadata from auth admin
    const { data: adminUserData, error: adminUserErr } = await supabaseAdmin.auth.admin.getUserById(callerUser.id);
    if (adminUserErr || !adminUserData?.user) {
      return new Response(
        JSON.stringify({ error: "Failed to resolve fresh user profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const freshUser = adminUserData.user;
    const isFirstLogin = freshUser.app_metadata?.must_change_password === true;

    // 4. Parse request payload
    let body: {
      new_password?: string;
      current_password?: string;
      temporary_password?: string;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { new_password, temporary_password } = body;
    const current_password = body.current_password || (body as any).old_password;

    if (!new_password || typeof new_password !== "string") {
      return new Response(
        JSON.stringify({ error: "New password is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. If must_change_password is NOT set, require current_password and verify it
    if (!isFirstLogin) {
      if (!current_password) {
        return new Response(
          JSON.stringify({ error: "Current password is required to update your password" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify current password by signing in
      const verificationClient = createClient(supabaseUrl, supabaseAnonKey || "", {
        auth: { persistSession: false },
      });
      const { data: verifyData, error: verifyErr } = await verificationClient.auth.signInWithPassword({
        email: freshUser.email!,
        password: current_password,
      });

      if (verifyData?.session) {
        try {
          await verificationClient.auth.signOut();
        } catch (_) {}
      }

      if (verifyErr) {
        return new Response(
          JSON.stringify({ error: "Current password is incorrect" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (new_password === current_password) {
        return new Response(
          JSON.stringify({ error: "New password cannot be the same as your current password" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // First login / temporary password reset flow
      if (temporary_password && new_password === temporary_password) {
        return new Response(
          JSON.stringify({ error: "New password cannot be the same as the temporary password" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 6. Fail-closed check: ensure new password does not already sign in
    const checkClient = createClient(supabaseUrl, supabaseAnonKey || "", {
      auth: { persistSession: false },
    });
    const { data: checkData, error: checkErr } = await checkClient.auth.signInWithPassword({
      email: freshUser.email!,
      password: new_password,
    });

    if (!checkErr) {
      if (checkData?.session) {
        try {
          await checkClient.auth.signOut();
        } catch (_) {}
      }
      return new Response(
        JSON.stringify({ error: "New password cannot be the same as your existing/temporary password" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fail closed: continue only on an explicit invalid_credentials error
    const errMsg = (checkErr.message || "").toLowerCase();
    const isInvalidCreds =
      errMsg.includes("invalid login credentials") ||
      (checkErr as any).code === "invalid_credentials" ||
      checkErr.status === 400;

    if (!isInvalidCreds) {
      return new Response(
        JSON.stringify({ error: `Authentication validation service check failed: ${checkErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Enforce password strength: length >= 10 and common password blocklist
    if (new_password.length < 10) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 10 characters long" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (COMMON_PASSWORDS.has(new_password.toLowerCase().trim())) {
      return new Response(
        JSON.stringify({ error: "The chosen password is too common or easily guessable. Please choose a stronger password." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Update password and clear must_change_password in one atomic admin call
    const currentAppMeta = freshUser.app_metadata || {};
    const updatedAppMeta = {
      ...currentAppMeta,
      must_change_password: false,
    };

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      freshUser.id,
      {
        password: new_password,
        app_metadata: updatedAppMeta,
      }
    );

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: `Failed to update password: ${updateErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Audit log (strictly without the password)
    try {
      const { data: staffData } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id, restaurant_id, full_name, role")
        .eq("auth_user_id", freshUser.id)
        .maybeSingle();

      if (staffData?.restaurant_id) {
        await supabaseAdmin.from("audit_logs").insert({
          restaurant_id: staffData.restaurant_id,
          actor_id: freshUser.id,
          actor_name: staffData.full_name || freshUser.email,
          actor_role: staffData.role || "staff",
          action: "password_change",
          entity_type: "user",
          entity_id: freshUser.id,
          reason: isFirstLogin
            ? "Mandatory first login password change"
            : "Staff voluntary password change",
          new_values: {
            must_change_password_cleared: true,
            auth_user_id: freshUser.id,
          },
        });
      }
    } catch (_auditErr) {
      // Do not fail password change if audit log insert encounters non-fatal error
      console.warn("Audit log creation notice:", _auditErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Password updated successfully. Session should now be refreshed.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
