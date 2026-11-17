import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Store as StoreIcon,
  FileText,
  ShoppingBag,
  DollarSign,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  CreditCard,
  ChevronRight,
  CheckCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loading } from "../../components/ui";
import { supabase } from "../../config/supabase";
import { formatCurrency } from "../../utils/helpers";

interface PlatformStats {
  activeRestaurants: number;
  pendingRequests: number;
  totalOrders: number;
  todayRevenue: number;
  totalRevenue: number;
  recentRequests: {
    id: string;
    restaurant_name: string;
    city: string;
    owner_name: string;
    owner_phone: string;
    created_at: string;
  }[];
  growthTrends: { date: string; gmv: number; orders: number }[];
}

const DashboardHome: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      // Concurrent queries for platform KPIs
      const [
        activeRestRes,
        pendingReqRes,
        totalOrdersRes,
        todayOrdersRes,
        totalRevenueRes,
        recentPendingRes,
        weekOrdersRes,
      ] = await Promise.all([
        supabase
          .from("restaurants")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
        supabase
          .from("registration_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("orders")
          .select("total, status")
          .gte("created_at", today.toISOString()),
        supabase
          .from("orders")
          .select("total")
          .in("status", ["completed", "ready", "preparing", "accepted"]),
        supabase
          .from("registration_requests")
          .select("id, restaurant_name, city, owner_name, owner_phone, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(4),
        supabase
          .from("orders")
          .select("total, created_at, status")
          .gte("created_at", sevenDaysAgo.toISOString()),
      ]);

      const todayOrders = todayOrdersRes.data || [];
      const todayRevenue = todayOrders
        .filter((o) => o.status === "completed")
        .reduce((sum, o) => sum + Number(o.total || 0), 0);

      const totalRevenue = (totalRevenueRes.data || []).reduce(
        (sum, o) => sum + Number(o.total || 0),
        0
      );

      // Process 7-day platform trend
      const dateMap = new Map<string, { gmv: number; orders: number }>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(sevenDaysAgo);
        d.setDate(d.getDate() + i);
        const key = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
        dateMap.set(key, { gmv: 0, orders: 0 });
      }

      (weekOrdersRes.data || []).forEach((o) => {
        const d = new Date(o.created_at);
        const key = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
        if (dateMap.has(key)) {
          const entry = dateMap.get(key)!;
          entry.orders += 1;
          entry.gmv += Number(o.total || 0);
        }
      });

      const growthTrends = Array.from(dateMap.entries()).map(([date, val]) => ({
        date,
        gmv: val.gmv,
        orders: val.orders,
      }));

      setStats({
        activeRestaurants: activeRestRes.count || 0,
        pendingRequests: pendingReqRes.count || 0,
        totalOrders: totalOrdersRes.count || 0,
        todayRevenue,
        totalRevenue,
        recentRequests: recentPendingRes.data || [],
        growthTrends,
      });
    } catch (err) {
      console.error("Failed to load platform stats:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !stats) {
    return <Loading text="Loading platform control metrics..." />;
  }

  const statCards = [
    {
      title: "Active Tenants",
      value: stats.activeRestaurants,
      subtitle: "Live restaurants on platform",
      icon: StoreIcon,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      borderColor: "border-emerald-200/80",
    },
    {
      title: "Pending Onboarding",
      value: stats.pendingRequests,
      subtitle: stats.pendingRequests > 0 ? "Requires admin approval" : "All requests verified",
      icon: FileText,
      color: stats.pendingRequests > 0 ? "text-amber-600" : "text-slate-600",
      bgColor: stats.pendingRequests > 0 ? "bg-amber-50" : "bg-slate-50",
      borderColor: stats.pendingRequests > 0 ? "border-amber-300" : "border-slate-200",
      pulse: stats.pendingRequests > 0,
    },
    {
      title: "Cross-Tenant GMV",
      value: formatCurrency(stats.totalRevenue),
      subtitle: `Today: ${formatCurrency(stats.todayRevenue)}`,
      icon: DollarSign,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      borderColor: "border-indigo-200/80",
    },
    {
      title: "Total Food Orders",
      value: stats.totalOrders.toLocaleString(),
      subtitle: "Processed platform-wide",
      icon: ShoppingBag,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      borderColor: "border-orange-200/80",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Top Welcome Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Platform Command Center
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Global oversight across restaurant tenants, onboarding requests, and food commerce volume.
          </p>
        </div>

        {/* Quick Action Navigation Buttons */}
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          <Link
            to="/admin/requests"
            className="inline-flex items-center space-x-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold text-xs px-3.5 py-2.5 rounded-xl shadow-sm transition-all"
          >
            <FileText className="w-4 h-4" />
            <span>Onboarding Queue</span>
            {stats.pendingRequests > 0 && (
              <span className="bg-amber-400 text-slate-900 text-[10px] font-black px-1.5 py-0.2 rounded-full animate-pulse">
                {stats.pendingRequests}
              </span>
            )}
          </Link>

          <Link
            to="/admin/restaurants"
            className="inline-flex items-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3.5 py-2.5 rounded-xl transition-colors shadow-2xs"
          >
            <StoreIcon className="w-4 h-4 text-emerald-600" />
            <span>All Restaurants</span>
          </Link>

          <Link
            to="/admin/analytics"
            className="inline-flex items-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3.5 py-2.5 rounded-xl transition-colors shadow-2xs"
          >
            <TrendingUp className="w-4 h-4 text-indigo-600" />
            <span>Full Analytics</span>
          </Link>
        </div>
      </div>

      {/* Action Required Banner if Pending Applications */}
      {stats.pendingRequests > 0 && (
        <div className="bg-amber-50/80 border border-amber-300 rounded-2xl p-4 sm:p-5 flex items-start justify-between shadow-xs">
          <div className="flex items-start space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {stats.pendingRequests} New Restaurant Application{stats.pendingRequests > 1 ? "s" : ""} Awaiting Review
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                New restaurant owners have registered online and are awaiting KYC verification and tenant provisioning.
              </p>
            </div>
          </div>
          <Link
            to="/admin/requests"
            className="hidden sm:inline-flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-3.5 py-2 rounded-xl transition-colors shadow-xs"
          >
            <span>Review Now</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* 4 Hero Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, idx) => (
          <div
            key={idx}
            className={`bg-white rounded-2xl border ${card.borderColor} p-5 shadow-xs transition-all hover:shadow-md ${
              card.pulse ? "ring-2 ring-amber-400/50" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {card.title}
              </span>
              <div
                className={`w-10 h-10 rounded-xl ${card.bgColor} flex items-center justify-center`}
              >
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {card.value}
              </p>
              <p className="text-xs text-slate-400 flex items-center">
                <span>{card.subtitle}</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Network Sales & Orders Trend (7 Days) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <span>Platform GMV Commerce Growth (Past 7 Days)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Aggregated daily food gross merchandise volume across all restaurant tenants
            </p>
          </div>
          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center space-x-1">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Network Realtime</span>
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={stats.growthTrends}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="adminGmvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: "#E2E8F0" }}
                tick={{ fontSize: 11, fill: "#64748B" }}
              />
              <YAxis
                tickLine={false}
                axisLine={{ stroke: "#E2E8F0" }}
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(val) => `৳${val}`}
              />
              <Tooltip
                formatter={(val: unknown) => [formatCurrency(Number(val) || 0), "Platform GMV"]}
                contentStyle={{
                  backgroundColor: "#0F172A",
                  color: "#FFFFFF",
                  borderRadius: "12px",
                  border: "none",
                  fontSize: "12px",
                }}
              />
              <Area
                type="monotone"
                dataKey="gmv"
                stroke="#4F46E5"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#adminGmvGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Grid: Pending Onboarding Applicants & Operational Modules */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Pending Applications */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  New Restaurant Applicants
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Latest onboarding applications awaiting review
                </p>
              </div>
              <Link
                to="/admin/requests"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1"
              >
                <span>View All</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {stats.recentRequests.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
                <p>No pending applications. All onboarding requests have been reviewed.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.recentRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-xs text-slate-900">
                        {req.restaurant_name}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {req.owner_name} • {req.city || "Dhaka"} • 📞 {req.owner_phone}
                      </p>
                    </div>
                    <Link
                      to="/admin/requests"
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[11px] transition-colors"
                    >
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Operational Modules Shortcut Grid */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            Platform Operations & Tools
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Link
              to="/admin/requests"
              className="p-4 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/30 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-2 group-hover:scale-105 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-xs text-slate-900 mb-0.5">
                Onboarding Queue
              </h4>
              <p className="text-[11px] text-slate-500">
                Verify licenses, approve restaurants, issue credentials.
              </p>
            </Link>

            <Link
              to="/admin/restaurants"
              className="p-4 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/30 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 mb-2 group-hover:scale-105 transition-transform">
                <StoreIcon className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-xs text-slate-900 mb-0.5">
                Tenant Management
              </h4>
              <p className="text-[11px] text-slate-500">
                View branches, suspend/activate, inspect menus.
              </p>
            </Link>

            <Link
              to="/admin/billing"
              className="p-4 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/30 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 mb-2 group-hover:scale-105 transition-transform">
                <CreditCard className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-xs text-slate-900 mb-0.5">
                SaaS Subscriptions
              </h4>
              <p className="text-[11px] text-slate-500">
                Verify bKash TrxIDs, unlock accounts, MRR tracking.
              </p>
            </Link>

            <Link
              to="/admin/analytics"
              className="p-4 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/30 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 mb-2 group-hover:scale-105 transition-transform">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-xs text-slate-900 mb-0.5">
                Platform Analytics
              </h4>
              <p className="text-[11px] text-slate-500">
                Leaderboards, regional breakdown, GMV trends.
              </p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardHome;
