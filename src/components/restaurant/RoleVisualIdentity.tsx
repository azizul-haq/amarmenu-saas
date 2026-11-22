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
};

export const getRoleConfig = (role: UserRole | string | undefined | null): RoleConfig => {
  if (!role) return DEFAULT_CONFIG;
  return ROLE_CONFIGS[role.toLowerCase()] || DEFAULT_CONFIG;
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
 * Clean, subtle role-specific inline SVG watermark illustration.
 * Fixed in background at low opacity (0.06), pointer-events-none, never blocks clicks.
 */
export const RoleWatermark: React.FC<{
  role: UserRole | string | undefined | null;
}> = ({ role }) => {
  const config = getRoleConfig(role);
  const normalizedRole = (role || "").toLowerCase();

  return (
    <div
      aria-hidden="true"
      className={`fixed bottom-4 right-4 sm:bottom-8 sm:right-8 w-64 h-64 sm:w-80 sm:h-80 lg:w-[420px] lg:h-[420px] pointer-events-none select-none z-0 opacity-[0.06] transition-opacity duration-500 ${config.watermarkColor}`}
    >
      {normalizedRole === "owner" && (
        // Owner: Majestic Crown + Storefront + Growth Chart
        <svg
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* Crown */}
          <path d="M 80 140 L 110 60 L 160 110 L 200 40 L 240 110 L 290 60 L 320 140 Z" fill="currentColor" fillOpacity="0.15" />
          <circle cx="110" cy="55" r="7" fill="currentColor" />
          <circle cx="200" cy="35" r="9" fill="currentColor" />
          <circle cx="290" cy="55" r="7" fill="currentColor" />
          <circle cx="160" cy="110" r="5" fill="currentColor" />
          <circle cx="240" cy="110" r="5" fill="currentColor" />
          <line x1="80" y1="140" x2="320" y2="140" strokeWidth="8" />

          {/* Restaurant Storefront Structure */}
          <rect x="70" y="160" width="260" height="20" rx="4" fill="currentColor" fillOpacity="0.2" />
          {/* Awning stripes */}
          <path d="M 70 180 Q 96 210 122 180 Q 148 210 174 180 Q 200 210 226 180 Q 252 210 278 180 Q 304 210 330 180" strokeWidth="6" />
          {/* Storefront Pillars */}
          <line x1="90" y1="180" x2="90" y2="340" strokeWidth="8" />
          <line x1="310" y1="180" x2="310" y2="340" strokeWidth="8" />
          <line x1="60" y1="340" x2="340" y2="340" strokeWidth="10" />

          {/* Analytics Bars inside store */}
          <rect x="130" y="270" width="22" height="70" rx="4" fill="currentColor" fillOpacity="0.3" />
          <rect x="165" y="240" width="22" height="100" rx="4" fill="currentColor" fillOpacity="0.3" />
          <rect x="200" y="210" width="22" height="130" rx="4" fill="currentColor" fillOpacity="0.3" />
          <rect x="235" y="180" width="22" height="160" rx="4" fill="currentColor" fillOpacity="0.4" />
          {/* Upward Growth Arrow */}
          <polyline points="120,280 160,230 200,200 250,150" strokeWidth="8" />
          <polyline points="220,150 250,150 250,180" strokeWidth="8" />

          {/* Sparkles */}
          <path d="M 340 100 L 345 115 L 360 120 L 345 125 L 340 140 L 335 125 L 320 120 L 335 115 Z" fill="currentColor" />
          <path d="M 60 90 L 63 100 L 73 103 L 63 106 L 60 116 L 57 106 L 47 103 L 57 100 Z" fill="currentColor" />
        </svg>
      )}

      {normalizedRole === "manager" && (
        // Manager: Operations Clipboard + Bar Chart + Settings Gear
        <svg
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* Clipboard board */}
          <rect x="80" y="60" width="240" height="310" rx="16" fill="currentColor" fillOpacity="0.1" />
          {/* Clip */}
          <rect x="150" y="40" width="100" height="40" rx="8" fill="currentColor" fillOpacity="0.3" strokeWidth="6" />
          <circle cx="200" cy="55" r="6" fill="currentColor" />

          {/* Checklist rows */}
          <rect x="120" y="110" width="24" height="24" rx="4" />
          <polyline points="124,122 130,128 140,116" strokeWidth="5" />
          <line x1="160" y1="122" x2="270" y2="122" strokeWidth="6" />

          <rect x="120" y="150" width="24" height="24" rx="4" />
          <polyline points="124,162 130,168 140,156" strokeWidth="5" />
          <line x1="160" y1="162" x2="250" y2="162" strokeWidth="6" />

          <rect x="120" y="190" width="24" height="24" rx="4" />
          <polyline points="124,202 130,208 140,196" strokeWidth="5" />
          <line x1="160" y1="202" x2="280" y2="202" strokeWidth="6" />

          {/* Operational Metrics Chart inside clipboard */}
          <line x1="120" y1="330" x2="280" y2="330" strokeWidth="6" />
          <rect x="135" y="270" width="24" height="60" rx="3" fill="currentColor" fillOpacity="0.3" />
          <rect x="175" y="240" width="24" height="90" rx="3" fill="currentColor" fillOpacity="0.3" />
          <rect x="215" y="220" width="24" height="110" rx="3" fill="currentColor" fillOpacity="0.4" />
          <rect x="255" y="250" width="24" height="80" rx="3" fill="currentColor" fillOpacity="0.3" />

          {/* Small Gear Cog in corner */}
          <circle cx="310" cy="90" r="22" strokeWidth="6" fill="currentColor" fillOpacity="0.15" />
          <circle cx="310" cy="90" r="9" strokeWidth="5" />
          <line x1="310" y1="62" x2="310" y2="70" strokeWidth="6" />
          <line x1="310" y1="110" x2="310" y2="118" strokeWidth="6" />
          <line x1="282" y1="90" x2="290" y2="90" strokeWidth="6" />
          <line x1="330" y1="90" x2="338" y2="90" strokeWidth="6" />
        </svg>
      )}

      {normalizedRole === "cashier" && (
        // Cashier: POS Register + Receipt Tape + Currency
        <svg
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* POS Monitor Screen */}
          <rect x="70" y="80" width="220" height="150" rx="12" fill="currentColor" fillOpacity="0.12" strokeWidth="7" />
          <rect x="90" y="100" width="180" height="100" rx="6" strokeWidth="4" />
          {/* Screen Content - Total Display */}
          <text x="105" y="140" fill="currentColor" stroke="none" fontSize="24" fontWeight="bold" fontFamily="monospace">
            ৳ 2,450.00
          </text>
          <line x1="105" y1="160" x2="200" y2="160" strokeWidth="4" />
          <line x1="105" y1="175" x2="160" y2="175" strokeWidth="4" />

          {/* Stand Pole & Base */}
          <path d="M 160 230 L 150 280 L 210 280 L 200 230" fill="currentColor" fillOpacity="0.2" strokeWidth="5" />
          {/* Heavy Cash Drawer Base */}
          <rect x="50" y="280" width="260" height="70" rx="10" fill="currentColor" fillOpacity="0.15" strokeWidth="7" />
          <line x1="50" y1="315" x2="310" y2="315" strokeWidth="5" />
          <circle cx="180" cy="335" r="5" fill="currentColor" />
          <rect x="230" y="325" width="40" height="18" rx="3" strokeWidth="4" />

          {/* Long Receipt Tape Streaming Down */}
          <path
            d="M 270 120 L 330 120 L 330 320 L 320 310 L 310 320 L 300 310 L 290 320 L 280 310 L 270 320 Z"
            fill="currentColor"
            fillOpacity="0.2"
            strokeWidth="5"
          />
          {/* Lines on receipt */}
          <line x1="282" y1="150" x2="318" y2="150" strokeWidth="4" />
          <line x1="282" y1="170" x2="318" y2="170" strokeWidth="4" />
          <line x1="282" y1="190" x2="310" y2="190" strokeWidth="4" />
          <line x1="282" y1="220" x2="318" y2="220" strokeWidth="5" />
          {/* Barcode on receipt */}
          <line x1="282" y1="260" x2="282" y2="285" strokeWidth="4" />
          <line x1="288" y1="260" x2="288" y2="285" strokeWidth="2" />
          <line x1="294" y1="260" x2="294" y2="285" strokeWidth="5" />
          <line x1="303" y1="260" x2="303" y2="285" strokeWidth="3" />
          <line x1="312" y1="260" x2="312" y2="285" strokeWidth="4" />
          <line x1="318" y1="260" x2="318" y2="285" strokeWidth="2" />
        </svg>
      )}

      {normalizedRole === "kitchen" && (
        // Kitchen: Chef Toque + Sauté Pan + Fire Flames
        <svg
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* Chef Hat Puffs */}
          <path
            d="M 120 180 C 80 180 80 110 120 100 C 120 50 190 40 200 80 C 220 30 290 50 280 100 C 320 110 320 180 280 180 Z"
            fill="currentColor"
            fillOpacity="0.15"
            strokeWidth="7"
          />
          {/* Hat Pleats */}
          <path d="M 155 105 L 155 180" strokeWidth="4" />
          <path d="M 200 85 L 200 180" strokeWidth="4" />
          <path d="M 245 105 L 245 180" strokeWidth="4" />
          {/* Hat Band */}
          <rect x="110" y="180" width="180" height="35" rx="6" fill="currentColor" fillOpacity="0.25" strokeWidth="6" />

          {/* Dancing Flame */}
          <path
            d="M 200 240 C 230 270 240 310 200 340 C 160 310 170 270 200 240 Z"
            fill="currentColor"
            fillOpacity="0.3"
            strokeWidth="5"
          />
          <path
            d="M 200 275 C 215 295 220 315 200 330 C 180 315 185 295 200 275 Z"
            fill="currentColor"
            fillOpacity="0.4"
          />

          {/* Cooking Pan with Long Handle */}
          <path d="M 110 310 C 110 350 290 350 290 310 Z" fill="currentColor" fillOpacity="0.2" strokeWidth="7" />
          <line x1="290" y1="320" x2="360" y2="345" strokeWidth="10" />

          {/* Crossed Spatula & Chef Knife in background */}
          <line x1="80" y1="80" x2="140" y2="140" strokeWidth="5" strokeDasharray="6 6" />
          <line x1="320" y1="80" x2="260" y2="140" strokeWidth="5" strokeDasharray="6 6" />
        </svg>
      )}

      {normalizedRole === "waiter" && (
        // Waiter: Classic Serving Cloche (Domed Platter) + Steam Plumes + Dining Service
        <svg
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* Cloche Top Handle Knob */}
          <circle cx="200" cy="120" r="14" fill="currentColor" fillOpacity="0.3" strokeWidth="6" />
          <path d="M 194 134 L 194 150 L 206 150 L 206 134" fill="currentColor" />

          {/* Cloche Dome Cover */}
          <path
            d="M 80 270 C 80 160 320 160 320 270 Z"
            fill="currentColor"
            fillOpacity="0.15"
            strokeWidth="8"
          />
          {/* Dome Accent Highlight Line */}
          <path d="M 115 250 C 125 185 220 175 260 190" strokeWidth="5" />

          {/* Serving Platter Base Tray */}
          <ellipse cx="200" cy="275" rx="145" ry="20" fill="currentColor" fillOpacity="0.3" strokeWidth="7" />
          <path d="M 55 275 C 55 295 345 295 345 275" strokeWidth="6" />

          {/* Rising Steam Plumes */}
          <path d="M 160 100 Q 150 70 165 45 Q 180 20 170 0" strokeWidth="5" />
          <path d="M 200 95 Q 215 65 200 40 Q 185 15 200 0" strokeWidth="5" />
          <path d="M 240 100 Q 250 70 235 45 Q 220 20 230 0" strokeWidth="5" />

          {/* Waiter's Service Towel / Hand Support */}
          <path
            d="M 120 310 C 140 340 180 350 200 350 C 220 350 260 340 280 310"
            strokeWidth="6"
            strokeDasharray="8 8"
          />
          {/* Table Service Wine Glass Silhouette */}
          <path d="M 70 330 L 70 345 Q 70 360 85 360 L 95 360 Q 110 360 110 345 L 110 330 Z" strokeWidth="4" />
          <line x1="90" y1="360" x2="90" y2="385" strokeWidth="4" />
          <line x1="75" y1="385" x2="105" y2="385" strokeWidth="5" />
        </svg>
      )}

      {normalizedRole === "super_admin" && (
        // Super Admin: Shield + Security Keyhole + Server Nodes
        <svg
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          {/* Shield Outline */}
          <path
            d="M 200 50 L 320 90 L 320 210 C 320 290 200 350 200 350 C 200 350 80 290 80 210 L 80 90 Z"
            fill="currentColor"
            fillOpacity="0.12"
            strokeWidth="8"
          />
          {/* Inner Shield Accent */}
          <path
            d="M 200 80 L 295 112 L 295 205 C 295 268 200 318 200 318 C 200 318 105 268 105 205 L 105 112 Z"
            strokeWidth="4"
          />
          {/* Keyhole */}
          <circle cx="200" cy="180" r="24" fill="currentColor" fillOpacity="0.3" strokeWidth="6" />
          <polygon points="190,195 210,195 218,245 182,245" fill="currentColor" fillOpacity="0.4" strokeWidth="5" />
          {/* Server / Cloud Connection Nodes */}
          <circle cx="140" cy="120" r="8" fill="currentColor" />
          <circle cx="260" cy="120" r="8" fill="currentColor" />
          <line x1="148" y1="120" x2="252" y2="120" strokeWidth="4" strokeDasharray="6 6" />
        </svg>
      )}
    </div>
  );
};
