import fs from "fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function testAuth() {
  const email = "testowner@amarmenu.com";
  const pwd = "password123";
  const restA = "48bde102-324a-4a28-aae5-dd514865756f";

  // Inspect indexes
  const idx = await pool.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'auth' AND tablename = 'users'"
  );
  console.log("Indexes on auth.users:", idx.rows);

  // Check if user already exists
  const existing = await pool.query("SELECT id FROM auth.users WHERE email = $1", [email]);
  let userId: string;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
    await pool.query(
      "UPDATE auth.users SET encrypted_password = crypt($2, gen_salt('bf')), email_confirmed_at = NOW() WHERE id = $1",
      [userId, pwd]
    );
  } else {
    const res = await pool.query(
      `INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        $1,
        crypt($2, gen_salt('bf')),
        NOW(),
        '{"provider":"email","providers":["email"]}',
        '{"email":"testowner@amarmenu.com"}',
        NOW(),
        NOW()
      ) RETURNING id;`,
      [email, pwd]
    );
    userId = res.rows[0].id;
  }
  console.log("Created/updated user ID:", userId);

  // 2. Insert into auth.identities
  await pool.query(
    `INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      $1::uuid, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', $1::text, NOW(), NOW(), NOW()
    )
    ON CONFLICT (provider, provider_id) DO NOTHING;`,
    [userId, email]
  );

  // 3. Link to restaurant_staff
  await pool.query("ALTER TABLE restaurant_staff DISABLE TRIGGER USER;");
  const existingStaff = await pool.query(
    "SELECT id FROM restaurant_staff WHERE restaurant_id = $1 AND email = $2",
    [restA, email]
  );
  if (existingStaff.rows.length > 0) {
    await pool.query(
      "UPDATE restaurant_staff SET auth_user_id = $1, role = 'owner', is_active = true WHERE id = $2",
      [userId, existingStaff.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO restaurant_staff (
        auth_user_id, restaurant_id, full_name, phone, email, role, is_active
      ) VALUES (
        $1, $2, 'Demo Restaurant Owner', '+8801711112222', $3, 'owner', true
      )`,
      [userId, restA, email]
    );
  }
  await pool.query("ALTER TABLE restaurant_staff ENABLE TRIGGER USER;");

  console.log("Linked to restaurant_staff");

  // 4. Test signInWithPassword via @supabase/supabase-js
  const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
  const auth = await client.auth.signInWithPassword({ email, password: pwd });
  if (auth.error) {
    console.error("Sign-in failed:", auth.error);
  } else {
    console.log("SUCCESS! Signed in as testowner! User ID:", auth.data.user.id);
  }
  await pool.end();
}

testAuth().catch((err) => {
  console.error("Fatal:", err);
  pool.end();
});
