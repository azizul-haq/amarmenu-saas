import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function fullCompare() {
  const res = await pool.query(
    "SELECT * FROM auth.users WHERE email IN ('testowner@amarmenu.com', 'signup_test@amarmenu.com')"
  );
  console.log("Full user comparison:");
  for (const row of res.rows) {
    console.log(`\n--- ${row.email} ---`);
    for (const [k, v] of Object.entries(row)) {
      if (k === "encrypted_password") continue;
      console.log(`${k}:`, v);
    }
  }
  await pool.end();
}

fullCompare().catch(console.error);
