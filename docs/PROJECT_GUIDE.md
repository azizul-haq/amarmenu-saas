# AmarMenu: The Complete A-to-Z Project Guide
*Multi-Tenant Restaurant POS, QR Dine-In Ordering & SaaS Platform tailored for Bangladesh*

---

## 1. Project Overview

### What is AmarMenu?
**AmarMenu** is an enterprise-grade, multi-tenant Software-as-a-Service (SaaS) platform built specifically for the food and beverage industry in Bangladesh. It bridges the gap between modern digital customer experiences and rigorous restaurant operational controls.

### Who Uses AmarMenu?
1. **Dine-In Customers**: Diners who sit at restaurant tables, scan a secure QR code on their smartphones, browse a bilingual menu (Bengali and English), place orders without waiting for a waiter, and choose to pay via mobile financial services (bKash, Nagad, cards) or cash at the counter.
2. **Restaurant Staff & Management**: Waiters, kitchen chefs, cashiers, shift managers, and restaurant owners who use dedicated, role-tailored web interfaces to take orders, manage kitchen queues, print kitchen tickets, collect payments, audit cash drawers, and enforce security policies.
3. **Platform Super Admins**: The SaaS platform operators who onboard new restaurants, verify subscription payments, monitor platform-wide Gross Merchandise Value (GMV), configure billing plans, and oversee system health across all tenant restaurants.

### Core Architecture Highlights
- **Strict Multi-Tenancy**: Every restaurant’s data is isolated at the PostgreSQL database level using **Row Level Security (RLS)**. No tenant can ever access or leak another tenant's orders, menu, customer data, or financial reports.
- **Server-Enforced Integrity**: Critical business rules (status transitions, billing calculations, pricing immutability, VAT rates, rate limits) are enforced inside PostgreSQL triggers, stored procedures, and Supabase Edge Functions—never trusted to client-side code.
- **Bangladesh Localization**: Native support for **NBR VAT (Mushak-6.3)** fiscal tax compliance, bilingual English/Bengali food menus, Bangladeshi phone number validation (`+8801...`), Asia/Dhaka time synchronization, and local payment gateways (bKash & SSLCOMMERZ).

---

## 2. All User Roles & Permissions

AmarMenu implements a strict **Role-Based Access Control (RBAC)** model. There are **7 distinct roles**, each with clearly defined boundaries:

```
┌─────────────────────────────────────────────────────────────┐
│                    Platform Super Admin                     │
│        (Cross-tenant administration, SaaS billing)          │
└──────────────────────────────┬──────────────────────────────┘
                               │ Manages tenants
┌──────────────────────────────▼──────────────────────────────┐
│                      Restaurant Owner                       │
│    (Full restaurant control, staff hiring, settled voids)   │
└───────┬──────────────────────┬──────────────────────┬───────┘
        │                      │                      │
┌───────▼────────┐     ┌───────▼────────┐     ┌───────▼───────┐
│ Branch Manager │     │    Cashier     │     │ Kitchen Chef  │
│ (Ops, discounts│     │ (Bill settle,  │     │ (KDS display, │
│  unpaid voids) │     │  shifts, cash) │     │  86 items)    │
└───────┬────────┘     └────────────────┘     └───────────────┘
        │
┌───────▼────────┐
│     Waiter     │
│ (Order confirm,│
│  table service)│
└────────────────┘
        ▲
        │ Serves
┌───────┴────────┐
│    Customer    │
│  (QR ordering) │
└────────────────┘
```

### 1. Platform Super Admin (`super_admin`)
- **What they can do**:
  - Review and approve or reject incoming restaurant registration requests.
  - Create, edit, and toggle platform subscription plans (Starter, Growth, Enterprise).
  - Verify manual subscription payments (bKash TrxID) and activate subscriptions.
  - Resend onboarding invitation links to restaurant owners.
  - Suspend, block, or reactivate restaurants.
  - View platform-wide business analytics (total GMV, order volume, revenue per city).
  - Inspect platform-wide audit logs.
- **What they cannot do**:
  - Cannot self-verify a subscription payment if they are also registered as staff of that same restaurant (anti-fraud protection).
  - Cannot alter live restaurant food orders or cash drawer balances directly.

