# AmarMenu - Project Progress & Architecture Tracker

## Project Overview
* **Product**: AmarMenu (আমার মেনু) — Multi-Tenant Restaurant SaaS for Bangladesh
* **Stack**: React 19 + TypeScript + Vite + Tailwind CSS + Supabase (PostgreSQL + Realtime + Storage + Auth)
* **Target Market**: Casual dining, cafes, and restaurants across Dhaka, Chittagong, Sylhet, etc.

---

## Chunk History & Status

| Chunk | Title | Status | Summary |
| :---: | :--- | :---: | :--- |
| **1** | **Baseline Cleanup & Setup** | **Done** | Initialized git, fixed `.gitignore`, set up `supabase/migrations/20261117000000_baseline.sql`, updated `.env.example`, documented all `any` usages and known debt. |
| **2** | **BD Localization (Core)** | **Done** | ₹ → ৳, BD mobile regex + E.164 normalization (+8801XXXXXXXXX), Asia/Dhaka timezone formatting, configurable VAT rate, bKash/Nagad payment labels, 20 unit tests via Vitest. |
| **3** | **Core Schema v1** | **Done** | Versioned migration (20261117000001_core_schema_v1.sql) applied to remote DB with zero data loss. Added restaurants BD columns (VAT BIN, trade license, currency ৳), restaurant_staff, platform_admins, plans (Starter/Growth/Enterprise), subscriptions backfilled, updated TypeScript interfaces. |
| **4** | **Auth & Route Protection** | **Done** | Implemented official Supabase Auth (`AuthProvider`, `useAuth`, `ProtectedRoute`). Protected `/admin/*` (super_admin only) and `/restaurant/*` (staff only) with redirect to login. Migrated Admin & Restaurant Login to Supabase Auth. Uninstalled `crypto-js` and `@types/crypto-js`. Replaced client hash with native Web Crypto SHA-256 fallback. Seeded and verified `admin@foodorder.com` and `testowner@amarmenu.com`. |
| **5** | **Tenant RLS + Isolation Tests** | **Done** | Implemented strict multi-tenant RLS policies on all tables (`orders`, `menu_items`, `menu_categories`, `subscriptions`, `restaurant_staff`, `restaurants`). Created `current_restaurant_id()` and `is_super_admin()` helper functions. Revoked anon execute on admin procedures and dropped legacy RPC logins. Added 10 automated RLS integration tests in `src/tests/rls.test.ts` verifying Restaurant A cannot view/edit Restaurant B's data, anon cannot access orders, and super admin has full visibility (30/30 total tests pass). |
| **6** | **Super Admin Approval & Onboarding** | **Done** | Implemented server-side registration approval via Edge Function (`approve-registration`) and secure RPC procedure (`approve_registration_request`). Eliminated client-side temporary passwords and plaintext credential modals. Generated secure `/set-password` invite links with 1-click WhatsApp/SMS/Email copy. Built `SetPasswordPage.tsx`. Eliminated 4 more `any` types (down to 12). All 32 automated tests pass. |
| **7** | **Bilingual Menu & Soft Delete** | **Done** | Bilingual support (English + বাংলা) for categories and menu items (`name_bn`, `description_bn`). Dynamic size variants (with custom pricing) and add-on options (e.g. Borhani, Extra Cheese). Runtime validation with Zod schemas (`menuItemSchema`, `menuCategorySchema`, `sizeVariantSchema`, `addonVariantSchema`). Non-destructive soft delete (`deleted_at`) preserving historical order integrity. Full tenant RLS isolation and 8 automated tests in `src/tests/menu.test.ts` (40/40 total tests pass). Eliminated 1 more `any` type (down to 11). |
| **8** | **Tables Management & QR Ordering** | **Done** | Table management schema (`restaurant_tables`, `qr_token`), unique unguessable 32-char tokens, token rotation via `regenerate_table_qr_token`, tenant-scoped RLS. Branded table tent card modal and downloadable PDF generation via `jsPDF` + `html2canvas` (single table + bulk all tables). Secure customer QR verification (`verify_table_qr_token`): verified table locks checkout table number, invalid or manipulated QR token displays prominent alert. Added 9 automated tests in `src/tests/tables.test.ts` (49/49 total tests pass). Eliminated 4 more `any` types in `CustomerMenu.tsx` (down to 7). |
| **9** | **Atomic place_order & Anti-Tampering** | **Done** | Atomic `place_order` stored procedure: queries DB truths for base price, sizes, and addons; strictly rejects client price tampering and subtotal/total forgery; computes restaurant VAT (`default_vat_rate`); verifies dine-in table QR tokens; guarantees gap-free order numbers via `restaurant_order_sequences`; prevents duplicates via `idempotency_key`; enforces rate limiting (max 5 orders/5 min per phone). Added 7 automated tests in `src/tests/orderPlacement.test.ts` (56/56 total tests pass). |
| **10** | **Customer Ordering UI & Status Tracking** | **Done** | Cart store with composite variant keys and `localStorage` persistence per restaurant. Bilingual customer menu (English + বাংলা) with live language toggle, category tabs, and real-time menu sync. Seamless item customization modal (sizes & addons calculation). Dine-in table QR lock integration. Zod-validated checkout (`customerCheckoutSchema`). Sanitized public order status RPC (`get_customer_order`) with live 4-step progress stepper (Order Placed → Preparing → Ready → Completed), live polling, and itemized receipt with NBR VAT details. Added 10 automated tests in `src/tests/customerOrdering.test.ts` (66/66 total tests pass). Eliminated 2 more `any` types (down to 5). |
| **11** | **Waiter Verify & Order State Machine** | **Done** | Server-enforced order lifecycle state machine via Postgres `BEFORE UPDATE OF status` trigger (`validate_order_status_transition`). Enforces strict linear progression (`pending` ➔ `accepted` ➔ `preparing` ➔ `ready` ➔ `completed`) and terminal states (`completed`, `cancelled`, `rejected`), automatically rejecting illegal transitions with code `P0001`. Auto-populates timestamps (`accepted_at`, `preparing_at`, `ready_at`, `completed_at`, `cancelled_at`). Deployed `transition_order_status` RPC with tenant authorization check (`current_restaurant_id()`) and full audit trail logging in `order_status_history`. Redesigned waiter order management dashboard (`Orders.tsx`) with status filters, pulsing pending verification alerts, one-click verify/confirm, kitchen start, ready to serve, and modal timeline. Added 10 automated tests in `src/tests/orderStateMachine.test.ts` (76/76 total tests pass). Eliminated 1 more `any` type (down to 4). |

