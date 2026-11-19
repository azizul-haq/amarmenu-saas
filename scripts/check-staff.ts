import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../src/config/config";

async function test() {
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const r = await c.auth.signInWithPassword({ email: "testmanager@amarmenu.com", password: "password123" });
  console.log("Manager auth:", r.error ? r.error.message : "SUCCESS", r.data.user?.id);
}

test().catch(console.error);