### 2. Restaurant Owner (`owner`)
- **What they can do**:
  - Full operational control over their specific restaurant.
  - Invite, update, and deactivate restaurant staff (Managers, Cashiers, Chefs, Waiters).
  - Edit restaurant profile, phone, address, VAT BIN number, and branding.
  - Manage billing subscriptions (submit bKash payment receipts, upgrade plans).
  - Set and update the **Manager Security PIN** used for operational overrides.
  - Void both **active (unpaid)** and **settled (paid)** orders with audit justification.
  - Add, edit, soft-delete, and permanently remove menu items and categories.
  - Create and configure tables and regenerate QR code tokens.
  - Access full financial reports, NBR VAT summaries, and cash shift records.
- **What they cannot do**:
  - Cannot access other restaurants' data.
  - Cannot modify past fiscal invoices or tamper with append-only audit logs.
  - Cannot change their own role or deactivate themselves if they are the sole owner.

### 3. Branch Manager (`manager`)
- **What they can do**:
  - Manage daily floor and kitchen operations.
  - Confirm pending orders placed by customers.
  - Settle bills and apply **cashier/manager discounts**.
  - Authorize and void **active/unpaid orders** using their 4-digit Manager PIN.
  - Add and update menu items, categories, and dining tables.
  - Open and close cash shifts and review daily sales and shift reports.
- **What they cannot do**:
  - **Cannot void settled/paid bills** (this is strictly reserved for the Owner to prevent cash theft).
  - Cannot permanently delete menu items (can only mark unavailable or edit).
  - Cannot invite or manage staff members.
  - Cannot modify restaurant VAT BIN, billing settings, or subscription plans.

### 4. Cashier (`cashier`)
- **What they can do**:
  - View live orders ready for payment.
  - Settle customer bills for cash payments with **0% discount**.
  - Open and close their own cash shifts (counting starting and ending cash).
  - View their own shift reports and print Mushak-6.3 fiscal receipts.
- **What they cannot do**:
  - Cannot apply a discount greater than 0% on their own (requires Manager authorization).
  - Cannot void orders or reverse payments.
  - Cannot edit menu prices, categories, or table configurations.
  - Cannot confirm kitchen orders or alter restaurant settings.

### 5. Kitchen Chef / KDS Staff (`kitchen`)
- **What they can do**:
  - View the live **Kitchen Display System (KDS)** queue in real time.
  - Advance orders from `accepted` to `preparing` and `ready`.
  - Record and track **KOT (Kitchen Order Ticket)** thermal printing.
  - Toggle item availability ("86-ing" an out-of-stock dish so customers cannot order it).
- **What they cannot do**:
  - Cannot accept pending customer orders (front-of-house responsibility).
  - Cannot modify item names, descriptions, or prices.
  - Cannot settle bills, view payments, or access financial reports.

### 6. Waiter (`waiter`)
- **What they can do**:
  - View active dining tables and floor status (`available` vs `occupied`).
  - Receive real-time notifications of new customer QR orders.
  - Accept and confirm `pending` orders, or reject an invalid order with a reason.
  - Mark `ready` food as served / `completed`.
  - Assist customers with ordering.
- **What they cannot do**:
  - Cannot mark food as `preparing` or `ready` (strictly kitchen role).
  - Cannot settle bills or collect recorded cash payments.
  - Cannot void orders, apply discounts, or edit menu pricing.

### 7. Customer (`anon` / Diners)
- **What they can do**:
  - Scan table QR codes to automatically load their table's session.
  - Browse menu items, categories, prices, and allergen/ingredient descriptions in English or Bengali.
  - Add items to cart and place orders by entering their name and phone number.
  - Track live order status (`pending` -> `accepted` -> `preparing` -> `ready` -> `completed`).
  - Initiate online payments via bKash or SSLCOMMERZ using secure 128-bit tokens.
- **What they cannot do**:
  - Cannot access any administrative, staff, or POS dashboard.
  - Cannot place spam orders (rate-limited to 5 orders per 5 minutes per phone).
  - Cannot order out-of-stock items or tamper with food item prices.
  - Cannot view other tables' orders or other customers' personal phone numbers.

---

### Role & Permission Matrix

