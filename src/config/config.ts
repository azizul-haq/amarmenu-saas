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
      staff: "3 Staff Accounts",
      features: [
        "Up to 15 tables",
        "3 Staff Accounts (1 Owner + 2)",
        "QR menu ordering",
        "Kitchen Display (Basic)",
        "1 Thermal KOT print sync",
        "Daily sales summary",
        "Cash payment only",
        "Email support (48hr)",
      ],
      freeTrialDays: 14,
    },
    growth: {
      name: "Growth",
      code: "growth",
      price: 2999,
      priceYearly: 28788,
      duration: "month",
      tables: "Unlimited tables",
      staff: "10 Staff Accounts",
      popular: true,
      features: [
        "Unlimited tables",
        "10 Staff Accounts",
        "QR ordering + Waiter App",
        "Full KDS + audio alerts",
        "2 Thermal KOT printers sync",
        "Full sales analytics & trends",
        "200 SMS alerts/month included",
        "Cash + bKash / Nagad payments",
        "NBR VAT (Mushak-6.3) invoice",
        "WhatsApp priority support (12hr)",
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
        "Unlimited tables & multi-branch",
        "Unlimited Staff Accounts",
        "Full KDS & unlimited printers",
        "Custom financial & inventory reports",
        "500 SMS alerts/month",
        "All payment gateways (bKash/Nagad/Cards)",
        "Multi-branch centralized management",
        "Dedicated phone support (3hr SLA)",
        "Data export (CSV + API)",
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