### Current Chunk: Chunk 11 Completed (Awaiting Next)

---

## Architectural Decisions Log (ADR)
* **ADR-001 (Versioned Migrations)**: All database changes must reside in `supabase/migrations/<timestamp>_<name>.sql`. No manual un-versioned dashboard edits.
* **ADR-002 (Tenant Security)**: All tenant-scoped tables must have `restaurant_id` and strict RLS policies tied to authenticated identities.
* **ADR-003 (Currency & Format)**: Currency is BDT (`৳`), stored as `NUMERIC(10,2)`. All timestamps stored in `TIMESTAMPTZ` and formatted in `Asia/Dhaka` time.
* **ADR-004 (Phone Numbers)**: Validated against Bangladeshi mobile format (`^(\+8801|01)[3-9]\d{8}$`) and normalized to `+8801XXXXXXXXX`.
* **ADR-005 (Zero `any` Types)**: Strict TypeScript validation. Form inputs validated via Zod schemas.
* **ADR-006 (Supabase Auth & Session Handling)**: Authentication is driven via Supabase GoTrue Auth with JWT tokens. Role resolution is evaluated from `platform_admins` and `restaurant_staff` tables in `AuthContext`. Route protection is enforced via `ProtectedRoute`.
* **ADR-007 (Tenant Row Level Security)**: All database queries must run under Postgres RLS. Public anon clients can only view active menus and submit customer orders. Authenticated restaurant staff are strictly constrained to `restaurant_id = current_restaurant_id()`. Super admins are granted platform-wide oversight via `is_super_admin()`.
* **ADR-008 (Password-Free Owner Onboarding)**: Restaurant owners never receive plaintext or temporary passwords. On approval, the platform issues an invite / set-password link (`/set-password`) via Edge Function / GoTrue Admin API. The owner sets their permanent password upon first access.
* **ADR-009 (Bilingual Menu & Soft Delete Integrity)**: Menu categories and items store both English and Bengali text (`name_bn`, `description_bn`). To protect customer order historical integrity, item deletion uses soft-deletion (`deleted_at = NOW()`). Postgres RLS policies allow staff full management while preventing soft-deleted items from leaking to storefront customer queries. Variants (sizes and add-ons) are modeled as validated JSONB structures with individual pricing.
* **ADR-010 (Cryptographic Table QR Token & Ordering Verification)**: Each dine-in table is assigned a unique, unguessable 32-character hexadecimal cryptographic token (`qr_token`). Scanning `/menu/:slug?table=<token>` validates both restaurant slug and table token atomically via `verify_table_qr_token`. On valid token detection, the table number is automatically locked for checkout to prevent table spoofing. Manipulated, expired, or soft-deleted table tokens are rejected with a clear customer error.
* **ADR-011 (Server-Side Price Authority, Anti-Tampering, Idempotency & Sequences)**: Client-side prices and totals are never trusted for transaction persistence. The `place_order` procedure resolves base prices, size variants, and add-ons directly from database rows, calculating authoritative subtotals, restaurant NBR VAT (`default_vat_rate`), and totals. Any price deviation between client and server triggers an immediate exception (`Price tampering detected`). Network double-submissions are deduplicated via `idempotency_key`. Gap-free sequential numbers (`ORD-YYYYMMDD-XXXX`) are guaranteed through the atomic `restaurant_order_sequences` table. Spam is blocked via 5-minute rolling rate limits per phone number.
* **ADR-012 (Sanitized Customer Order Tracking & Cart Persistence)**: Anonymous customers track their order status via the dedicated `get_customer_order(order_id)` RPC rather than granting broad anon SELECT on `orders`. Cart state is managed through `CartContext` keyed by `${itemId}_size:${size}_addons:${addons}` and persisted per restaurant slug in `localStorage`. Checkouts are validated using `customerCheckoutSchema` (Zod) enforcing BD phone and table rules. Post-order submission automatically clears the restaurant cart and routes customers to `/order/:orderId` featuring real-time 4-step status progression.
* **ADR-013 (Server-Enforced Order State Machine & Audit History)**: Order status transitions must obey the authoritative state machine enforced at the database level by trigger `trg_validate_order_status_transition`. Illegal jumps (e.g. `pending ➔ completed`) or terminal mutations (e.g. `completed ➔ pending` / `cancelled ➔ ready`) raise PostgreSQL exceptions. Authenticated staff transition orders via `transition_order_status`, which checks caller authorization against `restaurant_id`, records `verified_by`, sets transition timestamps, and appends audit events to `order_status_history`.

