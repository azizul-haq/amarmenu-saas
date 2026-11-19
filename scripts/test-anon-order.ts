import fs from "fs";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const supaUrl = env.match(/SUPABASE_URL=([^\r\n]+)/)![1];
const anonKey = env.match(/SUPABASE_ANON_KEY=([^\r\n]+)/)![1];

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
const anonClient = createClient(supaUrl, anonKey, { auth: { persistSession: false } });

async function checkAnonCustomerOrder() {
  // Find an order or create one
  let orderRes = await pool.query("SELECT id FROM orders LIMIT 1");
  let orderId: string;

  if (orderRes.rows.length === 0) {
    const rest = await pool.query("SELECT id FROM restaurants WHERE slug = 'staging-demo' LIMIT 1");
    const restId = rest.rows[0].id;
    const ins = await pool.query(
      `INSERT INTO orders (
        restaurant_id, order_type, table_number, customer_name, customer_phone,
        items, subtotal, tax, discount, total, status, payment_method, payment_status
      ) VALUES (
        $1, 'dine_in', 'T1', 'Private Customer Name', '+8801700000999',
        '[]'::jsonb, 100, 5, 0, 105, 'pending', 'cash', 'pending'
      ) RETURNING id`,
      [restId]
    );
    orderId = ins.rows[0].id;
  } else {
    orderId = orderRes.rows[0].id;
  }

  // Call get_customer_order as anon
  const { data, error } = await anonClient.rpc("get_customer_order", { p_order_id: orderId });

  console.log("Anon get_customer_order response:");
  console.log(JSON.stringify(data, null, 2));
  if (error) console.error("Error:", error);

  await pool.end();
}

checkAnonCustomerOrder();
