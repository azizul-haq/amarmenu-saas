import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Cached tab storage key in memory for this module instance
let cachedTabKey: string | null = null;

// Ensure each browser tab has a unique session storage key so multi-tab / incognito sessions never overwrite each other,
// while strictly persisting across F5 page reloads in the same tab.
export const getTabStorageKey = (): string => {
  if (cachedTabKey) return cachedTabKey;
  if (typeof window === "undefined") return "amarmenu_auth_default";
  try {
    // 1. Strictly read existing tab ID from sessionStorage FIRST (persists across F5 in same tab)
    let tabId = window.sessionStorage.getItem("amarmenu_tab_id");

    // 2. Secondary fallback: check window.name if sessionStorage was briefly unavailable
    if (!tabId && typeof window.name === "string" && window.name.startsWith("amarmenu_tab_")) {
      tabId = window.name.replace("amarmenu_tab_", "");
      window.sessionStorage.setItem("amarmenu_tab_id", tabId);
    }

    // 3. Only generate a fresh tabId if none exists (completely new tab)
    if (!tabId || tabId.trim() === "") {
      tabId = "tab_" + Math.random().toString(36).substring(2, 10);
      window.sessionStorage.setItem("amarmenu_tab_id", tabId);
      try {
        window.name = `amarmenu_tab_${tabId}`;
      } catch {
        // ignore
      }
    }

    cachedTabKey = `amarmenu_auth_${tabId}`;
    return cachedTabKey;
  } catch {
    return "amarmenu_auth_fallback";
  }
};

// Initialize Supabase client strictly scoped to window.sessionStorage with per-tab storageKey
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
    storageKey: getTabStorageKey(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: async (_name, _acquireTimeout, fn) => await fn(),
  },
});

// Database types
export interface RegistrationRequest {
  id: string;
  restaurant_name: string;
  owner_name: string;
  phone: string;
  email?: string;
  city: string;
  address?: string;
  restaurant_type: string;
  heard_from?: string;
  notes?: string;
  status: "pending" | "contacted" | "verified" | "rejected";
  contacted_at?: string;
  rejection_reason?: string;
  internal_notes?: string;
  created_at: string;
}

