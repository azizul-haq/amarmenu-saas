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

### Current Chunk: Ready for Chunk 3

---

## Architectural Decisions Log (ADR)
* **ADR-001 (Versioned Migrations)**: All database changes must reside in `supabase/migrations/<timestamp>_<name>.sql`. No manual un-versioned dashboard edits.
* **ADR-002 (Tenant Security)**: All tenant-scoped tables must have `restaurant_id` and strict RLS policies tied to authenticated identities.
* **ADR-003 (Currency & Format)**: Currency is BDT (`৳`), stored as `NUMERIC(10,2)`. All timestamps stored in `TIMESTAMPTZ` and formatted in `Asia/Dhaka` time.
* **ADR-004 (Phone Numbers)**: Validated against Bangladeshi mobile format (`^(\+8801|01)[3-9]\d{8}$`) and normalized to `+8801XXXXXXXXX`.
* **ADR-005 (Zero `any` Types)**: Strict TypeScript validation. Form inputs validated via Zod schemas.

---

## Inventory of `any` Types (To Be Eliminated)

Total occurrences cataloged: **26**

| # | File Path | Line | Context Snippet | Planned Elimination Chunk |
| :-: | :--- | :-: | :--- | :--- |
| 1 | `src/pages/admin/Dashboard.tsx` | 25 | `const [admin, setAdmin] = useState<any>(null);` | Admin Auth / State Refactor |
| 2 | `src/pages/admin/LoginPage.tsx` | 71 | `} catch (err: any) {` | Error Handling Refactor |
| 3 | `src/pages/admin/PendingRequests.tsx` | 41 | `const [credentials, setCredentials] = useState<any>(null);` | Admin Types Cleanup |
| 4 | `src/pages/admin/PendingRequests.tsx` | 257 | `onSuccess: (credentials: any) => void;` | Admin Types Cleanup |
| 5 | `src/pages/admin/PendingRequests.tsx` | 529 | `credentials: any;` | Admin Types Cleanup |
| 6 | `src/pages/customer/CustomerMenu.tsx` | 37 | `const [restaurant, setRestaurant] = useState<any>(null);` | Customer Menu Types |
| 7 | `src/pages/customer/CustomerMenu.tsx` | 101 | `selectedSize?: any,` | Menu Item / Cart Types |
| 8 | `src/pages/customer/CustomerMenu.tsx` | 102 | `selectedAddons: any[] = []` | Menu Item / Cart Types |
| 9 | `src/pages/customer/CustomerMenu.tsx` | 531 | `onAdd: (item: MenuItem, selectedSize?: any, selectedAddons?: any[]) => void;` | Menu Item / Cart Types |
| 10 | `src/pages/customer/CustomerMenu.tsx` | 540 | `const [selectedSize, setSelectedSize] = useState<any>(null);` | Menu Item / Cart Types |
| 11 | `src/pages/customer/CustomerMenu.tsx` | 541 | `const [selectedAddons, setSelectedAddons] = useState<any[]>([]);` | Menu Item / Cart Types |
| 12 | `src/pages/customer/CustomerMenu.tsx` | 551 | `const toggleAddon = (addon: any) => {` | Menu Item / Cart Types |
| 13 | `src/pages/public/LoginPage.tsx` | 116 | `} catch (err: any) {` | Error Handling Refactor |
| 14 | `src/pages/public/RegisterPage.tsx` | 120 | `} catch (err: any) {` | Error Handling Refactor |
| 15 | `src/pages/restaurant/Dashboard.tsx` | 27 | `const [user, setUser] = useState<any>(null);` | Restaurant Auth / State Refactor |
| 16 | `src/pages/restaurant/Dashboard.tsx` | 28 | `const [restaurant, setRestaurant] = useState<any>(null);` | Restaurant Auth / State Refactor |
| 17 | `src/pages/restaurant/Orders.tsx` | 83 | `const variants: Record<string, any> = {` | Order Management Types |
| 18 | `src/pages/restaurant/Orders.tsx` | 409 | `{order.items?.map((item: any, index: number) => (` | Order Management Types |
| 19 | `src/pages/restaurant/Reports.tsx` | 76 | `order.items?.forEach((item: any) => {` | Reports & Analytics Types |
| 20 | `src/pages/restaurant/Reports.tsx` | 299 | `label={(entry: any) =>` | Reports & Analytics Types |
| 21 | `src/pages/restaurant/RestaurantHome.tsx` | 8 | `const [stats, setStats] = useState<any>(null);` | Dashboard Stats Types |
| 22 | `src/pages/restaurant/RestaurantHome.tsx` | 132 | `{stats.recentOrders.slice(0, 5).map((order: any) => (` | Dashboard Stats Types |
| 23 | `src/services/adminService.ts` | 119 | `} catch (error: any) {` | Service Layer Types |
| 24 | `src/services/restaurantService.ts` | 56 | `const updateData: any = { status };` | Service Layer Types |
| 25 | `src/utils/helpers.ts` | 50 | `export const calculateOrderTotals = (items: any[]) => {` | Helper Functions Types |
| 26 | `src/utils/helpers.ts` | 120 | `export const debounce = <T extends (...args: any[]) => any>(` | Helper Functions Types |

---

## Known Issues & Technical Debt (Outside Current Scope)
The following issues were identified during code inspection and are logged for resolution in upcoming chunks:
1. **Client-side Password Hashing**: `src/utils/helpers.ts` uses SHA-256 via `crypto-js` and stores passwords in custom tables instead of Supabase Auth with bcrypt.
2. **Session Storage Insecurity**: Sessions are serialized into plain `localStorage` without JWT expiry or token refresh mechanisms.
3. **Missing Route Guards**: `/admin/*` and `/restaurant/*` routes do not have middleware or component wrappers to prevent unauthenticated access.
4. **Indian Currency & Phone Format Defaults**: `src/config/config.ts` and `src/utils/helpers.ts` currently reference Indian Rupee (`₹`) and Indian phone numbers (`^[6-9]\d{9}$`).
5. **Blanket RLS Policies**: Database RLS currently permits open reads/writes (`USING (true)`). Must be tightened to tenant-specific policies.
6. **No Form Validation Schemas**: Registration, login, and item creation lack runtime validation with Zod.
