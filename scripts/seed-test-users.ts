import fs from "fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

interface TestUserDef {
  email: string;
  role: string;
  restaurantSlug: string;
  fullName: string;
  phone: string;
  isSuperAdmin?: boolean;
}

const TEST_USERS: TestUserDef[] = [
  {
    email: "testowner@amarmenu.com",
    role: "owner",
    restaurantSlug: "demo-restaurant",
    fullName: "Demo Restaurant Owner",
    phone: "+8801711112222",
  },
  {
    email: "ownerb@amarmenu.com",
    role: "owner",
    restaurantSlug: "dhanmondi-treat",
    fullName: "Owner B (Dhanmondi Treat)",
    phone: "+8801722223333",
  },
  {
    email: "admin@foodorder.com",
    role: "super_admin",
    restaurantSlug: "",
    fullName: "Platform Super Admin",
    phone: "+8801700000000",
    isSuperAdmin: true,
  },
  {
    email: "testmanager@amarmenu.com",
    role: "manager",
    restaurantSlug: "demo-restaurant",
    fullName: "Test Manager",
    phone: "+8801711113333",
  },
  {
    email: "testwaiter@amarmenu.com",
    role: "waiter",
    restaurantSlug: "demo-restaurant",
    fullName: "Test Waiter",
    phone: "+8801711114444",
  },
  {
    email: "testcashier@amarmenu.com",
    role: "cashier",
    restaurantSlug: "demo-restaurant",
    fullName: "Test Cashier",
    phone: "+8801711115555",
  },
  {
    email: "testkitchen@amarmenu.com",
    role: "kitchen",
    restaurantSlug: "demo-restaurant",
    fullName: "Test Kitchen",
    phone: "+8801711116666",
  },
];

async function seedTestUsers() {
  console.log("Seeding test users for test suite compatibility...");

  // Get encrypted password from auth.users or generate with pgcrypto
  let encryptedPassword = "$2a$10$8rIIwEKfzZCScOheMKDifOiBL7fRvEczCUGTTkjnyyCwPxuZG50Ky";
  try {
    const cryptRes = await pool.query("SELECT extensions.crypt('password123', extensions.gen_salt('bf', 10)) as hash");
    if (cryptRes.rows[0]?.hash) {
      encryptedPassword = cryptRes.rows[0].hash;
    }
  } catch {
    // Fallback to static hash for password123
  }

  await pool.query("ALTER TABLE restaurant_staff DISABLE TRIGGER USER;");

  for (const u of TEST_USERS) {
    // 1. Check or insert into auth.users
    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM auth.users WHERE email = $1",
      [u.email]
    );

    let userId: string;
    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      await pool.query(
        `UPDATE auth.users SET
           encrypted_password = $2,
           email_confirmed_at = NOW(),
           recovery_token = '',
           email_change_token_new = '',
           email_change = '',
           phone_change = '',
           phone_change_token = '',
           email_change_token_current = '',
           reauthentication_token = '',
           email_change_confirm_status = 0
         WHERE id = $1`,
        [userId, encryptedPassword]
      );
    } else {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO auth.users (
           instance_id, id, aud, role, email, encrypted_password,
           email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at,
           recovery_token, recovery_sent_at, email_change_token_new, email_change,
           email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
           is_super_admin, created_at, updated_at, phone, phone_confirmed_at,
           phone_change, phone_change_token, phone_change_sent_at,
           email_change_token_current, email_change_confirm_status, banned_until,
           reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous
         ) VALUES (
           '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1::text, $2::text,
           NOW(), null, encode(gen_random_bytes(32), 'hex'), NOW(),
           '', null, '', '',
           null, null, '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('sub', gen_random_uuid()::text, 'email', $1::text, 'email_verified', true, 'phone_verified', false),
           null, NOW(), NOW(), null, null,
           '', '', null,
           '', 0, null,
           '', null, false, null, false
         ) RETURNING id`,
        [u.email, encryptedPassword]
      );
      userId = ins.rows[0].id;
    }

    // 2. Identity
    await pool.query(
      `INSERT INTO auth.identities (
         id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false), 'email', $1::text, NOW(), NOW(), NOW()
       )
       ON CONFLICT (provider, provider_id) DO UPDATE SET updated_at = NOW()`,
      [userId, u.email]
    );

    // 3. Link staff or platform admin
    if (u.isSuperAdmin) {
      await pool.query(
        `INSERT INTO platform_admins (auth_user_id, full_name, email, role, is_active)
         VALUES ($1, $2, $3, 'super_admin', true)
         ON CONFLICT (email) DO UPDATE SET auth_user_id = $1, is_active = true`,
        [userId, u.fullName, u.email]
      );
    } else if (u.restaurantSlug) {
      const rest = await pool.query<{ id: string }>(
        "SELECT id FROM restaurants WHERE slug = $1 LIMIT 1",
        [u.restaurantSlug]
      );
      if (rest.rows.length > 0) {
        const restId = rest.rows[0].id;
        const staffRes = await pool.query<{ id: string }>(
          "SELECT id FROM restaurant_staff WHERE restaurant_id = $1 AND email = $2",
          [restId, u.email]
        );
        if (staffRes.rows.length > 0) {
          await pool.query(
            "UPDATE restaurant_staff SET auth_user_id = $1, role = $2, is_active = true WHERE id = $3",
            [userId, u.role, staffRes.rows[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO restaurant_staff (
               auth_user_id, restaurant_id, full_name, phone, email, role, is_active
             ) VALUES ($1, $2, $3, $4, $5, $6, true)`,
            [userId, restId, u.fullName, u.phone, u.email, u.role]
          );
        }
      }
    }

    console.log(`✓ Provisioned: ${u.email} (${u.role}) -> ${userId}`);
  }

  await pool.query("ALTER TABLE restaurant_staff ENABLE TRIGGER USER;");
  console.log("All test users provisioned successfully!");

  // Verify sign-in for owner and admin
  const ownerAuth = await client.auth.signInWithPassword({
    email: "testowner@amarmenu.com",
    password: "password123",
  });
  console.log("Owner login test:", ownerAuth.error ? "FAILED: " + ownerAuth.error.message : "SUCCESS!");

  const adminAuth = await client.auth.signInWithPassword({
    email: "admin@foodorder.com",
    password: "password123",
  });
  console.log("Admin login test:", adminAuth.error ? "FAILED: " + adminAuth.error.message : "SUCCESS!");

  await pool.end();
}

seedTestUsers().catch((e) => {
  console.error("Fatal:", e);
  pool.end();
});
