import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'plans';");
  console.log("Plans columns:", res.rows.map(r => r.column_name));
  await pool.end();
}

run().catch((e) => {
  console.error("Error:", e);
  pool.end();
});