| Feature / Action | Super Admin | Owner | Manager | Cashier | Kitchen | Waiter | Customer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Approve / Reject Restaurant Registration** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Manage Subscription Plans & Pricing** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Verify SaaS bKash Payments** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Manage Restaurant Staff & Roles** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Edit Restaurant Settings & VAT BIN** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delete Menu Items Permanently** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Void Settled / Paid Bills (with PIN)** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Void Active Unpaid Orders (with PIN)** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Edit Menu Items & Categories** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Toggle Menu Item Availability (86)** | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Settle Cash Bill with Discount (>0%)** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Settle Cash Bill at Base Price (0% Disc)** | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Open & Close Cash Shift / Z-Report** | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Advance Orders to Preparing & Ready** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Confirm / Accept Pending Orders** | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Scan QR Code & Place Dine-In Order** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 3. Complete Feature List & How Each Works

### Feature 1: Multi-Tenant Onboarding & Registration
- **Self-Service Registration (`/register`)**: An aspiring restaurant owner submits their restaurant details: Restaurant Name, preferred URL slug (e.g. `dhaka-bistro`), Owner Full Name, Email, Phone number, City, Physical Address, and VAT BIN.
- **Admin Review (`/admin/requests`)**: The registration lands in the Super Admin dashboard under "Pending Requests". The Super Admin reviews the credentials and clicks **Approve**.
- **Edge Function Provisioning (`approve-registration`)**:
  - Provisions the restaurant in `restaurants` table.
  - Automatically provisions a 14-day free trial subscription (`starter` plan).
  - Invokes Supabase GoTrue Auth to generate an invitation link.
  - Sends the owner an onboarding link (`/set-password?token_hash=...`).
- **Resend Invite Action (`resend_invite`)**: If the owner did not receive their email, Super Admin can click "Resend Invite". If the owner never logged in, a new link is generated; if already active, a password reset email is sent.

### Feature 2: Bilingual Menu Management
- **Full Localization**: Every menu item supports dual fields: Name (English & Bengali), Description (English & Bengali), Base Price (BDT), Category, Image URL, and VAT applicability.
- **Instant Availability Toggling**: Kitchen and managers can toggle any item's stock status with one click. Unavailable items immediately grey out on all customer phones via Supabase Realtime channels.
- **Cryptographic Price Immutability**: When an order is placed, the database trigger `trg_sync_order_items` copies the exact price into `order_items`. If the restaurant changes the burger price from 250 BDT to 300 BDT tomorrow, historical sales records, receipts, and VAT filings remain strictly at 250 BDT.

### Feature 3: Smart Dine-In Tables & Secure QR Tokens
- **Table Layout**: Restaurants configure table numbers, seating capacities, and floor zones.
- **128-bit Cryptographic QR Tokens**: Each table is assigned a secret, random token stored in the database.
- **Tamper Protection**: Customers scanning the QR code access `/menu/:slug?table=:id&token=:token`. The database RPC `get_table_by_qr_token` validates the token before unlocking the menu. If a customer tries to guess other table numbers, the request is rejected.
- **One-Click Token Regeneration**: If a table's QR sticker is photographed or abused, the owner can click "Regenerate QR Token", which immediately invalidates the old QR code.

### Feature 4: Customer QR Ordering & Anti-Spam Protection
- **Instant Ordering**: Diners view category tabs (Appetizers, Mains, Drinks, Desserts), search items, and add items with notes (e.g., "extra spicy").
- **Cart Checkout**: The diner enters their Name and 11-digit Bangladeshi Phone Number (`017...` / `+8801...`).
- **Atomic Place Order (`place_order`)**:
  - Validates active table and token.
  - Verifies that all ordered items are currently active and available.
  - Calculates subtotal and VAT server-side.
  - Automatically flips the table status from `available` to `occupied`.
  - Rate-limiting guard: blocks automated spam if the same phone submits more than 5 orders within 5 minutes.

### Feature 5: Server-Enforced Order State Machine
Orders follow an immutable progression enforced by database triggers:
```
[pending] ──(Waiter/Manager accepts)──> [accepted]
    │                                        │
    │ (Waiter rejects)                       │ (Kitchen starts)
    ▼                                        ▼
[cancelled]                             [preparing]
                                             │
                                             │ (Kitchen finishes)
                                             ▼
                                          [ready]
                                             │
                                             │ (Waiter serves)
                                             ▼
                                        [completed] ──(Cashier settles)──> [paid]
```
- **Reversal Prevention**: A completed or paid order cannot be moved backwards to pending.
- **Terminal State Protection**: Cancelled orders cannot be resurrected or paid for.

