import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function inspectIdentities() {
  const res = await pool.query(
    "SELECT * FROM auth.identities WHERE identity_data->>'email' = 'signup_test@amarmenu.com'"
  );
  console.log("signup_test identity:", res.rows[0]);
  await pool.end();
}

inspectIdentities().catch(console.error);
