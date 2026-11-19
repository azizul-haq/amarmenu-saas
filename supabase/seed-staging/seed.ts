import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { assertStagingEnvironment } from "../../src/tests/stagingGuard";

/**
 * AmarMenu Staging Seed Script
 * - Uses GoTrue Admin API exclusively (zero SQL into auth schema)
 * - Generates random cryptographically secure passwords per user
 * - Stores credentials in gitignored .staging-credentials.json
 * - Configures minimal fixtures: Demo Restaurant, Restaurant B, 20 tables, small menu
 */

export interface StagingCredentials {
  super_admin: {
    email: string;
    password: string;
  };
  manager_pin: string;
  restaurant_a: {
    id: string;
    slug: string;
    owner: { email: string; password: string };
    manager: { email: string; password: string };
    cashier: { email: string; password: string };
    kitchen: { email: string; password: string };
    waiter: { email: string; password: string };
  };
  restaurant_b: {
    id: string;
    slug: string;
    owner: { email: string; password: string };
  };
}

function generateRandomPassword(): string {
  const bytes = crypto.randomBytes(16).toString("base64url");
  return `A1!${bytes}`;
}

async function main() {
  console.log("=== AMARMENU STAGING SEED ===");

  // 1. Enforce strict staging guard
  assertStagingEnvironment();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const superAdminEmail = (process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@amarmenu.com").trim().toLowerCase();
  const superAdminPassword = generateRandomPassword();
  const managerPin = "4827"; // Non-trivial PIN: satisfies ^\d{4,6}$, not repeating, not sequential

  const userCreds = {
    owner_a: { email: "owner@demo.example.com", password: generateRandomPassword() },
    manager_a: { email: "manager@demo.example.com", password: generateRandomPassword() },
    cashier_a: { email: "cashier@demo.example.com", password: generateRandomPassword() },
    kitchen_a: { email: "kitchen@demo.example.com", password: generateRandomPassword() },
    waiter_a: { email: "waiter@demo.example.com", password: generateRandomPassword() },
    owner_b: { email: "owner@restaurant-b.example.com", password: generateRandomPassword() },
  };

  // Helper: create or update auth user via GoTrue Admin API
  async function ensureAuthUser(email: string, password: string, fullName: string): Promise<string> {
    const { data: listData } = await adminClient.auth.admin.listUsers();
    const existing = listData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (existing) {
      const { data: updated, error } = await adminClient.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) throw new Error(`Failed to update auth user ${email}: ${error.message}`);
      return updated.user.id;
    } else {
      const { data: created, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) throw new Error(`Failed to create auth user ${email}: ${error.message}`);
      return created.user.id;
    }
  }

  // 2. Provision Super Admin
  console.log(`Provisioning Super Admin (${superAdminEmail})...`);
  const superAdminUid = await ensureAuthUser(superAdminEmail, superAdminPassword, "System Administrator");

  const { error: saErr } = await adminClient.from("platform_admins").upsert({
    auth_user_id: superAdminUid,
    email: superAdminEmail,
    full_name: "System Administrator",
    role: "super_admin",
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "auth_user_id" });
  if (saErr) throw new Error(`Failed to link platform_admin: ${saErr.message}`);

  // 3. Provision Demo Restaurant (A)
  console.log("Provisioning Restaurant A (slug: demo-restaurant)...");
  let restAId: string;
  const { data: existingRestA } = await adminClient
    .from("restaurants")
    .select("id")
    .eq("slug", "demo-restaurant")
    .maybeSingle();

  if (existingRestA) {
    restAId = existingRestA.id;
    await adminClient.from("restaurants").update({
      name: "Demo Restaurant",
      name_bn: "ডেমো রেস্তোরাঁ",
      phone: "+8801711112222",
      email: "demorestaurant@example.com",
      city: "Dhaka",
      address: "Dhanmondi, Dhaka",
      subscription_plan: "growth",
      is_active: true,
      default_vat_rate: 0.05,
      currency: "৳",
    }).eq("id", restAId);
  } else {
    const { data: newRestA, error } = await adminClient.from("restaurants").insert({
      name: "Demo Restaurant",
      name_bn: "ডেমো রেস্তোরাঁ",
      slug: "demo-restaurant",
      phone: "+8801711112222",
      email: "demorestaurant@example.com",
      city: "Dhaka",
      address: "Dhanmondi, Dhaka",
      subscription_plan: "growth",
      is_active: true,
      default_vat_rate: 0.05,
      currency: "৳",
    }).select("id").single();
    if (error) throw new Error(`Failed to insert Restaurant A: ${error.message}`);
    restAId = newRestA.id;
  }

  // Ensure active subscription for Restaurant A
  const { data: growthPlan } = await adminClient.from("plans").select("id").eq("slug", "growth").maybeSingle();
  await adminClient.from("subscriptions").upsert({
    restaurant_id: restAId,
    plan_id: growthPlan?.id || null,
    status: "active",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "restaurant_id" });

  // Provision Staff for Restaurant A
  const staffConfigs = [
    { role: "owner", ...userCreds.owner_a, name: "Demo Restaurant Owner" },
    { role: "manager", ...userCreds.manager_a, name: "Demo Restaurant Manager" },
    { role: "cashier", ...userCreds.cashier_a, name: "Demo Restaurant Cashier" },
    { role: "kitchen", ...userCreds.kitchen_a, name: "Demo Restaurant Kitchen" },
    { role: "waiter", ...userCreds.waiter_a, name: "Demo Restaurant Waiter" },
  ];

  const staffIdMap: Record<string, string> = {};

  for (const staff of staffConfigs) {
    const uid = await ensureAuthUser(staff.email, staff.password, staff.name);

    const { data: staffRow, error } = await adminClient.from("restaurant_staff").upsert({
      restaurant_id: restAId,
      auth_user_id: uid,
      email: staff.email,
      full_name: staff.name,
      role: staff.role,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "auth_user_id" }).select("id").single();
    if (error) console.warn(`Staff link note for ${staff.email}: ${error.message}`);
    if (staffRow) {
      staffIdMap[staff.role] = staffRow.id;
    }
  }

  // Set Manager PIN via owner sign-in and set_staff_manager_pin RPC
  console.log("Setting manager PINs for Restaurant A via owner RPC call...");
  const ownerAClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ownerASession, error: ownerASignInErr } = await ownerAClient.auth.signInWithPassword({
    email: userCreds.owner_a.email,
    password: userCreds.owner_a.password,
  });
  if (ownerASignInErr || !ownerASession?.session) {
    throw new Error(`Failed to sign in as Owner A to set PINs: ${ownerASignInErr?.message}`);
  }

  if (staffIdMap["owner"]) {
    const { error: pinOwnerErr } = await ownerAClient.rpc("set_staff_manager_pin", {
      p_staff_id: staffIdMap["owner"],
      p_new_pin: managerPin,
    });
    if (pinOwnerErr) throw new Error(`Failed to set Owner A PIN: ${pinOwnerErr.message}`);
  }

  if (staffIdMap["manager"]) {
    const { error: pinMgrErr } = await ownerAClient.rpc("set_staff_manager_pin", {
      p_staff_id: staffIdMap["manager"],
      p_new_pin: managerPin,
    });
    if (pinMgrErr) throw new Error(`Failed to set Manager A PIN: ${pinMgrErr.message}`);
  }

  // Provision 20 Tables for Restaurant A
  console.log("Provisioning 20 tables for Restaurant A...");
  const tableRows = [];
  for (let i = 1; i <= 20; i++) {
    tableRows.push({
      restaurant_id: restAId,
      table_number: String(i),
      capacity: 4,
      is_active: true,
      qr_token: crypto.randomBytes(16).toString("hex"),
    });
  }
  await adminClient.from("restaurant_tables").delete().eq("restaurant_id", restAId);
  const { error: tblErr } = await adminClient.from("restaurant_tables").insert(tableRows);
  if (tblErr) throw new Error(`Failed to seed tables: ${tblErr.message}`);

  // Provision Small Bilingual Menu for Restaurant A
  console.log("Provisioning bilingual menu for Restaurant A...");
  await adminClient.from("menu_categories").delete().eq("restaurant_id", restAId);

  const { data: catMain } = await adminClient.from("menu_categories").insert({
    restaurant_id: restAId,
    name: "Main Dishes",
    name_bn: "প্রধান খাবার",
    sort_order: 1,
  }).select("id").single();

  const { data: catBev } = await adminClient.from("menu_categories").insert({
    restaurant_id: restAId,
    name: "Beverages",
    name_bn: "পানীয়",
    sort_order: 2,
  }).select("id").single();

  await adminClient.from("menu_items").insert([
    {
      restaurant_id: restAId,
      category_id: catMain?.id,
      name: "Beef Biryani",
      name_bn: "বিফ বিরিয়ানি",
      price: 280.0,
      is_available: true,
      sizes: [
        { name: "Half", price: 180 },
        { name: "Full", price: 280 },
      ],
      addons: [
        { name: "Extra Egg", price: 20 },
        { name: "Salad", price: 15 },
      ],
    },
    {
      restaurant_id: restAId,
      category_id: catMain?.id,
      name: "Chicken Roast",
      name_bn: "চিকেন রোস্ট",
      price: 160.0,
      is_available: true,
    },
    {
      restaurant_id: restAId,
      category_id: catBev?.id,
      name: "Borhani",
      name_bn: "বোরহানি",
      price: 80.0,
      is_available: false, // Out of stock item requirement
    },
  ]);

  // 4. Provision Restaurant B (Dhanmondi Treat)
  console.log("Provisioning Restaurant B (slug: dhanmondi-treat)...");
  let restBId: string;
  const { data: existingRestB } = await adminClient
    .from("restaurants")
    .select("id")
    .eq("slug", "dhanmondi-treat")
    .maybeSingle();

  if (existingRestB) {
    restBId = existingRestB.id;
  } else {
    const { data: newRestB, error } = await adminClient.from("restaurants").insert({
      name: "Dhanmondi Treat",
      name_bn: "ধানমন্ডি ট্রিট",
      slug: "dhanmondi-treat",
      phone: "+8801722223333",
      email: "dhanmonditreat@example.com",
      city: "Dhaka",
      address: "Satmasjid Road, Dhaka",
      subscription_plan: "starter",
      is_active: true,
      default_vat_rate: 0.05,
      currency: "৳",
    }).select("id").single();
    if (error) throw new Error(`Failed to insert Restaurant B: ${error.message}`);
    restBId = newRestB.id;
  }

  // Provision Owner of B
  const uidB = await ensureAuthUser(userCreds.owner_b.email, userCreds.owner_b.password, "Owner B");
  const { data: ownerBStaffRow } = await adminClient.from("restaurant_staff").upsert({
    restaurant_id: restBId,
    auth_user_id: uidB,
    email: userCreds.owner_b.email,
    full_name: "Owner B",
    role: "owner",
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "auth_user_id" }).select("id").single();

  // Set Owner B manager PIN via Owner B sign-in
  if (ownerBStaffRow) {
    const ownerBClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: bSignInErr } = await ownerBClient.auth.signInWithPassword({
      email: userCreds.owner_b.email,
      password: userCreds.owner_b.password,
    });
    if (!bSignInErr) {
      await ownerBClient.rpc("set_staff_manager_pin", {
        p_staff_id: ownerBStaffRow.id,
        p_new_pin: managerPin,
      });
    }
  }

  // 2 tables for Restaurant B
  await adminClient.from("restaurant_tables").delete().eq("restaurant_id", restBId);
  await adminClient.from("restaurant_tables").insert([
    { restaurant_id: restBId, table_number: "1", capacity: 2, is_active: true, qr_token: crypto.randomBytes(16).toString("hex") },
    { restaurant_id: restBId, table_number: "2", capacity: 4, is_active: true, qr_token: crypto.randomBytes(16).toString("hex") },
  ]);

  // Write .staging-credentials.json (gitignored)
  const credentialsOut: StagingCredentials = {
    super_admin: {
      email: superAdminEmail,
      password: superAdminPassword,
    },
    manager_pin: managerPin,
    restaurant_a: {
      id: restAId,
      slug: "demo-restaurant",
      owner: userCreds.owner_a,
      manager: userCreds.manager_a,
      cashier: userCreds.cashier_a,
      kitchen: userCreds.kitchen_a,
      waiter: userCreds.waiter_a,
    },
    restaurant_b: {
      id: restBId,
      slug: "dhanmondi-treat",
      owner: userCreds.owner_b,
    },
  };

  const credsPath = path.resolve(process.cwd(), ".staging-credentials.json");
  fs.writeFileSync(credsPath, JSON.stringify(credentialsOut, null, 2), "utf-8");

  console.log("\n=======================================================");
  console.log(" SEED COMPLETED SUCCESSFULLY");
  console.log(" All credentials written to .staging-credentials.json");
  console.log(" Passwords are never logged or committed.");
  console.log("=======================================================\n");
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("seed")) {
  main().catch((err) => {
    console.error("Seed execution failed:", err);
    process.exit(1);
  });
}