export interface Restaurant {
  id: string;
  registration_request_id?: string;
  name: string;
  name_bn?: string;
  slug: string;
  owner_name?: string;
  phone: string;
  email: string;
  city?: string;
  address?: string;
  restaurant_type?: string;
  logo_url?: string;
  qr_code_url?: string;
  trade_license_no?: string;
  vat_bin_no?: string;
  default_vat_rate?: number;
  service_charge_rate?: number;
  currency?: string;
  currency_symbol?: string;
  subscription_plan: "free_trial" | "starter" | "pro" | "growth" | "enterprise";
  status: "active" | "blocked" | "trial" | "suspended";
  is_active: boolean;
  internal_notes?: string;
  block_reason?: string;
  trial_ends_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RestaurantStaff {
  id: string;
  auth_user_id?: string | null;
  restaurant_id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  role: "owner" | "manager" | "cashier" | "kitchen" | "waiter";
  manager_pin_hash?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformAdmin {
  id: string;
  auth_user_id?: string | null;
  email: string;
  full_name: string;
  role: "super_admin" | "support_agent" | "billing_admin";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  name: "starter" | "growth" | "enterprise" | string;
  display_name: string;
  description?: string | null;
  price_monthly: number;
  price_yearly: number;
  max_tables?: number | null;
  max_staff?: number | null;
  features: string[];
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  restaurant_id: string;
  plan_id?: string | null;
  plan_code: string;
  billing_cycle: "monthly" | "yearly";
  amount: number;
  status: "trial" | "active" | "grace_period" | "suspended" | "cancelled";
  trial_ends_at?: string | null;
  current_period_start: string;
  current_period_end: string;
  payment_method?: string | null;
  last_payment_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  restaurant_id?: string;
  email: string;
  password_hash: string;
  temp_password: boolean;
  role: "owner" | "staff";
  created_at: string;
}

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  name_bn?: string | null;
  display_order: number;
  is_active: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id?: string | null;
  category?: string;
  name: string;
  name_bn?: string | null;
  description?: string | null;
  description_bn?: string | null;
  base_price: number;
  image_url?: string | null;
  is_available: boolean;
  is_featured?: boolean;
  sizes?: { name: string; name_bn?: string; price: number }[];
  addons?: { name: string; name_bn?: string; price: number }[];
  tags?: string[];
  prep_time_minutes?: number | null;
  display_order?: number;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  table_number: string;
  capacity: number;
  qr_token: string;
  status?: "available" | "occupied" | "reserved";
  is_active: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  table_id?: string | null;
  order_number: string;
  invoice_number?: string | null;
  tendered_amount?: number | null;
  change_amount?: number | null;
  order_type: "dine_in" | "takeaway" | "qr" | "counter" | "phone" | "table";
  waiter_name?: string | null;
  accepted_by_name?: string | null;
  table_number?: string;
  customer_name?: string;
  customer_phone?: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  status:
    | "pending"
    | "accepted"
    | "preparing"
    | "ready"
    | "served"
    | "completed"
    | "cancelled"
    | "rejected";
  payment_method?: string;
  payment_status?: string;
  payment_transaction_id?: string;
  customer_notes?: string;
  internal_notes?: string;
  cancellation_reason?: string | null;
  rejection_reason?: string | null;
  verified_by?: string | null;
  last_updated_by?: string | null;
  kot_printed_at?: string | null;
  kot_print_count?: number;
  accepted_at?: string;
  preparing_at?: string;
  ready_at?: string;
  served_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface OrderItem {
  menu_item_id: string;
  name: string;
  quantity: number;
  base_price: number;
  selected_size?: { name: string; price: number };
  selected_addons?: { name: string; price: number }[];
  item_total: number;
  special_instructions?: string;
}

export interface OrderItemRecord {
  id: string;
  order_id: string;
  restaurant_id: string;
  menu_item_id?: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  size_name?: string | null;
  size_price: number;
  addons?: { name: string; price: number }[];
  addons_price: number;
  item_total: number;
  special_instructions?: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  restaurant_id: string;
  order_id: string;
  payment_method: "cash" | "card" | "bkash" | "nagad" | "other" | string;
  amount: number;
  tendered_amount: number;
  change_amount: number;
  status: "paid" | "refunded" | "failed";
  collected_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  name?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  restaurant_id: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  action: "void_order" | "void_item" | "apply_discount" | "waive_bill" | string;
  entity_type: "order" | "payment" | "order_item" | string;
  entity_id: string;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  reason: string;
  manager_id?: string | null;
  created_at: string;
}

export interface CashShift {
  id: string;
  restaurant_id: string;
  opened_by?: string | null;
  closed_by?: string | null;
  status: "open" | "closed";
  opening_float: number;
  opening_time: string;
  closing_time?: string | null;
  closing_count?: number | null;
  expected_cash?: number | null;
  discrepancy?: number | null;
  total_sales?: number;
  cash_sales?: number;
  digital_sales?: number;
  tax_collected?: number;
  discount_total?: number;
  total_orders?: number;
  voided_orders?: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ZReportData {
  success: boolean;
  z_report_number: string;
  shift_id: string;
  status: "closed";
  restaurant: {
    id: string;
    name: string;
    name_bn?: string;
    phone?: string;
    address?: string;
    vat_bin_no?: string;
    trade_license_no?: string;
    logo_url?: string;
  };
  timings: {
    opened_at: string;
    closed_at: string;
    opened_by: string;
    closed_by: string;
  };
  cash_reconciliation: {
    opening_float: number;
    cash_sales: number;
    expected_cash: number;
    actual_cash_counted: number;
    discrepancy: number;
    is_balanced: boolean;
    has_shortage: boolean;
    has_overage: boolean;
  };
  sales_summary: {
    gross_sales: number;
    cash_sales: number;
    digital_sales: number;
    bkash_sales: number;
    nagad_sales: number;
    card_sales: number;
    tax_collected: number;
    discount_total: number;
    completed_orders_count: number;
    dine_in_orders_count: number;
    takeaway_orders_count: number;
    voided_orders_count: number;
  };
  notes?: string | null;
}

export interface StaffActivityLog {
  id: string;
  restaurant_id: string;
  actor_user_id?: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface OnlinePaymentSession {
  id: string;
  tran_id: string;
  session_id: string;
  order_id: string;
  restaurant_id: string;
  gateway: "bkash" | "sslcommerz" | "nagad";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "cancelled" | "expired";
  gateway_trx_id?: string | null;
  gateway_payment_id?: string | null;
  val_id?: string | null;
  customer_phone?: string | null;
  metadata?: Record<string, unknown> | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

