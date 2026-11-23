// Supabase Configuration
// Replace these with your actual Supabase project credentials
// Get them from: https://app.supabase.com/project/_/settings/api

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "YOUR_SUPABASE_URL";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY";

// Application Configuration
export const APP_CONFIG = {
  appName: "AmarMenu",
  defaultCurrency: "৳",
  taxRate: 0.05, // 5% NBR VAT (standard for restaurants in Bangladesh)
  orderPrefix: "ORD",

  // Subscription plans
  plans: {
    starter: {
      name: "Starter",
      code: "starter",
      price: 1499,
      priceYearly: 14388,
      duration: "month",
      tables: "Up to 15 tables",
      staff: "Up to 5 Staff Accounts",
      features: [
        "Up to 15 tables & 5 staff accounts",
        "Bilingual QR Menu (Bangla & English)",
        "Live Order Management & Printable Receipts",
        "Cash, bKash, Nagad & Card (SSLCommerz) Checkout",
        "Custom Restaurant Logo",
        "Daily Sales Summary & Email Support",
      ],
      freeTrialDays: 14,
    },
    growth: {
      name: "Growth",
      code: "growth",
      price: 2999,
      priceYearly: 28788,
      duration: "month",
      tables: "Up to 50 tables",
      staff: "Up to 15 Staff Accounts",
      popular: true,
      features: [
        "Up to 50 tables & 15 staff accounts",
        "Everything in Starter (including bKash, Nagad & SSLCommerz)",
        "Real-time Kitchen Display (KDS)",
        "Delivery Boy / Courier Dispatch Role",
        "NBR Mushak-6.3 VAT Receipts & Reports",
        "Cashier Shift Management & Z-Report",
        "Order Activity History",
      ],
      freeTrialDays: 14,
    },
    enterprise: {
      name: "Enterprise",
      code: "enterprise",
      price: 5999,
      priceYearly: 57588,
      duration: "month",
      tables: "Unlimited tables",
      staff: "Unlimited Staff Accounts",
      features: [
        "Unlimited tables & unlimited staff accounts",
        "Everything in Growth plan",
        "Manager PIN Void & Fraud Protection",
        "Tamper-Proof Security Audit Trail",
        "Advanced Analytics & CSV Exports",
        "Priority Onboarding & 24/7 Phone Support",
      ],
      freeTrialDays: 30,
    },
  },

  // Restaurant types
  restaurantTypes: [
    "Restaurant",
    "Food Truck",
    "Cafe",
    "Bakery",
    "Cloud Kitchen",
    "Fine Dining",
    "Quick Service",
    "Other",
  ],

  // Menu categories
  menuCategories: [
    "Starters",
    "Main Course",
    "Breakfast",
    "Lunch",
    "Dinner",
    "Beverages",
    "Desserts",
    "Snacks",
    "Other",
  ],

  // Order statuses
  orderStatuses: {
    pending: { label: "Pending", color: "warning" },
    accepted: { label: "Accepted", color: "accent-secondary" },
    preparing: { label: "Preparing", color: "accent-secondary" },
    ready: { label: "Ready", color: "success" },
    completed: { label: "Completed", color: "success" },
    cancelled: { label: "Cancelled", color: "error" },
    rejected: { label: "Rejected", color: "error" },
  },

  // Payment methods
  paymentMethods: ["Cash", "bKash", "Nagad", "Card", "Other"],

  // Registration sources
  heardFromOptions: [
    "Google Search",
    "Social Media",
    "Friend/Referral",
    "Advertisement",
    "Other",
  ],
};
