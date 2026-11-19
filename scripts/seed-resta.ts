import fs from "fs";
import { Pool } from "pg";

const env = fs.readFileSync(".env.staging", "utf8");
const dbUrl = env.match(/SUPABASE_DB_URL=([^\r\n]+)/)![1];
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function seedRestA() {
  const restId = "48bde102-324a-4a28-aae5-dd514865756f";

  // Tables
  for (let i = 1; i <= 10; i++) {
    await pool.query(
      `INSERT INTO restaurant_tables (restaurant_id, table_number, capacity, qr_token, status, is_active)
       VALUES ($1, $2, 4, $3, 'available', true)
       ON CONFLICT DO NOTHING`,
      [restId, `T${i}`, `DEMO-T${i}-TOKEN`]
    );
  }

  // Categories
  const catRes = await pool.query(
    `INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order, is_active)
     VALUES ($1, 'Main Dishes', 'প্রধান খাবার', 1, true)
     RETURNING id`,
    [restId]
  );
  const catId = catRes.rows[0]?.id;

  // Menu items
  await pool.query(
    `INSERT INTO menu_items (restaurant_id, category_id, name, name_bn, description, base_price, is_available)
     VALUES ($1, $2, 'Special Kacchi Biryani', 'স্পেশাল কাচ্চি বিরিয়ানি', 'Mutton Kacchi', 350.00, true)
     ON CONFLICT DO NOTHING`,
    [restId, catId]
  );

  console.log("Successfully seeded tables and menu items for demo-restaurant (Restaurant A)!");
  await pool.end();
}

seedRestA().catch((e) => {
  console.error("Fatal:", e);
  pool.end();
});