### Feature 6: Kitchen Display System (KDS) & KOT Thermal Printing
- **Live KDS Dashboard (`/restaurant/kitchen`)**: Displays real-time tickets of orders requiring preparation. Tickets change color as elapsed time increases (Green < 10 mins, Amber 10-20 mins, Red > 20 mins).
- **One-Click Bumping**: Kitchen staff click "Start Cooking" to move to `preparing`, and "Ready for Pickup" to move to `ready`.
- **KOT Print Tracking**: When a Kitchen Order Ticket is printed to the thermal printer, `recordKOTPrint` logs the timestamp and print count, preventing duplicate preparation of the same food ticket.

### Feature 7: Cash Drawer Shifts & End-of-Day Z-Report
- **Opening Float**: At the start of a shift, the cashier or manager opens a shift by declaring starting physical cash (e.g. 2,000 BDT float).
- **Real-Time Shift Ledger**: Every cash settlement during that shift is tied to the active shift ID.
- **Closing Shift & Z-Report**:
  - The staff counts physical cash in the drawer and inputs the ending cash amount.
  - The system automatically calculates:
    $$\text{Expected Cash} = \text{Opening Float} + \text{Total Cash Sales} - \text{Refunds}$$
    $$\text{Discrepancy} = \text{Actual Cash} - \text{Expected Cash}$$
  - Identifies cash shortages or overages immediately. Once closed, the Z-Report shift record is locked and cannot be altered.

### Feature 8: Billing, Settlement, Fiscal Invoicing & NBR VAT (Mushak-6.3)
- **Settlement RPC (`settle_order_bill`)**:
  - Validates bill total, applied discount, and cash tendered.
  - Verifies that tendered cash is equal to or greater than the payable total, and calculates exact customer change.
  - Updates order status to `paid` and marks the dining table as `available`.
- **Sequential Fiscal Numbering**: Generates unalterable, gap-free invoice numbers formatted as `INV-YYYYMMDD-XXXX`.
- **NBR VAT Compliance**:
  - Computes standard Bangladeshi VAT breakdown (e.g., 5%, 7.5%, or 15%).
  - Formats receipts according to **National Board of Revenue (NBR) Form Mushak-6.3**.
  - Displays Restaurant BIN (Business Identification Number), customer details, tax rates, and net totals ready for 80mm/58mm thermal receipt printing.

### Feature 9: Order Voids, Manager PIN Security & Audit Logs
- **Strict Immutability**: The `audit_logs` table has database triggers that reject any SQL `UPDATE` or `DELETE` with error `42501`. Audit logs are strictly append-only.
- **Manager PIN Authorization**: Voiding an active order requires a 4-digit Manager PIN and a mandatory text explanation.
- **Settled Bill Void Guard**: Only an **Owner** can void a bill that has already been marked `paid`. This prevents rogue staff from pocketing cash and voiding the receipt after the customer leaves.
- **PIN Hardening Rules**:
  - Rejects trivial PINs (`0000`, `1234`, `4321`, `1111`, `01234`).
  - Employs a lockout mechanism: after 5 consecutive failed attempts, the PIN is locked for 15 minutes (`P0008`).
  - Every failed attempt is written to `audit_logs` under action `manager_pin_failed`.

### Feature 10: Online Payments & Polling Tokens
- **Supported Gateways**: bKash Direct Checkout and SSLCOMMERZ Hosted Gateway.
- **128-Bit Polling Token**: When a payment session is initialized, a cryptographically secure 128-bit hex token is returned to the client.
- **Sanitized Polling (`get_payment_status`)**: Diners poll their payment state using only this token. The RPC never exposes internal order IDs or customer personal info to the network, and only returns the invoice number once payment is confirmed.
- **Atomic Auto-Settlement**: Successful gateway webhooks automatically trigger payment verification, generate the invoice, mark the order paid, and free up the dining table.

