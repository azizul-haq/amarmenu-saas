import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function compareUsers() {
  const res = await pool.query(
    "SELECT id, email, raw_app_meta_data, raw_user_meta_data, is_sso_user, deleted_at FROM auth.users WHERE email IN ('testowner@amarmenu.com', 'signup_test@amarmenu.com')"
  );
  console.log("Users:", res.rows);

  const idRes = await pool.query(
    "SELECT id, user_id, provider, provider_id, identity_data FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email IN ('testowner@amarmenu.com', 'signup_test@amarmenu.com'))"
  );
  console.log("Identities:", idRes.rows);

  await pool.end();
}

compareUsers().catch(console.error);
