import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Initialize Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
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
  subscription_plan: "free_trial" | "starter" | "pro" | "enterprise";
  status: "active" | "blocked" | "trial";
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
  order_type: "qr" | "counter" | "phone" | "table";
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

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  name?: string;
  created_at: string;
}
