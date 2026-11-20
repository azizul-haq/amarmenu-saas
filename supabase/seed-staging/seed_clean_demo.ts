import crypto from "crypto";
import fs from "fs";
import path from "path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertStagingEnvironment } from "../../src/tests/stagingGuard";

async function main() {
  console.log("=== STARTING CLEAN DEMO SEED FOR TEACHER PRESENTATION ===");

  assertStagingEnvironment();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const dbUrl = process.env.SUPABASE_DB_URL!;

  if (!dbUrl) {
    throw new Error("Missing SUPABASE_DB_URL in environment.");
  }

  const pool = new pg.Pool({ connectionString: dbUrl });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const MANAGER_PIN = "4827";

  // Account credentials
  const creds = {
    super_admin: {
      email: "superadmin@amarmenu.com",
      password: "SuperAdmin@2026!",
      name: "System Administrator",
    },
    rest_1: {
      owner: { email: "owner@sultansdine.com", password: "SultansOwner@2026!", name: "Mohammad Kabir (Owner)", phone: "+8801711223344" },
      manager: { email: "manager@sultansdine.com", password: "SultansManager@2026!", name: "Rahim Chowdhury (Manager)", phone: "+8801711223345" },
      cashier: { email: "cashier@sultansdine.com", password: "SultansCashier@2026!", name: "Sadia Islam (Cashier)", phone: "+8801711223346" },
      kitchen: { email: "kitchen@sultansdine.com", password: "SultansKitchen@2026!", name: "Ustad Monir (Head Chef)", phone: "+8801711223347" },
      waiter: { email: "waiter@sultansdine.com", password: "SultansWaiter@2026!", name: "Tanvir Hasan (Waiter)", phone: "+8801711223348" },
    },
    rest_2: {
      owner: { email: "owner@kacchibhai.com", password: "KacchiOwner@2026!", name: "Sohel Rana (Owner)", phone: "+8801722334455" },
    },
    rest_3: {
      owner: { email: "owner@chillox.com", password: "ChilloxOwner@2026!", name: "Wasif Rahman (Owner)", phone: "+8801733445566" },
    },
  };

  // 1. Wipe all noisy test data cleanly
  console.log("Cleaning noisy database records...");
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON audit_logs;
    DROP TRIGGER IF EXISTS trg_platform_audit_block_mutation ON platform_audit_logs;
    DROP TRIGGER IF EXISTS trg_platform_audit_block_truncate ON platform_audit_logs;

    ALTER TABLE restaurant_staff DISABLE TRIGGER USER;
    ALTER TABLE orders DISABLE TRIGGER USER;
    ALTER TABLE menu_items DISABLE TRIGGER USER;
    ALTER TABLE restaurants DISABLE TRIGGER USER;

    DELETE FROM audit_logs;
    DELETE FROM platform_audit_logs;
    DELETE FROM online_payment_sessions;
    DELETE FROM payments;
    DELETE FROM order_items;
    DELETE FROM order_status_history;
    DELETE FROM orders;
    DELETE FROM cash_shifts;
    DELETE FROM subscription_invoices;
    DELETE FROM subscriptions;
    DELETE FROM menu_items;
    DELETE FROM menu_categories;
    DELETE FROM restaurant_tables;
    DELETE FROM restaurant_admin_notes;
    DELETE FROM restaurant_invoice_sequences;
    DELETE FROM restaurant_order_sequences;
    DELETE FROM restaurant_staff;
    DELETE FROM registration_requests;
    DELETE FROM rate_limits;
    DELETE FROM restaurants;
  `);

  // 2. Manage Auth Users (delete obsolete, create clean ones)
  console.log("Syncing GoTrue Auth users...");
  const desiredEmails = [
    creds.super_admin.email,
    creds.rest_1.owner.email,
    creds.rest_1.manager.email,
    creds.rest_1.cashier.email,
    creds.rest_1.kitchen.email,
    creds.rest_1.waiter.email,
    creds.rest_2.owner.email,
    creds.rest_3.owner.email,
  ];

  // Fetch all existing auth users
  const { data: userListData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUsers = userListData?.users || [];

  for (const u of existingUsers) {
    const userEmail = u.email?.toLowerCase();
    if (userEmail && !desiredEmails.includes(userEmail)) {
      try {
        await adminClient.auth.admin.deleteUser(u.id);
      } catch (err: any) {
        console.warn(`Could not delete old user ${userEmail}:`, err.message);
      }
    }
  }

  async function getOrCreateUser(email: string, password: string, fullName: string): Promise<string> {
    const { data: list } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      await adminClient.auth.admin.updateUserById(match.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      return match.id;
    }
    const { data: created, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    return created.user.id;
  }

  // Provision Super Admin Auth
  console.log("Provisioning Super Admin...");
  const superAdminUid = await getOrCreateUser(creds.super_admin.email, creds.super_admin.password, creds.super_admin.name);
  await pool.query(
    `INSERT INTO platform_admins (auth_user_id, email, full_name, role, is_active, updated_at)
     VALUES ($1, $2, $3, 'super_admin', TRUE, NOW())
     ON CONFLICT (email) DO UPDATE SET auth_user_id = $1, full_name = $3, is_active = TRUE, updated_at = NOW()`,
    [superAdminUid, creds.super_admin.email, creds.super_admin.name]
  );

  // Get Plans
  const { rows: starterPlanRows } = await pool.query(`SELECT id FROM plans WHERE name = 'starter' LIMIT 1`);
  const { rows: growthPlanRows } = await pool.query(`SELECT id FROM plans WHERE name = 'growth' LIMIT 1`);
  const starterPlanId = starterPlanRows[0]?.id;
  const growthPlanId = growthPlanRows[0]?.id;

  // =========================================================================
  // 3. CREATE RESTAURANT 1: Sultan's Dine - Dhanmondi (14-day Free Trial)
  // =========================================================================
  console.log("Provisioning Restaurant 1: Sultan's Dine (Dhanmondi)...");
  const { rows: rest1Rows } = await pool.query(`
    INSERT INTO restaurants (
      name, name_bn, slug, phone, email, city, address, vat_bin_no,
      subscription_plan, is_active, default_vat_rate, currency
    ) VALUES (
      'Sultan''s Dine - Dhanmondi',
      'সুলতান''স ডাইন - ধানমন্ডি',
      'sultans-dine',
      '+8801711223344',
      'dhanmondi@sultansdine.com',
      'Dhaka',
      'House 43, Road 9A, Dhanmondi, Dhaka-1209',
      '001234567-0101',
      'starter',
      TRUE,
      5.00,
      '৳'
    ) RETURNING id
  `);
  const rest1Id = rest1Rows[0].id;

  // Subscription: 14-day free trial (trial status)
  await pool.query(`
    INSERT INTO subscriptions (
      restaurant_id, plan_id, plan_code, billing_cycle, status,
      trial_ends_at, current_period_start, current_period_end
    ) VALUES (
      $1, $2, 'starter', 'monthly', 'trial',
      NOW() + INTERVAL '14 days', NOW(), NOW() + INTERVAL '14 days'
    )
  `, [rest1Id, starterPlanId]);

  // Provision Restaurant 1 Staff
  const r1OwnerUid = await getOrCreateUser(creds.rest_1.owner.email, creds.rest_1.owner.password, creds.rest_1.owner.name);
  const r1ManagerUid = await getOrCreateUser(creds.rest_1.manager.email, creds.rest_1.manager.password, creds.rest_1.manager.name);
  const r1CashierUid = await getOrCreateUser(creds.rest_1.cashier.email, creds.rest_1.cashier.password, creds.rest_1.cashier.name);
  const r1KitchenUid = await getOrCreateUser(creds.rest_1.kitchen.email, creds.rest_1.kitchen.password, creds.rest_1.kitchen.name);
  const r1WaiterUid = await getOrCreateUser(creds.rest_1.waiter.email, creds.rest_1.waiter.password, creds.rest_1.waiter.name);

  const { rows: pinHashRows } = await pool.query(`SELECT extensions.crypt($1, extensions.gen_salt('bf')) AS hash`, [MANAGER_PIN]);
  const pinHash = pinHashRows[0].hash;

  const staffInserts = [
    { uid: r1OwnerUid, email: creds.rest_1.owner.email, name: creds.rest_1.owner.name, role: "owner", pin: pinHash, phone: creds.rest_1.owner.phone },
    { uid: r1ManagerUid, email: creds.rest_1.manager.email, name: creds.rest_1.manager.name, role: "manager", pin: pinHash, phone: creds.rest_1.manager.phone },
    { uid: r1CashierUid, email: creds.rest_1.cashier.email, name: creds.rest_1.cashier.name, role: "cashier", pin: null, phone: creds.rest_1.cashier.phone },
    { uid: r1KitchenUid, email: creds.rest_1.kitchen.email, name: creds.rest_1.kitchen.name, role: "kitchen", pin: null, phone: creds.rest_1.kitchen.phone },
    { uid: r1WaiterUid, email: creds.rest_1.waiter.email, name: creds.rest_1.waiter.name, role: "waiter", pin: null, phone: creds.rest_1.waiter.phone },
  ];

  const r1StaffIds: Record<string, string> = {};
  for (const s of staffInserts) {
    const { rows } = await pool.query(`
      INSERT INTO restaurant_staff (
        restaurant_id, auth_user_id, email, full_name, role, phone, manager_pin_hash, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      RETURNING id
    `, [rest1Id, s.uid, s.email, s.name, s.role, s.phone, s.pin]);
    r1StaffIds[s.role] = rows[0].id;
  }

  // Tables for Restaurant 1 (8 tables)
  const r1TableIds: Record<string, string> = {};
  const r1TableTokens: Record<string, string> = {};
  for (let i = 1; i <= 8; i++) {
    const token = crypto.randomBytes(16).toString("hex");
    const status = (i === 2 || i === 3) ? "occupied" : "available";
    const capacity = i === 6 ? 8 : (i === 3 ? 6 : (i === 4 ? 2 : 4));
    const { rows } = await pool.query(`
      INSERT INTO restaurant_tables (restaurant_id, table_number, capacity, qr_token, status, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id
    `, [rest1Id, String(i), capacity, token, status]);
    r1TableIds[String(i)] = rows[0].id;
    r1TableTokens[String(i)] = token;
  }

  // Categories & Menu for Restaurant 1
  const { rows: c1Rows } = await pool.query(`
    INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order)
    VALUES ($1, 'Kacchi & Biryani', 'কাচ্চি ও বিরিয়ানি', 1) RETURNING id
  `, [rest1Id]);
  const catBiryani = c1Rows[0].id;

  const { rows: c2Rows } = await pool.query(`
    INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order)
    VALUES ($1, 'Curries & Sides', 'কারিজ ও সাইডস', 2) RETURNING id
  `, [rest1Id]);
  const catCurry = c2Rows[0].id;

  const { rows: c3Rows } = await pool.query(`
    INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order)
    VALUES ($1, 'Desserts & Drinks', 'মিষ্টান্ন ও পানীয়', 3) RETURNING id
  `, [rest1Id]);
  const catDessert = c3Rows[0].id;

  const r1MenuItems = [
    { cat: catBiryani, name: "Kacchi Biryani (Basmati)", name_bn: "কাচ্চি বিরিয়ানি (বাসমতী)", price: 380, desc: "Aromatic basmati rice cooked with tender mutton chunks, saffron, and tender spiced potato.", avail: true },
    { cat: catBiryani, name: "Morog Polao", name_bn: "মোরগ পোলাও", price: 260, desc: "Traditional Bangladeshi spiced chicken polao served with hard-boiled egg and rich onion gravy.", avail: true },
    { cat: catCurry, name: "Chicken Roast (Shahi)", name_bn: "শাহী চিকেন রোস্ট", price: 150, desc: "Quarter chicken browned and slow-simmered in a rich spiced yogurt-onion sauce.", avail: true },
    { cat: catCurry, name: "Mutton Rezala", name_bn: "মাটন রেজালা", price: 220, desc: "Mughlai style slow-cooked goat meat stew with cashew-poppy paste and green chilies.", avail: true },
    { cat: catCurry, name: "Jali Kabab", name_bn: "জালি কাবাব", price: 60, desc: "Spiced minced beef patty dipped in egg net and shallow-fried crisp.", avail: false },
    { cat: catDessert, name: "Special Shahi Borhani", name_bn: "স্পেশাল শাহী বোরহানি", price: 80, desc: "Traditional savory yogurt drink with black mustard, mint, roasted cumin, and rock salt.", avail: true },
    { cat: catDessert, name: "Zafrani Firni", name_bn: "জাফরানি ফিরনি", price: 70, desc: "Slow-cooked creamy ground rice pudding infused with saffron and green cardamom.", avail: true },
  ];

  const r1ItemIds: Record<string, string> = {};
  for (const it of r1MenuItems) {
    const { rows } = await pool.query(`
      INSERT INTO menu_items (restaurant_id, category_id, name, name_bn, description, base_price, is_available)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [rest1Id, it.cat, it.name, it.name_bn, it.desc, it.price, it.avail]);
    r1ItemIds[it.name] = rows[0].id;
  }

  // =========================================================================
  // 4. CREATE RESTAURANT 2: Kacchi Bhai - Gulshan (Growth Plan - Active Paid)
  // =========================================================================
  console.log("Provisioning Restaurant 2: Kacchi Bhai (Gulshan)...");
  const { rows: rest2Rows } = await pool.query(`
    INSERT INTO restaurants (
      name, name_bn, slug, phone, email, city, address, vat_bin_no,
      subscription_plan, is_active, default_vat_rate, currency
    ) VALUES (
      'Kacchi Bhai - Gulshan',
      'কাচ্চি ভাই - গুলশান',
      'kacchi-bhai',
      '+8801722334455',
      'gulshan@kacchibhai.com',
      'Dhaka',
      'Plot 15, Block SE(F), Gulshan-1, Dhaka-1212',
      '002345678-0202',
      'growth',
      TRUE,
      5.00,
      '৳'
    ) RETURNING id
  `);
  const rest2Id = rest2Rows[0].id;

  await pool.query(`
    INSERT INTO subscriptions (
      restaurant_id, plan_id, plan_code, billing_cycle, status,
      current_period_start, current_period_end
    ) VALUES (
      $1, $2, 'growth', 'monthly', 'active',
      NOW() - INTERVAL '5 days', NOW() + INTERVAL '25 days'
    )
  `, [rest2Id, growthPlanId]);

  const r2OwnerUid = await getOrCreateUser(creds.rest_2.owner.email, creds.rest_2.owner.password, creds.rest_2.owner.name);
  await pool.query(`
    INSERT INTO restaurant_staff (
      restaurant_id, auth_user_id, email, full_name, role, phone, manager_pin_hash, is_active
    ) VALUES ($1, $2, $3, $4, 'owner', $5, $6, TRUE)
  `, [rest2Id, r2OwnerUid, creds.rest_2.owner.email, creds.rest_2.owner.name, creds.rest_2.owner.phone, pinHash]);

  // Tables for Restaurant 2 (6 tables)
  const r2TableTokens: Record<string, string> = {};
  for (let i = 1; i <= 6; i++) {
    const token = crypto.randomBytes(16).toString("hex");
    await pool.query(`
      INSERT INTO restaurant_tables (restaurant_id, table_number, capacity, qr_token, status, is_active)
      VALUES ($1, $2, 4, $3, 'available', TRUE)
    `, [rest2Id, String(i), token]);
    r2TableTokens[String(i)] = token;
  }

  // Menu for Restaurant 2
  const { rows: c2bRows } = await pool.query(`
    INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order)
    VALUES ($1, 'Chef Specialties', 'শেফ স্পেশাল', 1) RETURNING id
  `, [rest2Id]);
  const cat2 = c2bRows[0].id;

  await pool.query(`
    INSERT INTO menu_items (restaurant_id, category_id, name, name_bn, base_price, is_available) VALUES
    ($1, $2, 'Bashmoti Kacchi Platter', 'বাসমতী কাচ্চি প্ল্যাটার', 420, TRUE),
    ($1, $2, 'Mutton Leg Roast (Whole)', 'খাসির লেগ রোস্ট', 350, TRUE),
    ($1, $2, 'Shahi Tukra with Malai', 'শাহী টুকরা', 110, TRUE),
    ($1, $2, 'Peshwari Naan', 'পেশোয়ারী নান', 80, TRUE),
    ($1, $2, 'Pesta Badam Sharbat', 'পেস্তা বাদাম শরবত', 100, TRUE)
  `, [rest2Id, cat2]);

  // =========================================================================
  // 5. CREATE RESTAURANT 3: Chillox - Banani (Growth Plan - Active Paid)
  // =========================================================================
  console.log("Provisioning Restaurant 3: Chillox (Banani)...");
  const { rows: rest3Rows } = await pool.query(`
    INSERT INTO restaurants (
      name, name_bn, slug, phone, email, city, address, vat_bin_no,
      subscription_plan, is_active, default_vat_rate, currency
    ) VALUES (
      'Chillox - Banani',
      'চিলক্স - বনানী',
      'chillox-banani',
      '+8801733445566',
      'banani@chillox.com',
      'Dhaka',
      'Road 11, Block D, Banani, Dhaka-1213',
      '003456789-0303',
      'growth',
      TRUE,
      5.00,
      '৳'
    ) RETURNING id
  `);
  const rest3Id = rest3Rows[0].id;

  await pool.query(`
    INSERT INTO subscriptions (
      restaurant_id, plan_id, plan_code, billing_cycle, status,
      current_period_start, current_period_end
    ) VALUES (
      $1, $2, 'growth', 'monthly', 'active',
      NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days'
    )
  `, [rest3Id, growthPlanId]);

  const r3OwnerUid = await getOrCreateUser(creds.rest_3.owner.email, creds.rest_3.owner.password, creds.rest_3.owner.name);
  await pool.query(`
    INSERT INTO restaurant_staff (
      restaurant_id, auth_user_id, email, full_name, role, phone, manager_pin_hash, is_active
    ) VALUES ($1, $2, $3, $4, 'owner', $5, $6, TRUE)
  `, [rest3Id, r3OwnerUid, creds.rest_3.owner.email, creds.rest_3.owner.name, creds.rest_3.owner.phone, pinHash]);

  // Tables for Restaurant 3 (6 tables)
  const r3TableTokens: Record<string, string> = {};
  for (let i = 1; i <= 6; i++) {
    const token = crypto.randomBytes(16).toString("hex");
    await pool.query(`
      INSERT INTO restaurant_tables (restaurant_id, table_number, capacity, qr_token, status, is_active)
      VALUES ($1, $2, 4, $3, 'available', TRUE)
    `, [rest3Id, String(i), token]);
    r3TableTokens[String(i)] = token;
  }

  // Menu for Restaurant 3
  const { rows: c3bRows } = await pool.query(`
    INSERT INTO menu_categories (restaurant_id, name, name_bn, display_order)
    VALUES ($1, 'Burgers & Sides', 'বার্গার ও সাইডস', 1) RETURNING id
  `, [rest3Id]);
  const cat3 = c3bRows[0].id;

  await pool.query(`
    INSERT INTO menu_items (restaurant_id, category_id, name, name_bn, base_price, is_available) VALUES
    ($1, $2, 'Naga Blast Beef Burger', 'নাগা ব্লাস্ট বিফ বার্গার', 320, TRUE),
    ($1, $2, 'Crispy Chicken Burger', 'ক্রিস্পি চিকেন বার্গার', 260, TRUE),
    ($1, $2, 'Loaded French Fries', 'লোডেড ফ্রেঞ্চ ফ্রাই', 160, TRUE),
    ($1, $2, 'Buffalo Chicken Wings (6 pcs)', 'বাফেলো উইংস', 250, TRUE),
    ($1, $2, 'Cold Coffee with Vanilla Ice Cream', 'কোল্ড কফি উইথ আইসক্রিম', 150, TRUE)
  `, [rest3Id, cat3]);

  // =========================================================================
  // 6. REALISTIC CASH SHIFT & ORDERS FOR RESTAURANT 1
  // =========================================================================
  console.log("Seeding realistic cash shift & live orders for Restaurant 1...");
  // Open Cash Shift for Cashier
  const { rows: shiftRows } = await pool.query(`
    INSERT INTO cash_shifts (
      restaurant_id, opened_by, status, opening_float, opening_time,
      total_sales, cash_sales, digital_sales, tax_collected, total_orders
    ) VALUES (
      $1, $2, 'open', 2000.00, NOW() - INTERVAL '3 hours',
      2420.00, 1842.00, 578.00, 115.00, 3
    ) RETURNING id
  `, [rest1Id, r1CashierUid]);

  let globalOrderSeq = 100;

  // Helper function to create an order
  async function createRealisticOrder(opts: {
    restId: string;
    tableId: string | null;
    tableNum: string;
    custName: string;
    custPhone: string;
    items: { name: string; qty: number; price: number }[];
    status: string;
    payMethod: string;
    payStatus: string;
    invoiceNum?: string;
    tendered?: number;
    change?: number;
    createdAtInterval: string;
  }) {
    globalOrderSeq++;
    const orderNumber = `ORD-${globalOrderSeq}`;
    const subtotal = opts.items.reduce((sum, it) => sum + (it.qty * it.price), 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    const { rows: oRows } = await pool.query(`
      INSERT INTO orders (
        restaurant_id, table_id, table_number, order_number, order_type, customer_name, customer_phone,
        items, subtotal, tax, discount, total, status, payment_method, payment_status,
        invoice_number, tendered_amount, change_amount, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'qr', $5, $6,
        $7::jsonb, $8, $9, 0, $10, $11, $12, $13,
        $14, $15, $16, NOW() - $17::interval, NOW() - $17::interval
      ) RETURNING id
    `, [
      opts.restId,
      opts.tableId,
      opts.tableNum,
      orderNumber,
      opts.custName,
      opts.custPhone,
      JSON.stringify(opts.items.map(it => ({ name: it.name, quantity: it.qty, unit_price: it.price, total: it.qty * it.price }))),
      subtotal,
      tax,
      total,
      opts.status,
      opts.payMethod,
      opts.payStatus,
      opts.invoiceNum || null,
      opts.tendered || null,
      opts.change || null,
      opts.createdAtInterval,
    ]);
    const orderId = oRows[0].id;

    // Insert order_items
    for (const it of opts.items) {
      await pool.query(`
        INSERT INTO order_items (order_id, restaurant_id, item_name, quantity, unit_price, item_total)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [orderId, opts.restId, it.name, it.qty, it.price, it.qty * it.price]);
    }

    // Insert payment record if paid
    if (opts.payStatus === "paid") {
      await pool.query(`
        INSERT INTO payments (
          restaurant_id, order_id, payment_method, amount, tendered_amount, change_amount, status, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'completed', NOW() - $7::interval
        )
      `, [opts.restId, orderId, opts.payMethod, total, opts.tendered || total, opts.change || 0, opts.createdAtInterval]);
    }

    return orderId;
  }

  // Completed Paid Orders for Restaurant 1
  await createRealisticOrder({
    restId: rest1Id,
    tableId: r1TableIds["1"],
    tableNum: "1",
    custName: "Tariqul Islam",
    custPhone: "01711998877",
    items: [
      { name: "Kacchi Biryani (Basmati)", qty: 2, price: 380 },
      { name: "Special Shahi Borhani", qty: 2, price: 80 },
    ],
    status: "completed",
    payMethod: "cash",
    payStatus: "paid",
    invoiceNum: "INV-20261120-0001",
    tendered: 1000,
    change: 34,
    createdAtInterval: "2 hours",
  });

  await createRealisticOrder({
    restId: rest1Id,
    tableId: r1TableIds["4"],
    tableNum: "4",
    custName: "Nusrat Jahan",
    custPhone: "01811554433",
    items: [
      { name: "Morog Polao", qty: 2, price: 260 },
      { name: "Zafrani Firni", qty: 1, price: 70 },
    ],
    status: "completed",
    payMethod: "bkash",
    payStatus: "paid",
    invoiceNum: "INV-20261120-0002",
    createdAtInterval: "1 hour",
  });

  await createRealisticOrder({
    restId: rest1Id,
    tableId: r1TableIds["5"],
    tableNum: "5",
    custName: "Kamrul Hassan",
    custPhone: "01911332211",
    items: [
      { name: "Mutton Rezala", qty: 2, price: 220 },
      { name: "Chicken Roast (Shahi)", qty: 2, price: 150 },
      { name: "Special Shahi Borhani", qty: 2, price: 80 },
    ],
    status: "completed",
    payMethod: "cash",
    payStatus: "paid",
    invoiceNum: "INV-20261120-0003",
    tendered: 1000,
    change: 14,
    createdAtInterval: "40 minutes",
  });

  // Active Live Order 1: On Table 2 in 'preparing' (Shows on KDS screen!)
  await createRealisticOrder({
    restId: rest1Id,
    tableId: r1TableIds["2"],
    tableNum: "2",
    custName: "Tanvir Ahmed",
    custPhone: "01722889900",
    items: [
      { name: "Kacchi Biryani (Basmati)", qty: 2, price: 380 },
      { name: "Special Shahi Borhani", qty: 2, price: 80 },
    ],
    status: "preparing",
    payMethod: "cash",
    payStatus: "pending",
    createdAtInterval: "8 minutes",
  });

  // Active Live Order 2: On Table 3 in 'ready' (Shows on Live Orders ready for pickup!)
  await createRealisticOrder({
    restId: rest1Id,
    tableId: r1TableIds["3"],
    tableNum: "3",
    custName: "Farhan Kabir",
    custPhone: "01733776655",
    items: [
      { name: "Morog Polao", qty: 1, price: 260 },
      { name: "Chicken Roast (Shahi)", qty: 1, price: 150 },
    ],
    status: "ready",
    payMethod: "cash",
    payStatus: "pending",
    createdAtInterval: "14 minutes",
  });

  // A couple completed orders for Restaurant 2 & 3 so platform GMV is populated
  await createRealisticOrder({
    restId: rest2Id,
    tableId: null,
    tableNum: "1",
    custName: "Shakil Khan",
    custPhone: "01744665544",
    items: [{ name: "Bashmoti Kacchi Platter", qty: 3, price: 420 }, { name: "Pesta Badam Sharbat", qty: 3, price: 100 }],
    status: "completed",
    payMethod: "bkash",
    payStatus: "paid",
    invoiceNum: "INV-20261120-0010",
    createdAtInterval: "3 hours",
  });

  await createRealisticOrder({
    restId: rest3Id,
    tableId: null,
    tableNum: "2",
    custName: "Rubel Hossain",
    custPhone: "01755887766",
    items: [{ name: "Naga Blast Beef Burger", qty: 2, price: 320 }, { name: "Loaded French Fries", qty: 2, price: 160 }, { name: "Cold Coffee with Vanilla Ice Cream", qty: 2, price: 150 }],
    status: "completed",
    payMethod: "card",
    payStatus: "paid",
    invoiceNum: "INV-20261120-0020",
    createdAtInterval: "2 hours",
  });

  // Re-enable triggers
  await pool.query(`
    ALTER TABLE restaurant_staff ENABLE TRIGGER USER;
    ALTER TABLE orders ENABLE TRIGGER USER;
    ALTER TABLE menu_items ENABLE TRIGGER USER;
    ALTER TABLE restaurants ENABLE TRIGGER USER;

    CREATE TRIGGER trg_prevent_audit_log_mutation
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

    CREATE TRIGGER trg_platform_audit_block_mutation
    BEFORE UPDATE OR DELETE ON public.platform_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_audit_mutation();

    CREATE TRIGGER trg_platform_audit_block_truncate
    BEFORE TRUNCATE ON public.platform_audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_platform_audit_mutation();
  `);

  // Save clean credentials to .staging-credentials.json
  const stagingCreds = {
    super_admin: {
      email: creds.super_admin.email,
      password: creds.super_admin.password,
    },
    manager_pin: MANAGER_PIN,
    restaurant_a: {
      id: rest1Id,
      name: "Sultan's Dine - Dhanmondi",
      slug: "sultans-dine",
      owner: creds.rest_1.owner,
      manager: creds.rest_1.manager,
      cashier: creds.rest_1.cashier,
      kitchen: creds.rest_1.kitchen,
      waiter: creds.rest_1.waiter,
    },
    restaurant_b: {
      id: rest2Id,
      name: "Kacchi Bhai - Gulshan",
      slug: "kacchi-bhai",
      owner: creds.rest_2.owner,
    },
    restaurant_c: {
      id: rest3Id,
      name: "Chillox - Banani",
      slug: "chillox-banani",
      owner: creds.rest_3.owner,
    },
    qr_links: {
      sultans_dine_table_1: `http://localhost:5173/menu/sultans-dine?table=${r1TableIds["1"]}&token=${r1TableTokens["1"]}`,
      sultans_dine_table_2: `http://localhost:5173/menu/sultans-dine?table=${r1TableIds["2"]}&token=${r1TableTokens["2"]}`,
      kacchi_bhai_table_1: `http://localhost:5173/menu/kacchi-bhai`,
      chillox_table_1: `http://localhost:5173/menu/chillox-banani`,
    }
  };

  fs.writeFileSync(".staging-credentials.json", JSON.stringify(stagingCreds, null, 2), "utf-8");

  await pool.end();
  console.log("\n=======================================================");
  console.log(" CLEAN DEMO SEED COMPLETED SUCCESSFULLY!");
  console.log(" All noisy records deleted. Exactly 3 restaurants seeded.");
  console.log(" Credentials updated in .staging-credentials.json");
  console.log("=======================================================\n");
}

main().catch(err => {
  console.error("Seed error:", err);
  process.exit(1);
});
