# AmarMenu - Multi-Tenant Restaurant Ordering SaaS Platform

A modern, production-grade restaurant ordering SaaS platform with QR code ordering, real-time Kitchen Display System (KDS), multi-tenant isolation, role-based access control (RBAC), and automated fiscal billing.

## 🎯 Key Features

- **Multi-Tenant Architecture**: Complete tenant isolation across restaurants, orders, menus, and staff.
- **QR Code Table Ordering**: Dynamic table-specific QR tokens with instant invalidation upon table reset.
- **Real-Time Kitchen Display System (KDS)**: Live WebSocket updates for ticket progression (Pending → Accepted → Preparing → Ready → Completed).
- **Point of Sale (POS) & Cash Shifts**: Cash drawer float management, counter settlement, change calculation, and discrepancy reconciliation.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions across Owner, Manager, Cashier, Kitchen, Waiter, and Super Admin.
- **Bangladeshi SaaS Billing**: Automated 14-day trial provisioning, Mushak 6.3 VAT receipt compliance, bKash/Nagad manual payment verification with normalized TrxID deduplication.
- **Super Admin Command Center**: Cross-tenant GMV monitoring, restaurant lifecycle management, plan overrides, and append-only audit logging.

## 🛠 Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons
- **Backend & Database**: Supabase (PostgreSQL 15+, Row Level Security, Realtime channels, Storage)
- **Security**: PostgreSQL RLS policies, bcrypt PIN hashing, rate-limiting triggers, cryptographic token rotation
- **Reporting**: jsPDF, Canvas export, CSV formatters

## 📋 Prerequisites

- Node.js 20+ and npm
- A provisioned Supabase project (PostgreSQL database with GoTrue Auth)

## 🚀 Getting Started

### 1. Installation

```bash
git clone <repository-url>
cd restaurant-ordering-saas-main
npm install
```

### 2. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configure your environment variables in `.env`:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### 3. Database Migrations

The authoritative database schema lives strictly and solely in `supabase/migrations/` (no external `schema.sql` files). Apply the migration history using the Supabase CLI:

```bash
supabase db push
```

### 4. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:5173` to access the application.

## 📱 Application Routing

```
/                       → Public landing page & registration
/register               → Restaurant onboarding request
/login                  → Staff & Owner authentication
/set-password           → Secure invitation & recovery password onboarding

/restaurant/dashboard   → Restaurant live operational metrics
/restaurant/orders      → Live order feed & counter actions
/restaurant/menu        → Menu management & availability toggles
/restaurant/tables      → Table management & QR token generation
/restaurant/kds         → Kitchen Display System
/restaurant/shifts      → Cash drawer shifts & end-of-day Z-reports
/restaurant/reports     → Platform sales analytics & VAT summaries
/restaurant/staff       → Team member management & PIN security
/restaurant/settings    → Restaurant profile & configuration

/admin/login            → Super Admin access gate
/admin                  → Executive overview & cross-tenant KPIs
/admin/requests         → Pending restaurant registration approvals
/admin/restaurants      → Platform restaurant tenant directory
/admin/billing          → SaaS subscription invoicing & TrxID verification
/admin/plans            → Subscription plan configuration

/:slug                  → Customer digital menu & QR ordering interface
```

## 🔒 Security & Compliance

- **Zero Hardcoded Secrets**: All authentication and operational tokens are dynamically provisioned via environment variables and secure seed configurations.
- **Append-Only Auditing**: Critical operations (order voids, discounts, PIN updates, registration approvals) are recorded in immutable audit logs.
- **Strict Tenant Gating**: PostgreSQL Row Level Security enforces restaurant isolation across all client queries.

## 📄 License

MIT License.
