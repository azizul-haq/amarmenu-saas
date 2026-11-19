import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const res = await pool.query(`
    SELECT proname, proargnames, prosrc
    FROM pg_proc
    WHERE proname = 'admin_reject_request';
  `);
  console.log("admin_reject_request:", res.rows[0]);
  await pool.end();
}

run().catch((e) => {
  console.error("Error:", e);
  pool.end();
});
