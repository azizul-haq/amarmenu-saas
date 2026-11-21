import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteStaffPayload {
  action?: "invite" | "create" | "update" | "toggle_active" | "reset_password" | "delete";
  restaurant_id?: string;
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
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase server configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Validate Bearer token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Initialize Privileged Service Role Client
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
        JSON.stringify({ error: "Invalid or expired session. Please log in again." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Resolve caller permissions: Super Admin or Restaurant Owner
    const { data: platformAdmin } = await supabaseAdmin
      .from("platform_admins")
      .select("id, role, full_name, email")
      .or(`auth_user_id.eq.${callerUser.id},email.eq.${callerUser.email}`)
      .eq("is_active", true)
      .maybeSingle();

    const isSuperAdmin = !!platformAdmin;

    let callerStaff = null;
    // Check caller in restaurant_staff by auth_user_id
    const { data: staffByAuthId } = await supabaseAdmin
      .from("restaurant_staff")
      .select("id, restaurant_id, role, full_name, is_active, auth_user_id")
      .eq("auth_user_id", callerUser.id)
      .eq("is_active", true)
      .maybeSingle();

    if (staffByAuthId) {
      callerStaff = staffByAuthId;
    } else if (callerUser.email) {
      // Fallback: match by email and self-heal auth_user_id link
      const { data: staffByEmail } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id, restaurant_id, role, full_name, is_active, auth_user_id")
        .eq("email", callerUser.email)
        .eq("is_active", true)
        .maybeSingle();

      if (staffByEmail) {
        callerStaff = staffByEmail;
        if (!staffByEmail.auth_user_id) {
          await supabaseAdmin
            .from("restaurant_staff")
            .update({ auth_user_id: callerUser.id })
            .eq("id", staffByEmail.id);
        }
      }
    }

    // Fallback: If still not in restaurant_staff, check if caller is owner in restaurants table
    if (!callerStaff && callerUser.email && !isSuperAdmin) {
      const { data: restByEmail } = await supabaseAdmin
        .from("restaurants")
        .select("id, name, owner_name, email, phone")
        .eq("email", callerUser.email)
        .maybeSingle();

      if (restByEmail) {
        const { data: newOwnerStaff } = await supabaseAdmin
          .from("restaurant_staff")
          .upsert(
            {
              restaurant_id: restByEmail.id,
              auth_user_id: callerUser.id,
              full_name: restByEmail.owner_name || "Restaurant Owner",
              email: restByEmail.email,
              phone: restByEmail.phone,
              role: "owner",
              is_active: true,
            },
            { onConflict: "restaurant_id,phone" }
          )
          .select()
          .single();

        callerStaff = newOwnerStaff;
      }
    }

    const body: InviteStaffPayload = await req.json().catch(() => ({}));
    const action = body.action || "create";

    let targetRestaurantId: string;
    let actorRole: string;
    let actorName: string;

    if (isSuperAdmin) {
      targetRestaurantId = (body.restaurant_id || callerStaff?.restaurant_id) as string;
      if (!targetRestaurantId) {
        return new Response(
          JSON.stringify({ error: "Missing restaurant_id for Super Admin action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      actorRole = "super_admin";
      actorName = platformAdmin.full_name || "Super Admin";
    } else {
      if (!callerStaff || callerStaff.role !== "owner") {
        return new Response(
          JSON.stringify({ error: "Forbidden: Only restaurant owners or super admins can manage staff" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetRestaurantId = callerStaff.restaurant_id;
      actorRole = callerStaff.role;
      actorName = callerStaff.full_name || "Owner";
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

      if (targetStaff.auth_user_id) {
        const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(
          targetStaff.auth_user_id,
          {
            password: tempPassword,
            app_metadata: {
              restaurant_id: targetRestaurantId,
            },
          }
        );

        if (resetError) {
          return new Response(
            JSON.stringify({ error: `Failed to reset password: ${resetError.message}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Record audit log
      try {
        await supabaseAdmin.from("audit_logs").insert({
          restaurant_id: targetRestaurantId,
          actor_id: callerUser.id,
          actor_role: actorRole,
          actor_name: actorName,
          action: "staff_password_reset",
          entity_type: "restaurant_staff",
          entity_id: targetStaff.id,
          reason: "Owner generated a temporary login password",
          new_values: { staff_id: targetStaff.id, full_name: targetStaff.full_name },
        });
      } catch (logErr) {
        console.warn("Audit log warning:", logErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Temporary password generated for ${targetStaff.full_name}`,
          tempPassword,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Toggle Active Status
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
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If deactivated: ban the auth user. If reactivated: remove ban.
      if (targetStaff.auth_user_id) {
        await supabaseAdmin.auth.admin.updateUserById(targetStaff.auth_user_id, {
          ban_duration: newActiveStatus ? "none" : "876000h",
        });
      }

      try {
        await supabaseAdmin.from("audit_logs").insert({
          restaurant_id: targetRestaurantId,
          actor_id: callerUser.id,
          actor_role: actorRole,
          actor_name: actorName,
          action: "staff_status_toggled",
          entity_type: "restaurant_staff",
          entity_id: targetStaff.id,
          reason: `Staff status changed to ${newActiveStatus ? "Active" : "Inactive"}`,
          new_values: {
            staff_id: targetStaff.id,
            full_name: targetStaff.full_name,
            is_active: newActiveStatus,
          },
        });
      } catch (logErr) {
        console.warn("Audit log warning:", logErr);
      }

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
    // ACTION: Delete Staff (Permanent Removal from DB & Supabase Auth)
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

      // 1. Delete record from restaurant_staff
      const { error: delStaffErr } = await supabaseAdmin
        .from("restaurant_staff")
        .delete()
        .eq("id", targetStaff.id);

      if (delStaffErr) {
        return new Response(
          JSON.stringify({ error: `Failed to remove staff record: ${delStaffErr.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. Permanently delete auth user so credentials cannot be used again
      if (targetStaff.auth_user_id) {
        const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(targetStaff.auth_user_id);
        if (authDelErr) {
          console.warn("Auth user deletion notice:", authDelErr.message);
        }
      }

      // 3. Write audit log
      try {
        await supabaseAdmin.from("audit_logs").insert({
          restaurant_id: targetRestaurantId,
          actor_id: callerUser.id,
          actor_role: actorRole,
          actor_name: actorName,
          action: "staff_deleted",
          entity_type: "restaurant_staff",
          entity_id: targetStaff.id,
          reason: "Staff permanently deleted by owner",
          new_values: {
            staff_id: targetStaff.id,
            full_name: targetStaff.full_name,
            role: targetStaff.role,
          },
        });
      } catch (logErr) {
        console.warn("Audit log warning:", logErr);
      }

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
        .select("id, restaurant_id, auth_user_id, role, full_name, phone, email, is_active")
        .eq("id", body.staff_id)
        .eq("restaurant_id", targetRestaurantId)
        .maybeSingle();

      if (targetError || !targetStaff) {
        return new Response(
          JSON.stringify({ error: "Staff member not found in your restaurant" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateFields: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (body.full_name && body.full_name.trim()) {
        updateFields.full_name = body.full_name.trim();
      }

      if (body.role) {
        if (!ALLOWED_STAFF_ROLES.includes(body.role) && body.role !== targetStaff.role) {
          return new Response(
            JSON.stringify({
              error: `Invalid role: ${body.role}. Allowed roles: ${ALLOWED_STAFF_ROLES.join(", ")}`,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updateFields.role = body.role;

        // Sync role to app_metadata if auth user exists
        if (targetStaff.auth_user_id) {
          await supabaseAdmin.auth.admin.updateUserById(targetStaff.auth_user_id, {
            app_metadata: {
              restaurant_id: targetRestaurantId,
              role: body.role,
            },
          });
        }
      }

      if (body.phone) {
        const cleanPhone = normalizeBDPhone(body.phone);
        if (!isValidBDPhone(cleanPhone)) {
          return new Response(
            JSON.stringify({ error: "Invalid Bangladeshi phone number (must be 11 digits starting with 01)" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: existingStaff } = await supabaseAdmin
          .from("restaurant_staff")
          .select("id")
          .eq("phone", cleanPhone)
          .eq("is_active", true)
          .neq("id", targetStaff.id)
          .maybeSingle();

        if (existingStaff) {
          return new Response(
            JSON.stringify({ error: "This phone number is already registered to another active staff member." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        await supabaseAdmin.from("audit_logs").insert({
          restaurant_id: targetRestaurantId,
          actor_id: callerUser.id,
          actor_role: actorRole,
          actor_name: actorName,
          action: "staff_updated",
          entity_type: "restaurant_staff",
          entity_id: targetStaff.id,
          reason: "Staff details updated by owner",
          new_values: updateFields,
        });
      } catch (logErr) {
        console.warn("Audit log warning:", logErr);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Staff member ${updatedStaff.full_name} updated successfully.`,
          staff: updatedStaff,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: Create Staff (Direct Email + Password for ALL roles: manager, cashier, waiter, kitchen)
    // =========================================================================
    const { full_name, phone, role, email, password } = body;

    if (!full_name || !full_name.trim()) {
      return new Response(
        JSON.stringify({ error: "Missing required field: Full Name is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!role || !ALLOWED_STAFF_ROLES.includes(role)) {
      return new Response(
        JSON.stringify({
          error: `Invalid role: ${role}. Allowed roles are: ${ALLOWED_STAFF_ROLES.join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const staffEmail = email && email.trim() ? email.trim().toLowerCase() : null;
    if (!staffEmail) {
      return new Response(
        JSON.stringify({ error: "Email address is required for staff account creation." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!password || password.trim().length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters long." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userPassword = password.trim();

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

    // 1. Check duplicate email in restaurant_staff
    const { data: existingStaffEmail } = await supabaseAdmin
      .from("restaurant_staff")
      .select("id")
      .eq("email", staffEmail)
      .eq("is_active", true)
      .maybeSingle();

    if (existingStaffEmail) {
      return new Response(
        JSON.stringify({
          error: "A user with this email already exists.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Plan Staff Limit Check
    const { data: restaurantRow } = await supabaseAdmin
      .from("restaurants")
      .select("subscription_plan")
      .eq("id", targetRestaurantId)
      .maybeSingle();

    const planCode = restaurantRow?.subscription_plan || "growth";
    const { data: planRow } = await supabaseAdmin
      .from("plans")
      .select("max_staff")
      .ilike("name", planCode)
      .maybeSingle();

    if (planRow && planRow.max_staff !== null && planRow.max_staff !== undefined) {
      const maxStaffLimit = planRow.max_staff;
      const { count: activeStaffCount } = await supabaseAdmin
        .from("restaurant_staff")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", targetRestaurantId)
        .eq("is_active", true);

      if ((activeStaffCount || 0) >= maxStaffLimit) {
        return new Response(
          JSON.stringify({
            error: `Staff limit (${maxStaffLimit}) reached for your ${planCode} plan. Please upgrade your subscription to add more staff.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 3. Create Auth user via Admin API (Password set directly, email confirmed)
    // NOTE: We do not pass phone to auth.admin.createUser to avoid Supabase auth phone uniqueness collisions.
    const { data: authCreated, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
      email: staffEmail,
      password: userPassword,
      email_confirm: true,
      user_metadata: {
        full_name: full_name.trim(),
        phone: cleanPhone || undefined,
      },
      app_metadata: {
        restaurant_id: targetRestaurantId,
        role: role,
        must_change_password: false,
      },
    });

    if (authCreateError || !authCreated?.user) {
      const rawMsg = authCreateError?.message || "Failed to create user account";
      const isDuplicate = rawMsg.toLowerCase().includes("already") || rawMsg.toLowerCase().includes("duplicate");
      return new Response(
        JSON.stringify({
          error: isDuplicate
            ? "A user with this email already exists."
            : `Auth creation failed: ${rawMsg}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newAuthUserId = authCreated.user.id;

    // 4. Insert into restaurant_staff
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Write audit log
    try {
      await supabaseAdmin.from("audit_logs").insert({
        restaurant_id: targetRestaurantId,
        actor_id: callerUser.id,
        actor_role: actorRole,
        actor_name: actorName,
        action: "staff_created",
        entity_type: "restaurant_staff",
        entity_id: newStaff.id,
        reason: "Staff created directly with email and password",
        new_values: {
          staff_id: newStaff.id,
          full_name: newStaff.full_name,
          email: staffEmail,
          phone: cleanPhone,
          role,
        },
      });
    } catch (logErr) {
      console.warn("Audit log warning:", logErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Staff member ${newStaff.full_name} created successfully.`,
        staff: newStaff,
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
