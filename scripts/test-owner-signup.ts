import fs from "fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function run() {
  const email = "testowner@amarmenu.com";
  const pwd = "password123";
  const restA = "48bde102-324a-4a28-aae5-dd514865756f";

  // Clean old manually created record
  await pool.query("DELETE FROM auth.identities WHERE identity_data->>'email' = $1", [email]);
  await pool.query("DELETE FROM auth.users WHERE email = $1", [email]);

  // Sign up via GoTrue
  console.log("Signing up testowner via GoTrue...");
  const signup = await client.auth.signUp({ email, password: pwd });
  if (signup.error) {
    console.error("SignUp error:", signup.error);
    await pool.end();
    return;
  }
  const userId = signup.data.user!.id;
  console.log("SignUp successful! User ID:", userId);

  // Confirm email
  await pool.query("UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = $1", [userId]);
  console.log("Confirmed email");

  // Link in restaurant_staff
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

  // Sign in
  const auth = await client.auth.signInWithPassword({ email, password: pwd });
  if (auth.error) {
    console.error("Sign-in error:", auth.error);
  } else {
    console.log("SUCCESS!! Signed in as testowner:", auth.data.user.id);
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  pool.end();
});
