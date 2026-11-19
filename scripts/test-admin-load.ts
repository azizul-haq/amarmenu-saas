import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function run() {
  await client.auth.signInWithPassword({ email: "admin@foodorder.com", password: "password123" });
  const res1 = await client.rpc("admin_reject_request", {
    p_request_id: "00000000-0000-0000-0000-000000000000",
    p_rejection_reason: "Test rejection reason",
  });
  console.log("With p_rejection_reason:", res1.error ? res1.error : "SUCCESS (200)");

  const res2 = await client.rpc("admin_reject_request", {
    p_request_id: "00000000-0000-0000-0000-000000000000",
    p_reason: "Test reason",
  });
  console.log("With p_reason:", res2.error ? res2.error : "SUCCESS (200)");
}

run();
