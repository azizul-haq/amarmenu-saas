import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteStaffPayload {
  action?: "invite" | "create" | "update" | "toggle_active" | "reset_password" | "delete";
  staff_id?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  password?: string;
  role?: string;
  is_active?: boolean;
}

const ALLOWED_STAFF_ROLES = ["manager", "cashier", "kitchen", "waiter"];

function normalizeBDPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) {
    return `+${digits}`;
  }
  if (digits.startsWith("01") && digits.length === 11) {
    return `+88${digits}`;
  }
  if (digits.startsWith("1") && digits.length === 10) {
    return `+880${digits}`;
  }
  return phone.trim();
}

function isValidBDPhone(phone: string): boolean {
  return /^\+8801[3-9]\d{8}$/.test(phone);
}

function generateSecureTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  let pass = "";
  const randomBytes = new Uint8Array(9);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 9; i++) {
    pass += chars[randomBytes[i] % chars.length];
  }
  return pass;
}

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

    // 1. Validate Bearer token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Initialize Privileged Service Role Client (Edge server only)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const {
      data: { user: callerUser },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Resolve caller's active restaurant_staff record and permissions

    const { data: callerStaff, error: callerStaffError } = await supabaseAdmin
      .from("restaurant_staff")
      .select("id, restaurant_id, role, full_name, is_active")
      .eq("auth_user_id", callerUser.id)
      .eq("is_active", true)
      .maybeSingle();

    if (callerStaffError || !callerStaff) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Caller is not an active staff member" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only owner role possesses manage_staff permission
    if (callerStaff.role !== "owner") {
      return new Response(
        JSON.stringify({ error: "Forbidden: Only restaurant owners can manage staff" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant binding is derived strictly from caller's staff record (never from body)
    const targetRestaurantId = callerStaff.restaurant_id;

    const body: InviteStaffPayload = await req.json();
    const action = body.action || "invite";

    // 4. Rate Limiting Check (Max 20 staff management operations per 10 minutes, DB-backed keyed by caller user id)
    const { data: isAllowed, error: rlErr } = await supabaseAdmin.rpc(
      "check_and_increment_rate_limit",
      {
        p_bucket: "invite-staff",
        p_identifier: callerUser.id,
        p_max_attempts: 20,
        p_window_seconds: 600,
      }
    );

    if (rlErr) {
      console.warn("Rate limit check warning:", rlErr.message);
    } else if (isAllowed === false) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded. Maximum 20 staff actions per 10 minutes. Please try again later.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Reset Password
    // =========================================================================
    if (action === "reset_password") {
      if (!body.staff_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: staff_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: targetStaff, error: targetError } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id, restaurant_id, auth_user_id, role, full_name, is_active")
        .eq("id", body.staff_id)
        .eq("restaurant_id", targetRestaurantId)
        .maybeSingle();

      if (targetError || !targetStaff) {
        return new Response(
          JSON.stringify({ error: "Staff member not found in your restaurant" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (targetStaff.role === "owner") {
        return new Response(
          JSON.stringify({ error: "Cannot reset password for an owner account via this action" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tempPassword = generateSecureTempPassword();

      const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(
        targetStaff.auth_user_id,
        {
          password: tempPassword,
          app_metadata: {
            must_change_password: true,
            restaurant_id: targetRestaurantId,
          },
        }
      );

      if (resetError) {
        return new Response(
          JSON.stringify({ error: `Failed to reset password: ${resetError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Record audit log (NEVER logs or writes tempPassword)
      await supabaseAdmin.from("audit_logs").insert({
        restaurant_id: targetRestaurantId,
        actor_id: callerUser.id,
        actor_role: callerStaff.role,
        actor_name: callerStaff.full_name,
        action: "staff_password_reset",
        entity_type: "restaurant_staff",
        entity_id: targetStaff.id,
        new_values: {
          staff_id: targetStaff.id,
          role: targetStaff.role,
          full_name: targetStaff.full_name,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Temporary password generated successfully. Hand this to the employee.",
          tempPassword,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Toggle Active Status (Deactivate / Reactivate with Auth Ban)
    // =========================================================================
    if (action === "toggle_active") {
      if (!body.staff_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: staff_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: targetStaff, error: targetError } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id, restaurant_id, auth_user_id, role, full_name, is_active")
        .eq("id", body.staff_id)
        .eq("restaurant_id", targetRestaurantId)
        .maybeSingle();

      if (targetError || !targetStaff) {
        return new Response(
          JSON.stringify({ error: "Staff member not found in your restaurant" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Safety: Cannot deactivate own account
      if (targetStaff.auth_user_id === callerUser.id) {
        return new Response(
          JSON.stringify({ error: "Safety rule: You cannot change your own active status" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newActiveStatus = body.is_active !== undefined ? body.is_active : !targetStaff.is_active;

      // Safety: Cannot deactivate the last remaining owner
      if (targetStaff.role === "owner" && !newActiveStatus) {
        const { count: ownerCount } = await supabaseAdmin
          .from("restaurant_staff")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", targetRestaurantId)
          .eq("role", "owner")
          .eq("is_active", true);

        if ((ownerCount || 0) <= 1) {
          return new Response(
            JSON.stringify({ error: "Safety rule: A restaurant must always keep at least one active owner" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Update restaurant_staff
      const { error: updateErr } = await supabaseAdmin
        .from("restaurant_staff")
        .update({
          is_active: newActiveStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetStaff.id);

      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to update status: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If deactivated: ban the auth user (876000h = ~100 years). If reactivated: remove ban ('none').
      if (targetStaff.auth_user_id) {
        await supabaseAdmin.auth.admin.updateUserById(targetStaff.auth_user_id, {
          ban_duration: newActiveStatus ? "none" : "876000h",
        });
      }

      // Audit log
      await supabaseAdmin.from("audit_logs").insert({
        restaurant_id: targetRestaurantId,
        actor_id: callerUser.id,
        actor_role: callerStaff.role,
        actor_name: callerStaff.full_name,
        action: "staff_status_toggled",
        entity_type: "restaurant_staff",
        entity_id: targetStaff.id,
        new_values: {
          staff_id: targetStaff.id,
          full_name: targetStaff.full_name,
          is_active: newActiveStatus,
          banned: !newActiveStatus,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `${targetStaff.full_name} is now ${newActiveStatus ? "Active" : "Inactive"}.`,
          is_active: newActiveStatus,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Delete Staff (Permanent Removal from Staff & Auth)
    // =========================================================================
    if (action === "delete") {
      if (!body.staff_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: staff_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: targetStaff, error: targetError } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id, restaurant_id, auth_user_id, role, full_name, is_active")
        .eq("id", body.staff_id)
        .eq("restaurant_id", targetRestaurantId)
        .maybeSingle();

      if (targetError || !targetStaff) {
        return new Response(
          JSON.stringify({ error: "Staff member not found in your restaurant" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Safety: Cannot delete own account
      if (targetStaff.auth_user_id === callerUser.id) {
        return new Response(
          JSON.stringify({ error: "Safety rule: You cannot delete your own account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Safety: Cannot delete the last remaining owner
      if (targetStaff.role === "owner") {
        const { count: ownerCount } = await supabaseAdmin
          .from("restaurant_staff")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", targetRestaurantId)
          .eq("role", "owner");

        if ((ownerCount || 0) <= 1) {
          return new Response(
            JSON.stringify({ error: "Safety rule: A restaurant must always keep at least one owner" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // 1. Delete from restaurant_staff
      const { error: delStaffErr } = await supabaseAdmin
        .from("restaurant_staff")
        .delete()
        .eq("id", targetStaff.id);

      if (delStaffErr) {
        return new Response(
          JSON.stringify({ error: `Failed to remove staff record: ${delStaffErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. Permanently delete auth user so they can NEVER log in again
      if (targetStaff.auth_user_id) {
        const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(targetStaff.auth_user_id);
        if (authDelErr) {
          console.warn("Auth user deletion warning:", authDelErr.message);
        }
      }

      // 3. Audit log
      await supabaseAdmin.from("audit_logs").insert({
        restaurant_id: targetRestaurantId,
        actor_id: callerUser.id,
        actor_role: callerStaff.role,
        actor_name: callerStaff.full_name,
        action: "staff_deleted",
        entity_type: "restaurant_staff",
        entity_id: targetStaff.id,
        new_values: {
          staff_id: targetStaff.id,
          full_name: targetStaff.full_name,
          role: targetStaff.role,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `${targetStaff.full_name} was permanently removed.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Update Staff
    // =========================================================================
    if (action === "update") {
      if (!body.staff_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: staff_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: targetStaff, error: targetError } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id, restaurant_id, auth_user_id, role, full_name, phone, is_active")
        .eq("id", body.staff_id)
        .eq("restaurant_id", targetRestaurantId)
        .maybeSingle();

      if (targetError || !targetStaff) {
        return new Response(
          JSON.stringify({ error: "Staff member not found in your restaurant" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enforce: caller cannot change their own role
      if (body.role && targetStaff.auth_user_id === callerUser.id && body.role !== targetStaff.role) {
        return new Response(
          JSON.stringify({ error: "Safety rule: You cannot change your own role" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enforce: role cannot be assigned to 'owner'
      if (body.role && body.role === "owner" && targetStaff.role !== "owner") {
        return new Response(
          JSON.stringify({ error: "Cannot assign 'owner' role via staff management" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enforce: cannot demote the last owner
      if (targetStaff.role === "owner" && body.role && body.role !== "owner") {
        const { count: ownerCount } = await supabaseAdmin
          .from("restaurant_staff")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", targetRestaurantId)
          .eq("role", "owner")
          .eq("is_active", true);

        if ((ownerCount || 0) <= 1) {
          return new Response(
            JSON.stringify({ error: "Safety rule: A restaurant must always keep at least one active owner" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      if (body.role && !ALLOWED_STAFF_ROLES.includes(body.role) && body.role !== targetStaff.role) {
        return new Response(
          JSON.stringify({
            error: `Invalid role: ${body.role}. Allowed roles: ${ALLOWED_STAFF_ROLES.join(", ")}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateFields: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (body.full_name && body.full_name.trim()) {
        updateFields.full_name = body.full_name.trim();
      }

      if (body.role) {
        updateFields.role = body.role;
      }

      if (body.phone) {
        const cleanPhone = normalizeBDPhone(body.phone);
        if (!isValidBDPhone(cleanPhone)) {
          return new Response(
            JSON.stringify({ error: "Invalid Bangladeshi phone number (must be 11 digits starting with 01)" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check duplicate phone across other active staff
        const { data: existingStaff } = await supabaseAdmin
          .from("restaurant_staff")
          .select("id")
          .eq("phone", cleanPhone)
          .eq("is_active", true)
          .neq("id", targetStaff.id)
          .maybeSingle();

        if (existingStaff) {
          return new Response(
            JSON.stringify({ error: "This phone number is already registered to another active staff member" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        updateFields.phone = cleanPhone;
      }

      const { data: updatedStaff, error: updateErr } = await supabaseAdmin
        .from("restaurant_staff")
        .update(updateFields)
        .eq("id", targetStaff.id)
        .select()
        .single();

      if (updateErr) {
        return new Response(
          JSON.stringify({ error: `Update failed: ${updateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Audit log
      await supabaseAdmin.from("audit_logs").insert({
        restaurant_id: targetRestaurantId,
        actor_id: callerUser.id,
        actor_role: callerStaff.role,
        actor_name: callerStaff.full_name,
        action: "staff_updated",
        entity_type: "restaurant_staff",
        entity_id: targetStaff.id,
        new_values: updateFields,
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `Staff member ${updatedStaff.full_name} updated successfully`,
          staff: updatedStaff,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Create / Invite Staff
    // =========================================================================
    const { full_name, phone, role, email, password } = body;

    if (!full_name || !full_name.trim()) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: full_name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!role || !ALLOWED_STAFF_ROLES.includes(role)) {
      return new Response(
        JSON.stringify({
          error: `Invalid role: ${role}. Cannot invite owner. Allowed roles are: ${ALLOWED_STAFF_ROLES.join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const staffEmail = email && email.trim() ? email.trim().toLowerCase() : null;
    let cleanPhone: string | null = null;
    if (phone && phone.trim()) {
      cleanPhone = normalizeBDPhone(phone.trim());
      if (!isValidBDPhone(cleanPhone)) {
        return new Response(
          JSON.stringify({ error: "Invalid Bangladeshi phone number (must be 11 digits starting with 01)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!staffEmail && !cleanPhone) {
      return new Response(
        JSON.stringify({ error: "Either Email or Phone number is required for staff account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check duplicate phone across active staff
    if (cleanPhone) {
      const { data: existingStaffPhone } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id")
        .eq("phone", cleanPhone)
        .eq("is_active", true)
        .maybeSingle();

      if (existingStaffPhone) {
        return new Response(
          JSON.stringify({
            error: "This phone number is already registered to an active staff member.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check duplicate email across active staff
    if (staffEmail) {
      const { data: existingStaffEmail } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id")
        .eq("email", staffEmail)
        .eq("is_active", true)
        .maybeSingle();

      if (existingStaffEmail) {
        return new Response(
          JSON.stringify({
            error: "This email address is already registered to an active staff member.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Plan Staff Limit Check
    const { data: restaurantRow } = await supabaseAdmin
      .from("restaurants")
      .select("subscription_plan")
      .eq("id", targetRestaurantId)
      .single();

    const planCode = restaurantRow?.subscription_plan || "free_trial";
    const { data: planRow } = await supabaseAdmin
      .from("plans")
      .select("max_staff")
      .ilike("name", planCode)
      .maybeSingle();

    const maxStaffLimit = planRow?.max_staff || 5;

    const { count: activeStaffCount } = await supabaseAdmin
      .from("restaurant_staff")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", targetRestaurantId)
      .eq("is_active", true);

    if ((activeStaffCount || 0) >= maxStaffLimit) {
      return new Response(
        JSON.stringify({
          error: `Staff limit (${maxStaffLimit}) reached for plan '${planCode}'. Please upgrade your subscription to add more staff.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine password: owner-assigned password or generated temp password
    const hasCustomPassword = !!(password && password.trim().length >= 6);
    const userPassword = hasCustomPassword ? password!.trim() : generateSecureTempPassword();
    const finalEmail = staffEmail || `${cleanPhone!.replace(/\D/g, "")}@staff.amarmenu.internal`;

    // Create auth user via admin API (so owner session in browser is untouched!)
    const { data: authCreated, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
      email: finalEmail,
      phone: cleanPhone || undefined,
      password: userPassword,
      email_confirm: true,
      phone_confirm: !!cleanPhone,
      app_metadata: {
        must_change_password: !hasCustomPassword,
        restaurant_id: targetRestaurantId,
      },
    });

    if (authCreateError || !authCreated.user) {
      return new Response(
        JSON.stringify({ error: `Auth creation failed: ${authCreateError?.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newAuthUserId = authCreated.user.id;

    // Insert into restaurant_staff
    const { data: newStaff, error: insertStaffError } = await supabaseAdmin
      .from("restaurant_staff")
      .insert({
        restaurant_id: targetRestaurantId,
        auth_user_id: newAuthUserId,
        full_name: full_name.trim(),
        phone: cleanPhone,
        email: staffEmail,
        role,
        is_active: true,
      })
      .select()
      .single();

    // Roll back auth user if restaurant_staff insert fails
    if (insertStaffError) {
      await supabaseAdmin.auth.admin.deleteUser(newAuthUserId);
      return new Response(
        JSON.stringify({ error: `Staff registration failed: ${insertStaffError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Write audit log (NEVER logs or writes password)
    await supabaseAdmin.from("audit_logs").insert({
      restaurant_id: targetRestaurantId,
      actor_id: callerUser.id,
      actor_role: callerStaff.role,
      actor_name: callerStaff.full_name,
      action: hasCustomPassword ? "staff_created" : "staff_invited",
      entity_type: "restaurant_staff",
      entity_id: newStaff.id,
      new_values: {
        staff_id: newStaff.id,
        full_name: newStaff.full_name,
        email: staffEmail,
        phone: cleanPhone,
        role,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: hasCustomPassword
          ? `Staff member ${newStaff.full_name} created successfully.`
          : "Staff member created successfully. Provide the temporary password to the employee.",
        staff: newStaff,
        tempPassword: hasCustomPassword ? undefined : userPassword,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
