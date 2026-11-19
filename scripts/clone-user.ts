import fs from "fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function cloneUser() {
  const email = "testowner@amarmenu.com";
  const restA = "48bde102-324a-4a28-aae5-dd514865756f";

  // Clean old
  await pool.query("DELETE FROM auth.identities WHERE identity_data->>'email' = $1", [email]);
  await pool.query("DELETE FROM auth.users WHERE email = $1", [email]);

  const newIdRes = await pool.query("SELECT gen_random_uuid() as id");
  const newUserId = newIdRes.rows[0].id;

  await pool.query(
    `INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at, phone, phone_confirmed_at,
      phone_change, phone_change_token, phone_change_sent_at,
      email_change_token_current, email_change_confirm_status, banned_until,
      reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous
    )
    SELECT
      instance_id, $1::uuid, aud, role, $2::text, encrypted_password,
      NOW(), null, encode(gen_random_bytes(32), 'hex'), NOW(),
      '', null, '', '',
      null, null, raw_app_meta_data, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false),
      null, NOW(), NOW(), null, null,
      '', '', null,
      '', 0, null,
      '', null, false, null, false
    FROM auth.users
    WHERE email = 'signup_test@amarmenu.com'`,
    [newUserId, email]
  );

  console.log("Cloned user created:", newUserId);

  await pool.query(
    `INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false), 'email', $1::text, NOW(), NOW(), NOW()
    )`,
    [newUserId, email]
  );
  console.log("Identity created");

  await pool.query("ALTER TABLE restaurant_staff DISABLE TRIGGER USER;");
  await pool.query(
    `UPDATE restaurant_staff SET auth_user_id = $1, is_active = true WHERE restaurant_id = $2 AND email = $3`,
    [newUserId, restA, email]
  );
  await pool.query("ALTER TABLE restaurant_staff ENABLE TRIGGER USER;");
  console.log("Linked to staff");

  // Test sign in!
  const res = await client.auth.signInWithPassword({
    email,
    password: "password123",
  });

  if (res.error) {
    console.error("Sign-in failed:", res.error);
  } else {
    console.log("🎉 SUCCESS!! testowner signed in cleanly:", res.data.user.id);
  }

  await pool.end();
}

cloneUser().catch((e) => {
  console.error("Fatal:", e);
  pool.end();
});
