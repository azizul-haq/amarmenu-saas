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
  const res = await client.auth.signInWithPassword({ email: "admin@foodorder.com", password: "password123" });
  if (res.error) {
    console.error("Sign-in failed:", res.error);
  } else {
    console.log("SUCCESS! Admin signed in cleanly:", res.data.user.id);
  }
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  pool.end();
});
