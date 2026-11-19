import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const admins = await pool.query("SELECT * FROM platform_admins;");
  console.log("Platform Admins:", admins.rows);
  const users = await pool.query("SELECT id, email, role, confirmed_at, encrypted_password FROM auth.users WHERE email LIKE '%admin%';");
  console.log("Admin Users in auth.users:", users.rows.map(u => ({ id: u.id, email: u.email, role: u.role, confirmed_at: u.confirmed_at })));
  await pool.end();
}

run().catch((e) => {
  console.error("Error:", e);
  pool.end();
});
