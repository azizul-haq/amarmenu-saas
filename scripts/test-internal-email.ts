import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function testGoTrueInternal() {
  const internalEmail = "staff_8801700000001@staff.amarmenu.internal";
  console.log("Testing GoTrue signup with .internal email:", internalEmail);
  const res = await client.auth.signUp({
    email: internalEmail,
    password: "Password123!",
  });
  console.log("Result with .internal email:", res);
}

testGoTrueInternal();