### Feature 11: Staff Management & Edge Function Invites
- **Staff Roles**: Owners invite new staff members with roles (`manager`, `cashier`, `kitchen`, `waiter`).
- **Owner-Only Security**: The `invite-staff` Edge Function strictly validates that the caller is an active restaurant owner.
- **Phone Number Normalization**: Automatically formats Bangladeshi numbers to international E.164 (`+88017...`).
- **Duplicate Prevention**: Prevents the same active phone number from being registered to multiple staff members.
- **Plan Staff Quotas**: Enforces plan limits (e.g., Starter allows max 3 staff, Growth allows 10, Enterprise allows unlimited).

### Feature 12: SaaS Billing & Subscription Management
- **Subscription Lifecycle**:
  `trialing` (14 days) -> `active` (paid) -> `grace_period` (3 days) -> `suspended` / `locked`.
- **Self-Service bKash Payment**: Restaurant owners select their plan (Starter @ 1,499 BDT/mo, Growth @ 2,999 BDT/mo, Enterprise @ 5,999 BDT/mo), send money to the official bKash merchant account, and submit the bKash Transaction ID (TrxID) in the portal.
- **Super Admin Verification**: Super Admins review the TrxID and approve it, which atomically updates the restaurant's subscription end date by +30 or +365 days.
- **Automated Grace Sweep (`pg_cron`)**: A cron job runs every night at 00:05 Asia/Dhaka time (`5 18 * * *` UTC) to check expired subscriptions, place overdue accounts into a 3-day grace period, and suspend accounts that remain unpaid.

---

## 4. End-to-End Walkthrough: A Day in the Life

To see how all these pieces fit together, let's trace a complete real-life story:

```
[1. Registration] ──> [2. Super Admin Approval] ──> [3. Setup Menu & Staff]
                                                            │
[6. Cashier Settles] <── [5. Kitchen Prepares] <── [4. Customer Orders]
         │
[7. Nightly Z-Report]
```

### Step 1: Restaurant Registration
1. Mr. Rafiq opens a new biryani eatery in Dhanmondi, Dhaka called **"Dhanmondi Biryani House"**.
2. He visits `http://localhost:5173/register` and fills out the form:
   - Restaurant Name: *Dhanmondi Biryani House*
   - Slug: *dhanmondi-biryani*
   - Owner Name: *Rafiqul Islam*
   - Email: *rafiq@biryani.com*, Phone: *01712345678*
   - City: *Dhaka*, VAT BIN: *123456789-0101*
3. The request is submitted and enters the platform queue.

### Step 2: Super Admin Approval
1. The platform operator logs in at `http://localhost:5173/admin/login`.
2. Under **Pending Requests**, the admin sees *Dhanmondi Biryani House*.
3. The admin clicks **Approve**. The backend creates the restaurant record, grants a 14-day trial, and generates an onboarding link.
4. Mr. Rafiq receives his invitation, visits `/set-password`, chooses a secure password, and sets his 4-digit Manager PIN (`4827`).

### Step 3: Setting Up Floor, Menu & Staff
1. Mr. Rafiq logs in at `/login` as the Owner.
2. In **Tables & Floor**, he creates:
   - *Table 1* (Capacity: 4)
   - *Table 2* (Capacity: 6)
   - *Table 3* (Capacity: 2)
   He downloads and prints the QR code for Table 1 and sticks it to the table.
3. In **Bilingual Menu**, he creates categories (*Biryani*, *Beverages*) and adds items:
   - *Kacchi Biryani* (Bengali: কাচ্চি বিরিয়ানি) - 350 BDT
   - *Borhani* (Bengali: বোরহানি) - 80 BDT
4. In **Staff & Team**, he invites:
   - Cashier: *Karim* (`01811112222`)
   - Chef: *Salam* (`01911113333`)
   - Waiter: *Tanvir* (`01711114444`)

### Step 4: Morning Shift Opening
1. At 10:00 AM, Cashier Karim arrives at the restaurant.
2. Karim logs into `/login` and navigates to **Cash Shifts & Z-Report**.
3. He opens the cash drawer, counts 1,500 BDT in change float, enters `1500`, and clicks **Open Shift**.

