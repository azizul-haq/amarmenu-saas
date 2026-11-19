import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const client = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function testOwnerQuery() {
  const auth = await client.auth.signInWithPassword({
    email: "testowner@amarmenu.com",
    password: "password123",
  });
  console.log("Auth user id:", auth.data.user?.id);

  const res = await client
    .from("restaurant_staff")
    .select("id, restaurant_id")
    .eq("email", "testowner@amarmenu.com")
    .single();

  console.log("Query result:", res);
}

testOwnerQuery().catch(console.error);
