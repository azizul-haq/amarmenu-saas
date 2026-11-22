import React from "react";
import {
  Crown,
  ClipboardList,
  Receipt,
  ChefHat,
  ConciergeBell,
  ShieldCheck,
  User,
} from "lucide-react";
import type { UserRole } from "../../context/AuthContext";

export interface RoleConfig {
  role: string;
  label: string;
  title: string;
  icon: React.ElementType;
  accentHex: string;
  textColor: string;
  badgeBg: string;
  badgeBorder: string;
  dotColor: string;
  watermarkColor: string;
  gradientWash: string;
  pageBgGradient: string;
  brandBadgeGrad: string;
  navActiveGrad: string;
  topBorderAccent: string;
}

export const ROLE_CONFIGS: Record<string, RoleConfig> = {
  owner: {
    role: "owner",
    label: "Owner",
    title: "Executive Owner Panel",
    icon: Crown,
    accentHex: "#7c3aed",
    textColor: "text-purple-700",
    badgeBg: "bg-purple-50",
    badgeBorder: "border-purple-200",
    dotColor: "bg-purple-600",
    watermarkColor: "text-purple-600",
    gradientWash: "bg-gradient-to-tl from-purple-500/25 via-indigo-500/10 to-transparent",
    pageBgGradient: "bg-gradient-to-br from-purple-50/90 via-indigo-50/50 to-white",
    brandBadgeGrad: "from-purple-600 to-indigo-600 shadow-purple-900/30",
    navActiveGrad: "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-950/40",
    topBorderAccent: "border-t-4 border-t-purple-600",
  },
  manager: {
    role: "manager",
    label: "Manager",
    title: "Operations Manager",
    icon: ClipboardList,
    accentHex: "#2563eb",
    textColor: "text-blue-700",
    badgeBg: "bg-blue-50",
    badgeBorder: "border-blue-200",
    dotColor: "bg-blue-600",
    watermarkColor: "text-blue-600",
    gradientWash: "bg-gradient-to-tl from-blue-500/25 via-sky-500/10 to-transparent",
    pageBgGradient: "bg-gradient-to-br from-blue-50/90 via-sky-50/50 to-white",
    brandBadgeGrad: "from-blue-600 to-sky-600 shadow-blue-900/30",
    navActiveGrad: "bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md shadow-blue-950/40",
    topBorderAccent: "border-t-4 border-t-blue-600",
  },
  cashier: {
    role: "cashier",
    label: "Cashier",
    title: "Cashier POS & Billing",
    icon: Receipt,
    accentHex: "#059669",
    textColor: "text-emerald-700",
    badgeBg: "bg-emerald-50",
    badgeBorder: "border-emerald-200",
    dotColor: "bg-emerald-600",
    watermarkColor: "text-emerald-600",
    gradientWash: "bg-gradient-to-tl from-emerald-500/25 via-teal-500/10 to-transparent",
    pageBgGradient: "bg-gradient-to-br from-emerald-50/90 via-teal-50/40 to-white",
    brandBadgeGrad: "from-emerald-600 to-teal-600 shadow-emerald-900/30",
    navActiveGrad: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-950/40",
    topBorderAccent: "border-t-4 border-t-emerald-600",
  },
  kitchen: {
    role: "kitchen",
    label: "Kitchen Chef",
    title: "Kitchen Display (KDS)",
    icon: ChefHat,
    accentHex: "#ea580c",
    textColor: "text-orange-700",
    badgeBg: "bg-orange-50",
    badgeBorder: "border-orange-200",
    dotColor: "bg-orange-600",
    watermarkColor: "text-orange-600",
    gradientWash: "bg-gradient-to-tl from-orange-500/25 via-amber-500/10 to-transparent",
    pageBgGradient: "bg-gradient-to-br from-orange-50/90 via-amber-50/50 to-white",
    brandBadgeGrad: "from-orange-600 to-amber-500 shadow-orange-900/30",
    navActiveGrad: "bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-md shadow-orange-950/40",
    topBorderAccent: "border-t-4 border-t-orange-600",
  },
  waiter: {
    role: "waiter",
    label: "Waiter",
    title: "Waiter Table Service",
    icon: ConciergeBell,
    accentHex: "#0d9488",
    textColor: "text-teal-700",
    badgeBg: "bg-teal-50",
    badgeBorder: "border-teal-200",
    dotColor: "bg-teal-600",
    watermarkColor: "text-teal-600",
    gradientWash: "bg-gradient-to-tl from-teal-500/25 via-cyan-500/10 to-transparent",
    pageBgGradient: "bg-gradient-to-br from-teal-50/90 via-cyan-50/50 to-white",
    brandBadgeGrad: "from-teal-600 to-cyan-600 shadow-teal-900/30",
    navActiveGrad: "bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow-md shadow-teal-950/40",
    topBorderAccent: "border-t-4 border-t-teal-600",
  },
  super_admin: {
    role: "super_admin",
    label: "Super Admin",
    title: "Platform Administration",
    icon: ShieldCheck,
    accentHex: "#e11d48",
    textColor: "text-rose-700",
    badgeBg: "bg-rose-50",
    badgeBorder: "border-rose-200",
    dotColor: "bg-rose-600",
    watermarkColor: "text-rose-600",
    gradientWash: "bg-gradient-to-tl from-rose-500/25 via-red-500/10 to-transparent",
    pageBgGradient: "bg-gradient-to-br from-rose-50/90 via-pink-50/50 to-white",
    brandBadgeGrad: "from-rose-600 to-pink-600 shadow-rose-900/30",
    navActiveGrad: "bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-md shadow-rose-950/40",
    topBorderAccent: "border-t-4 border-t-rose-600",
  },
};