### Step 5: Customer Arrives & Places Order
1. At 1:15 PM, a customer (Nayeem) sits down at Table 1.
2. Nayeem points his smartphone camera at the Table 1 QR sticker, opening:
   `http://localhost:5173/menu/dhanmondi-biryani?table=...&token=...`
3. Nayeem selects:
   - 2x Kacchi Biryani (700 BDT)
   - 2x Borhani (160 BDT)
4. At checkout, Nayeem enters his name ("Nayeem") and phone number (`01700998877`), chooses "Pay with Cash at Counter", and taps **Place Order**.
5. The order is stored as `pending` with Subtotal: 860 BDT + 5% NBR VAT: 43 BDT = Total: 903 BDT. Table 1 status instantly turns to `occupied`.

### Step 6: Waiter Confirms Order
1. Waiter Tanvir's tablet sounds a chime. The new order appears in **Live Orders**.
2. Tanvir reviews the order, walks over to Table 1 to verify the customer is seated, and taps **Accept Order**.
3. The order state transitions to `accepted`.

### Step 7: Kitchen Preparation & KDS
1. Chef Salam is watching the **Kitchen KDS** screen on a wall-mounted tablet.
2. Order #101 appears in bold green.
3. Salam taps **Start Preparing** (order moves to `preparing`), scoops 2 plates of fresh Kacchi Biryani, pours 2 glasses of Borhani, and taps **Mark Ready** (order moves to `ready`).
4. Waiter Tanvir sees the `ready` alert, collects the food trays from the kitchen counter, and serves Table 1. Tanvir marks the order `completed`.

### Step 8: Bill Settlement & Fiscal Invoicing
1. After enjoying his meal, Nayeem walks up to the cashier counter to pay.
2. Cashier Karim searches Table 1 on his screen. The payable amount is 903 BDT.
3. Nayeem hands Karim a 1,000 BDT note.
4. Karim enters `1000` into the Tendered Cash field. The system calculates:
   $$\text{Change Due} = 1000 - 903 = 97 \text{ BDT}$$
5. Karim clicks **Settle Bill**:
   - The order status updates to `paid`.
   - Gap-free fiscal invoice `INV-20261120-0001` is generated.
   - The thermal printer prints the official **Mushak-6.3** receipt with the restaurant's VAT BIN.
   - Table 1 automatically resets to `available` for the next diner.
   - Karim hands Nayeem 97 BDT change and the printed receipt.

### Step 9: Nightly Shift Close & Z-Report
1. At 11:00 PM, Karim closes up for the night.
2. In **Cash Shifts & Z-Report**, Karim clicks **Close Shift**.
3. The system states that with the 1,500 BDT opening float plus the day's cash sales, the drawer should contain 28,450 BDT.
4. Karim counts the physical cash in the drawer: exactly 28,450 BDT (Discrepancy: 0 BDT).
5. Karim clicks **Submit Z-Report**. The shift is locked, and Owner Rafiq can view the day's sales and VAT reports from anywhere.

---

## 5. Tech Stack & Directory Structure

### Technology Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, React Router v6.
- **Backend & Database**: Supabase (PostgreSQL 15), Row Level Security (RLS), Stored Procedures (PL/pgSQL), Database Triggers, Realtime WebSockets.
- **Edge Compute**: Supabase Edge Functions (Deno TypeScript runtime) for authenticated administrative operations.
- **Testing**: Vitest, Supabase JS Client, Direct PostgreSQL connection pooling (`pg`), Staging environment test runner.

### Directory Structure Overview

