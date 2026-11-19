import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function checkOldSuperAdminPassword() {
  const emails = ["admin@foodorder.com", "superadmin@amarmenu.com", "admin@amarmenu.com"];
  for (const email of emails) {
    const res = await client.auth.signInWithPassword({
      email,
      password: "admin123",
    });
    console.log(`SignIn attempt for ${email} with 'admin123':`, res.error ? `FAILED (${res.error.message})` : "SUCCESS (VULNERABLE!)");
  }
}

checkOldSuperAdminPassword();