const DEFAULT_CONFIG: RoleConfig = {
  role: "staff",
  label: "Staff",
  title: "Restaurant Staff Hub",
  icon: User,
  accentHex: "#475569",
  textColor: "text-slate-700",
  badgeBg: "bg-slate-100",
  badgeBorder: "border-slate-300",
  dotColor: "bg-slate-600",
  watermarkColor: "text-slate-500",
  gradientWash: "bg-gradient-to-tl from-slate-500/20 to-transparent",
  pageBgGradient: "bg-gradient-to-br from-slate-50 via-slate-100/50 to-white",
  brandBadgeGrad: "from-slate-700 to-slate-900 shadow-slate-900/30",
  navActiveGrad: "bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-md shadow-slate-950/40",
  topBorderAccent: "border-t-4 border-t-slate-600",
};

export const getRoleConfig = (role: UserRole | string | undefined | null): RoleConfig => {
  if (!role) return DEFAULT_CONFIG;
  return ROLE_CONFIGS[role.toLowerCase().trim()] || DEFAULT_CONFIG;
};

/**
 * Crisp header / sidebar pill displaying the active user's role
 */
export const RoleBadge: React.FC<{
  role: UserRole | string | undefined | null;
  compact?: boolean;
  className?: string;
}> = ({ role, compact = false, className = "" }) => {
  const config = getRoleConfig(role);
  const Icon = config.icon;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${config.badgeBg} ${config.textColor} border ${config.badgeBorder} shadow-2xs ${className}`}
        title={config.title}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor} mr-1.5 animate-pulse`} />
        <Icon className="w-3 h-3 mr-1 flex-shrink-0" />
        <span className="capitalize">{config.label}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${config.badgeBg} ${config.textColor} border ${config.badgeBorder} shadow-2xs ${className}`}
      title={config.title}
    >
      <span className={`w-2 h-2 rounded-full ${config.dotColor} mr-2 animate-pulse`} />
      <Icon className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
      <span>{config.title}</span>
    </span>
  );
};

/**
 * Projector-friendly, clearly visible role-specific background illustration.
 * Features:
 * 1. Opacity ~0.18 (clearly visible on presentations, yet sits cleanly behind white cards)
 * 2. Role-specific rich multi-tone vector fills & strokes in actual accent colors
 * 3. Soft ambient gradient wash in bottom-right corner for depth
 */
export const RoleWatermark: React.FC<{
  role: UserRole | string | undefined | null;
}> = ({ role }) => {
  const config = getRoleConfig(role);
  const normalizedRole = (role || "").toLowerCase().trim();

  return (
    <>
      {/* Subtle Role-Tinted Ambient Gradient Wash in Bottom-Right Corner */}
      <div
        aria-hidden="true"
        className={`fixed -bottom-16 -right-16 w-80 h-80 sm:w-[480px] sm:h-[480px] lg:w-[580px] lg:h-[580px] pointer-events-none select-none z-0 rounded-full blur-3xl opacity-40 transition-all duration-700 ${config.gradientWash}`}
      />

      {/* Role-Specific Background Watermark Illustration */}
      <div
        aria-hidden="true"
        className={`fixed bottom-4 right-4 sm:bottom-8 sm:right-8 w-72 h-72 sm:w-96 sm:h-96 lg:w-[480px] lg:h-[480px] pointer-events-none select-none z-0 opacity-[0.18] transition-all duration-500`}
      >
        {normalizedRole === "owner" && (
          // Owner: Purple/Indigo Majestic Crown + Storefront + Growth Bars
          <svg
            viewBox="0 0 400 400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full text-purple-600"
          >
            <defs>
              <linearGradient id="ownerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
              </linearGradient>
              <linearGradient id="ownerBarGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0.25" />
              </linearGradient>
            </defs>

            {/* Majestic Crown */}
            <path
              d="M 80 140 L 110 60 L 160 110 L 200 40 L 240 110 L 290 60 L 320 140 Z"
              fill="url(#ownerGrad)"
              stroke="#7c3aed"
              strokeWidth="7"
            />
            {/* Crown Jewels */}
            <circle cx="110" cy="55" r="9" fill="#9333ea" stroke="#7c3aed" strokeWidth="4" />
            <circle cx="200" cy="35" r="11" fill="#a855f7" stroke="#7c3aed" strokeWidth="4" />
            <circle cx="290" cy="55" r="9" fill="#9333ea" stroke="#7c3aed" strokeWidth="4" />
            <circle cx="160" cy="110" r="6" fill="#c084fc" />
            <circle cx="240" cy="110" r="6" fill="#c084fc" />
            <line x1="80" y1="140" x2="320" y2="140" stroke="#7c3aed" strokeWidth="9" />

            {/* Restaurant Storefront Structure */}
            <rect x="70" y="160" width="260" height="22" rx="4" fill="#6366f1" fillOpacity="0.3" stroke="#4f46e5" strokeWidth="6" />
            {/* Awning stripes */}
            <path
              d="M 70 182 Q 96 215 122 182 Q 148 215 174 182 Q 200 215 226 182 Q 252 215 278 182 Q 304 215 330 182"
              stroke="#6366f1"
              strokeWidth="7"
              fill="#818cf8"
              fillOpacity="0.2"
            />
            {/* Storefront Pillars */}
            <line x1="90" y1="182" x2="90" y2="340" stroke="#7c3aed" strokeWidth="9" />
            <line x1="310" y1="182" x2="310" y2="340" stroke="#7c3aed" strokeWidth="9" />
            <line x1="60" y1="340" x2="340" y2="340" stroke="#4f46e5" strokeWidth="11" />

            {/* Analytics Bars inside store */}
            <rect x="130" y="270" width="22" height="70" rx="4" fill="url(#ownerBarGrad)" stroke="#7c3aed" strokeWidth="4" />
            <rect x="165" y="240" width="22" height="100" rx="4" fill="url(#ownerBarGrad)" stroke="#7c3aed" strokeWidth="4" />
            <rect x="200" y="210" width="22" height="130" rx="4" fill="url(#ownerBarGrad)" stroke="#7c3aed" strokeWidth="4" />
            <rect x="235" y="180" width="22" height="160" rx="4" fill="url(#ownerBarGrad)" stroke="#7c3aed" strokeWidth="4" />

            {/* Upward Growth Arrow */}
            <polyline points="120,280 160,230 200,200 250,150" stroke="#9333ea" strokeWidth="9" />
            <polyline points="220,150 250,150 250,180" stroke="#9333ea" strokeWidth="9" />

            {/* Sparkles */}
            <path d="M 340 100 L 346 116 L 362 120 L 346 124 L 340 140 L 334 124 L 318 120 L 334 116 Z" fill="#a855f7" />
            <path d="M 60 90 L 64 102 L 76 105 L 64 108 L 60 120 L 56 108 L 44 105 L 56 102 Z" fill="#c084fc" />
          </svg>
        )}

        {normalizedRole === "manager" && (
          // Manager: Blue Operations Clipboard + Bar Chart + Settings Gear
          <svg
            viewBox="0 0 400 400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full text-blue-600"
          >
            <defs>
              <linearGradient id="mgrGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* Clipboard board */}
            <rect x="80" y="60" width="240" height="310" rx="16" fill="url(#mgrGrad)" stroke="#2563eb" strokeWidth="7" />
            {/* Top Clip */}
            <rect x="150" y="40" width="100" height="40" rx="8" fill="#1d4ed8" fillOpacity="0.4" stroke="#1e40af" strokeWidth="7" />
            <circle cx="200" cy="55" r="7" fill="#60a5fa" stroke="#1d4ed8" strokeWidth="3" />

            {/* Checklist rows with green-blue checks */}
            <rect x="120" y="110" width="24" height="24" rx="4" stroke="#2563eb" strokeWidth="5" fill="#3b82f6" fillOpacity="0.2" />
            <polyline points="124,122 130,128 140,116" stroke="#2563eb" strokeWidth="6" />
            <line x1="160" y1="122" x2="270" y2="122" stroke="#2563eb" strokeWidth="7" />

            <rect x="120" y="150" width="24" height="24" rx="4" stroke="#2563eb" strokeWidth="5" fill="#3b82f6" fillOpacity="0.2" />
            <polyline points="124,162 130,168 140,156" stroke="#2563eb" strokeWidth="6" />
            <line x1="160" y1="162" x2="250" y2="162" stroke="#2563eb" strokeWidth="7" />

            <rect x="120" y="190" width="24" height="24" rx="4" stroke="#2563eb" strokeWidth="5" fill="#3b82f6" fillOpacity="0.2" />
            <polyline points="124,202 130,208 140,196" stroke="#2563eb" strokeWidth="6" />
            <line x1="160" y1="202" x2="280" y2="202" stroke="#2563eb" strokeWidth="7" />

            {/* Operational Metrics Chart inside clipboard */}
            <line x1="120" y1="330" x2="280" y2="330" stroke="#1e40af" strokeWidth="7" />
            <rect x="135" y="270" width="24" height="60" rx="3" fill="#60a5fa" fillOpacity="0.45" stroke="#2563eb" strokeWidth="4" />
            <rect x="175" y="240" width="24" height="90" rx="3" fill="#3b82f6" fillOpacity="0.45" stroke="#2563eb" strokeWidth="4" />
            <rect x="215" y="220" width="24" height="110" rx="3" fill="#2563eb" fillOpacity="0.55" stroke="#1d4ed8" strokeWidth="4" />
            <rect x="255" y="250" width="24" height="80" rx="3" fill="#60a5fa" fillOpacity="0.45" stroke="#2563eb" strokeWidth="4" />

            {/* Gear Cog in upper corner */}
            <circle cx="310" cy="90" r="24" stroke="#1d4ed8" strokeWidth="7" fill="#3b82f6" fillOpacity="0.3" />
            <circle cx="310" cy="90" r="10" stroke="#1d4ed8" strokeWidth="5" fill="#93c5fd" />
            <line x1="310" y1="60" x2="310" y2="68" stroke="#1d4ed8" strokeWidth="7" />
            <line x1="310" y1="112" x2="310" y2="120" stroke="#1d4ed8" strokeWidth="7" />
            <line x1="280" y1="90" x2="288" y2="90" stroke="#1d4ed8" strokeWidth="7" />
            <line x1="332" y1="90" x2="340" y2="90" stroke="#1d4ed8" strokeWidth="7" />
          </svg>
        )}

        {normalizedRole === "cashier" && (
          // Cashier: Emerald POS Register + Streaming Receipt + Currency
          <svg
            viewBox="0 0 400 400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full text-emerald-600"
          >
            <defs>
              <linearGradient id="posScreen" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* POS Monitor Screen Outer */}
            <rect x="70" y="80" width="220" height="150" rx="12" fill="url(#posScreen)" stroke="#059669" strokeWidth="8" />
            <rect x="90" y="100" width="180" height="100" rx="6" stroke="#047857" strokeWidth="5" fill="#065f46" fillOpacity="0.25" />

            {/* Screen Content - Total Display */}
            <text x="105" y="142" fill="#047857" stroke="none" fontSize="24" fontWeight="bold" fontFamily="monospace">
              ৳ 2,450.00
            </text>
            <line x1="105" y1="162" x2="205" y2="162" stroke="#059669" strokeWidth="5" />
            <line x1="105" y1="178" x2="165" y2="178" stroke="#10b981" strokeWidth="5" />

            {/* Stand Pole & Swivel */}
            <path d="M 160 230 L 150 280 L 210 280 L 200 230" fill="#047857" fillOpacity="0.3" stroke="#059669" strokeWidth="6" />

            {/* Heavy Cash Drawer Base */}
            <rect x="50" y="280" width="260" height="70" rx="10" fill="#047857" fillOpacity="0.25" stroke="#059669" strokeWidth="8" />
            <line x1="50" y1="315" x2="310" y2="315" stroke="#047857" strokeWidth="6" />
            <circle cx="180" cy="335" r="6" fill="#34d399" stroke="#059669" strokeWidth="4" />
            <rect x="230" y="325" width="40" height="18" rx="3" stroke="#059669" strokeWidth="4" fill="#10b981" fillOpacity="0.4" />

            {/* Long Curving Receipt Tape */}
            <path
              d="M 270 120 L 332 120 L 332 320 L 322 310 L 312 320 L 302 310 L 292 320 L 282 310 L 270 320 Z"
              fill="#ecfdf5"
              fillOpacity="0.6"
              stroke="#059669"
              strokeWidth="6"
            />
            {/* Lines on receipt */}
            <line x1="282" y1="150" x2="320" y2="150" stroke="#047857" strokeWidth="4" />
            <line x1="282" y1="170" x2="320" y2="170" stroke="#047857" strokeWidth="4" />
            <line x1="282" y1="190" x2="312" y2="190" stroke="#047857" strokeWidth="4" />
            <line x1="282" y1="220" x2="320" y2="220" stroke="#059669" strokeWidth="6" />
            {/* Barcode on receipt */}
            <line x1="282" y1="260" x2="282" y2="288" stroke="#047857" strokeWidth="5" />
            <line x1="289" y1="260" x2="289" y2="288" stroke="#047857" strokeWidth="2" />
            <line x1="296" y1="260" x2="296" y2="288" stroke="#047857" strokeWidth="6" />
            <line x1="305" y1="260" x2="305" y2="288" stroke="#047857" strokeWidth="3" />
            <line x1="314" y1="260" x2="314" y2="288" stroke="#047857" strokeWidth="5" />
            <line x1="320" y1="260" x2="320" y2="288" stroke="#047857" strokeWidth="2" />
          </svg>
        )}

        {normalizedRole === "kitchen" && (
          // Kitchen: Orange/Red Chef Hat + Sauté Pan + Dancing Culinary Flame
          <svg
            viewBox="0 0 400 400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full text-orange-600"
          >
            <defs>
              <linearGradient id="flameGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6" />
                <stop offset="50%" stopColor="#f97316" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.4" />
              </linearGradient>
              <linearGradient id="hatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ea580c" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#fb923c" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* Chef Hat Puffs */}
            <path
              d="M 120 180 C 80 180 80 110 120 100 C 120 50 190 40 200 80 C 220 30 290 50 280 100 C 320 110 320 180 280 180 Z"
              fill="url(#hatGrad)"
              stroke="#ea580c"
              strokeWidth="8"
            />
            {/* Hat Pleats */}
            <path d="M 155 105 L 155 180" stroke="#ea580c" strokeWidth="5" />
            <path d="M 200 85 L 200 180" stroke="#ea580c" strokeWidth="5" />
            <path d="M 245 105 L 245 180" stroke="#ea580c" strokeWidth="5" />
            {/* Hat Band */}
            <rect x="110" y="180" width="180" height="35" rx="6" fill="#f97316" fillOpacity="0.35" stroke="#ea580c" strokeWidth="7" />

            {/* Dancing Culinary Fire Flame */}
            <path
              d="M 200 235 C 235 268 245 310 200 342 C 155 310 165 268 200 235 Z"
              fill="url(#flameGrad)"
              stroke="#ef4444"
              strokeWidth="6"
            />
            <path
              d="M 200 270 C 218 292 222 315 200 332 C 178 315 182 292 200 270 Z"
              fill="#fbbf24"
              fillOpacity="0.75"
              stroke="#f97316"
              strokeWidth="4"
            />

            {/* Heavy Cooking Sauté Pan with Long Handle */}
            <path d="M 110 310 C 110 354 290 354 290 310 Z" fill="#c2410c" fillOpacity="0.25" stroke="#ea580c" strokeWidth="8" />
            <line x1="290" y1="322" x2="365" y2="348" stroke="#9a3412" strokeWidth="11" />

            {/* Crossed Utensils Knife & Spatula in background */}
            <line x1="75" y1="75" x2="140" y2="140" stroke="#f97316" strokeWidth="6" strokeDasharray="8 6" />
            <line x1="325" y1="75" x2="260" y2="140" stroke="#f97316" strokeWidth="6" strokeDasharray="8 6" />
          </svg>
        )}

        {normalizedRole === "waiter" && (
          // Waiter: Teal/Cyan Cloche Food Platter + Steam Aroma Plumes
          <svg
            viewBox="0 0 400 400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full text-teal-600"
          >
            <defs>
              <linearGradient id="clocheGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0d9488" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* Cloche Top Handle Knob */}
            <circle cx="200" cy="118" r="15" fill="#14b8a6" fillOpacity="0.5" stroke="#0d9488" strokeWidth="7" />
            <path d="M 193 133 L 193 150 L 207 150 L 207 133" fill="#0d9488" />

            {/* Cloche Dome Cover */}
            <path
              d="M 80 270 C 80 155 320 155 320 270 Z"
              fill="url(#clocheGrad)"
              stroke="#0d9488"
              strokeWidth="9"
            />
            {/* Dome Accent Highlight Line */}
            <path d="M 115 250 C 125 180 220 170 265 188" stroke="#5eead4" strokeWidth="6" />

            {/* Serving Platter Base Tray */}
            <ellipse cx="200" cy="275" rx="145" ry="22" fill="#0f766e" fillOpacity="0.35" stroke="#0d9488" strokeWidth="8" />
            <path d="M 55 275 C 55 298 345 298 345 275" stroke="#115e59" strokeWidth="7" />

            {/* Rising Steam Aroma Plumes */}
            <path d="M 160 98 Q 148 68 165 42 Q 180 18 170 0" stroke="#14b8a6" strokeWidth="6" />
            <path d="M 200 92 Q 216 62 200 36 Q 184 12 200 0" stroke="#06b6d4" strokeWidth="6" />
            <path d="M 240 98 Q 252 68 235 42 Q 220 18 230 0" stroke="#14b8a6" strokeWidth="6" />

            {/* Service Towel Fold Lines */}
            <path
              d="M 120 312 C 140 344 180 354 200 354 C 220 354 260 344 280 312"
              stroke="#0f766e"
              strokeWidth="7"
              strokeDasharray="8 8"
            />
            {/* Table Service Wine Glass Motif */}
            <path d="M 68 328 L 68 345 Q 68 362 85 362 L 95 362 Q 112 362 112 345 L 112 328 Z" stroke="#0d9488" strokeWidth="5" fill="#2dd4bf" fillOpacity="0.25" />
            <line x1="90" y1="362" x2="90" y2="388" stroke="#0d9488" strokeWidth="5" />
            <line x1="74" y1="388" x2="106" y2="388" stroke="#0d9488" strokeWidth="6" />
          </svg>
        )}

        {normalizedRole === "super_admin" && (
          // Super Admin: Rose/Red Security Shield + Keyhole + Server Nodes
          <svg
            viewBox="0 0 400 400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full text-rose-600"
          >
            <defs>
              <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e11d48" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.15" />
              </linearGradient>
            </defs>

            {/* Shield Outline Outer */}
            <path
              d="M 200 48 L 322 88 L 322 212 C 322 295 200 355 200 355 C 200 355 78 295 78 212 L 78 88 Z"
              fill="url(#shieldGrad)"
              stroke="#e11d48"
              strokeWidth="9"
            />
            {/* Inner Shield Accent */}
            <path
              d="M 200 80 L 295 112 L 295 205 C 295 268 200 318 200 318 C 200 318 105 268 105 205 L 105 112 Z"
              stroke="#be123c"
              strokeWidth="5"
            />
            {/* Security Keyhole */}
            <circle cx="200" cy="180" r="26" fill="#f43f5e" fillOpacity="0.5" stroke="#be123c" strokeWidth="7" />
            <polygon points="188,195 212,195 220,248 180,248" fill="#be123c" fillOpacity="0.6" stroke="#9f1239" strokeWidth="6" />
            {/* Server / Cloud Connection Nodes */}
            <circle cx="138" cy="118" r="9" fill="#e11d48" />
            <circle cx="262" cy="118" r="9" fill="#e11d48" />
            <line x1="147" y1="118" x2="253" y2="118" stroke="#f43f5e" strokeWidth="5" strokeDasharray="8 6" />
          </svg>
        )}
      </div>
    </>
  );
};