```
restaurant-ordering-saas-main/
├── docs/                               # Documentation & Guides
│   └── PROJECT_GUIDE.md                # This complete guide
├── src/                                # Frontend Source Code
│   ├── components/                     # Reusable UI Components
│   │   ├── auth/                       # ProtectedRoute, ForceChangePasswordModal
│   │   ├── customer/                   # CartModal, CategoryTabs, MenuItemCard
│   │   ├── restaurant/                 # Modals (SettleBill, VoidOrder, PinPad)
│   │   └── ui/                         # Base buttons, inputs, dialogs, badges
│   ├── context/                        # Global State
│   │   └── AuthContext.tsx             # RBAC role, permissions, user session
│   ├── pages/                          # Application Pages & Routes
│   │   ├── admin/                      # Super Admin Dashboard (Requests, Billing, Analytics)
│   │   ├── customer/                   # Customer Menu & Live Order Status
│   │   ├── public/                     # Landing Page, Login, Register, SetPassword
│   │   └── restaurant/                 # Restaurant Dashboard (Orders, KDS, Menu, Tables, Shifts)
│   ├── schemas/                        # TypeScript Interfaces & Validation Schemas
│   ├── services/                       # API Services (Order, Payment, Staff, Subscription)
│   ├── tests/                          # 27 Vitest Integration Test Suites
│   │   ├── stagingGuard.ts             # Staging project safeguard (blocks prod)
│   │   └── testCredentials.ts         # Loads test accounts from staging credentials
│   └── utils/                          # Helper functions (currency BDT, phone regex, dates)
├── supabase/
│   ├── functions/                      # Deno Edge Functions
│   │   ├── approve-registration/       # Super Admin owner onboarding
│   │   ├── change-own-password/        # Authenticated secure password change
│   │   ├── invite-staff/               # Owner staff provisioning & phone normalization
│   │   └── resend_invite/              # Super Admin invite link regeneration
│   ├── migrations/                     # 74 Migration SQL files (Schema, RLS, Triggers, RPCs)
│   └── seed-staging/                   # Staging database seeder script
├── .env.staging                        # Staging environment variables (URL, Anon key, Secret key)
├── .staging-credentials.json           # Secure test credentials for all roles (Git ignored)
└── package.json                        # NPM scripts and dependencies
```

---

## 6. How to Run & Test Locally

### 1. Start the Local Development Server
Open your terminal in the project directory and run:
```bash
npm run dev
```
The application will start at: **`http://localhost:5173`**

### 2. Login URLs for Each Role

| Role to Test | Exact Login URL | What to Explore in the UI |
| :--- | :--- | :--- |
| **Super Admin** | `http://localhost:5173/admin/login` | Approve registration requests, view all restaurants, verify subscription payments, inspect platform GMV analytics. |
| **Restaurant Owner** | `http://localhost:5173/login` | Full control: Invite staff, view reports, void settled bills, update menu prices, manage tables, submit SaaS billing. |
| **Branch Manager** | `http://localhost:5173/login` | Confirm orders, apply manager discount on bill settlement, void unpaid orders with PIN (`4827`), open/close shifts. |
| **Cashier** | `http://localhost:5173/login` | View live orders, settle cash payments with 0 discount, manage personal cash shift and print Z-Report. |
| **Kitchen Chef** | `http://localhost:5173/login` | Kitchen KDS queue, advance orders to preparing/ready, record KOT prints, toggle out-of-stock items (86). |
| **Waiter** | `http://localhost:5173/login` | View table occupancy, receive new order alerts, accept/reject pending orders, mark food served. |
| **Customer** | `http://localhost:5173/menu/demo-restaurant` | Browse English/Bengali dishes, add to cart, enter phone number, place dine-in order, track live preparation. |

### 3. How to Find Your Test Logins
All accounts and passwords for testing are securely generated and kept in your local file:
`./.staging-credentials.json`

Open `.staging-credentials.json` in your editor to view your current logins:
- **Super Admin**: Listed under `"super_admin"` (`email` and `password`).
- **Demo Restaurant Staff**: Listed under `"restaurant_a"`:
  - Owner: `"restaurant_a.owner"`
  - Manager: `"restaurant_a.manager"`
  - Cashier: `"restaurant_a.cashier"`
  - Kitchen: `"restaurant_a.kitchen"`
  - Waiter: `"restaurant_a.waiter"`
- **Manager PIN**: Listed under `"manager_pin"` (e.g. `4827`).

### 4. Running the Automated Test Suite
To verify that all 27 integration test suites and security assertions pass:
```bash
npx vitest run
```
You can also run specific test chunks individually:
```bash
npx vitest run src/tests/chunk22cEdgeFunctions.test.ts
npx vitest run src/tests/rbac.test.ts
npx vitest run src/tests/onlinePayments.test.ts
```

---

*This guide covers everything needed to understand, operate, develop, and test the AmarMenu platform. For questions or technical details on specific database stored procedures or triggers, refer to the timestamped migrations in `supabase/migrations/`.*