---

## Inventory of `any` Types (To Be Eliminated)

Remaining occurrences: **4** (originally 26, eliminated 22)

| # | File Path | Line | Context Snippet | Planned Elimination Chunk | Status |
| :-: | :--- | :-: | :--- | :--- | :--- | :---: |
| 1 | `src/pages/admin/Dashboard.tsx` | 25 | `const [admin, setAdmin] = useState<any>(null);` | Chunk 4: Auth Refactor | **Eliminated** |
| 2 | `src/pages/admin/LoginPage.tsx` | 71 | `} catch (err: any) {` | Chunk 4: Auth Refactor | **Eliminated** |
| 3 | `src/pages/admin/PendingRequests.tsx` | 41 | `const [credentials, setCredentials] = useState<any>(null);` | Chunk 6: Admin Onboarding | **Eliminated** |
| 4 | `src/pages/admin/PendingRequests.tsx` | 257 | `onSuccess: (credentials: any) => void;` | Chunk 6: Admin Onboarding | **Eliminated** |
| 5 | `src/pages/admin/PendingRequests.tsx` | 529 | `credentials: any;` | Chunk 6: Admin Onboarding | **Eliminated** |
| 6 | `src/pages/customer/CustomerMenu.tsx` | 37 | `const [restaurant, setRestaurant] = useState<any>(null);` | Customer Menu Types | **Eliminated** |
| 7 | `src/pages/customer/CustomerMenu.tsx` | 101 | `selectedSize?: any,` | Customer Menu Types | **Eliminated** |
| 8 | `src/pages/customer/CustomerMenu.tsx` | 102 | `selectedAddons: any[] = []` | Customer Menu Types | **Eliminated** |
| 9 | `src/pages/customer/CustomerMenu.tsx` | 531 | `onAdd: (item: MenuItem, selectedSize?: any, selectedAddons?: any[]) => void;` | Customer Menu Types | **Eliminated** |
| 10 | `src/pages/customer/CustomerMenu.tsx` | 540 | `const [selectedSize, setSelectedSize] = useState<any>(null);` | Customer Menu Types | **Eliminated** |
| 11 | `src/pages/customer/CustomerMenu.tsx` | 541 | `const [selectedAddons, setSelectedAddons] = useState<any[]>([]);` | Customer Menu Types | **Eliminated** |
| 12 | `src/pages/customer/CustomerMenu.tsx` | 551 | `const toggleAddon = (addon: any) => {` | Customer Menu Types | **Eliminated** |
| 13 | `src/pages/public/LoginPage.tsx` | 116 | `} catch (err: any) {` | Chunk 4: Auth Refactor | **Eliminated** |
| 14 | `src/pages/public/RegisterPage.tsx` | 120 | `} catch (err: any) {` | Registration Refactor | Pending |
| 15 | `src/pages/restaurant/Dashboard.tsx` | 27 | `const [user, setUser] = useState<any>(null);` | Chunk 4: Auth Refactor | **Eliminated** |
| 16 | `src/pages/restaurant/Dashboard.tsx` | 28 | `const [restaurant, setRestaurant] = useState<any>(null);` | Chunk 4: Auth Refactor | **Eliminated** |
| 17 | `src/pages/restaurant/Orders.tsx` | 83 | `const variants: Record<string, any> = {` | Order Management Types | **Eliminated** |
| 18 | `src/pages/restaurant/Orders.tsx` | 409 | `{order.items?.map((item: any, index: number) => (` | Order Management Types | **Eliminated** |
| 19 | `src/pages/restaurant/Reports.tsx` | 76 | `order.items?.forEach((item: any) => {` | Reports & Analytics Types | Pending |
| 20 | `src/pages/restaurant/Reports.tsx` | 299 | `label={(entry: any) =>` | Reports & Analytics Types | Pending |
| 21 | `src/pages/restaurant/RestaurantHome.tsx` | 8 | `const [stats, setStats] = useState<any>(null);` | Dashboard Stats Types | **Eliminated** |
| 22 | `src/pages/restaurant/RestaurantHome.tsx` | 132 | `{stats.recentOrders.slice(0, 5).map((order: any) => (` | Dashboard Stats Types | Pending |
| 23 | `src/services/adminService.ts` | 119 | `} catch (error: any) {` | Chunk 6: Service Layer Types | **Eliminated** |
| 24 | `src/services/restaurantService.ts` | 56 | `const updateData: any = { status };` | Service Layer Types | **Eliminated** |
| 25 | `src/utils/helpers.ts` | 50 | `export const calculateOrderTotals = (items: any[]) => {` | Helper Functions Types | **Eliminated** |
| 26 | `src/utils/helpers.ts` | 120 | `export const debounce = <T extends (...args: any[]) => any>(` | Helper Functions Types | Pending |

