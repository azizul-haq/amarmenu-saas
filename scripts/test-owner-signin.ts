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
  await pool.query(`
    UPDATE auth.users SET
      recovery_token = '',
      email_change_token_new = '',
      email_change = '',
      phone_change = '',
      phone_change_token = '',
      email_change_token_current = '',
      reauthentication_token = '',
      email_change_confirm_status = 0
    WHERE email = 'testowner@amarmenu.com';
  `);
  console.log("Updated auth.users null string columns");

  const res = await client.auth.signInWithPassword({
    email: "testowner@amarmenu.com",
    password: "password123",
  });

  if (res.error) {
    console.error("Sign-in failed:", res.error);
  } else {
    console.log("SUCCESS! testowner signed in cleanly:", res.data.user.id);
  }
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  pool.end();
});