---

## Known Issues & Technical Debt (Outside Current Scope)
The following issues were identified during code inspection:
1. ~~**Client-side Password Hashing**~~: **Resolved in Chunk 4**. `crypto-js` removed; official Supabase Auth GoTrue + bcrypt utilized.
2. ~~**Session Storage Insecurity**~~: **Resolved in Chunk 4**. Sessions managed via Supabase GoTrue Auth JWT tokens with automatic refresh.
3. ~~**Missing Route Guards**~~: **Resolved in Chunk 4**. `ProtectedRoute` guards `/admin/*` (super_admin only) and `/restaurant/*` (staff roles only). Direct browser URL entry is protected.
4. ~~**Indian Currency & Phone Format Defaults**~~: **Resolved in Chunk 2**. BDT `৳` and BD phone regex implemented.
5. ~~**Blanket RLS Policies**~~: **Resolved in Chunk 5**. Strict tenant-scoped RLS policies deployed across all database tables with automated multi-tenant verification tests.
6. ~~**Missing Menu Validation & Non-Bilingual Menus**~~: **Resolved in Chunk 7**. Strict Zod schemas enforce required fields, positive prices, and variant structures. Full English + Bengali support and non-destructive soft-delete deployed.
7. ~~**Insecure Table Manual Typing & Missing QR Tokens**~~: **Resolved in Chunk 8**. Dine-in tables assigned cryptographic tokens, verified atomically upon customer scan, and locked during checkout.
8. ~~**Client-Trust Price Vulnerability & Duplicate Submissions**~~: **Resolved in Chunk 9**. Atomic `place_order` stored procedure with server price authority, anti-tampering rejection, idempotency key deduplication, rate limiting, and gap-free numbering.
9. ~~**Unsanitized Public Order Access & Untracked Customer Experience**~~: **Resolved in Chunk 10**. Public `get_customer_order` RPC with live 4-step progress stepper, localStorage cart persistence, bilingual checkout with Zod validation, and automatic post-order redirect.
10. ~~**Arbitrary Order Status Mutation & Missing Waiter Verification**~~: **Resolved in Chunk 11**. Database-level state machine trigger strictly enforces allowed order transitions and blocks illegal mutations with `P0001`. Waiter verification records `verified_by`, sets timestamps, and logs full audit trail in `order_status_history`.
