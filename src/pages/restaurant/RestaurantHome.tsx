import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingBag,
  UtensilsCrossed,
  Clock,
  ArrowUpRight,
  TrendingUp,
  AlertCircle,
  ChefHat,
  QrCode,
  DollarSign,
  ChevronRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Loading } from "../../components/ui";
import { supabase } from "../../config/supabase";
import { useAuth } from "../../context/AuthContext";
import { formatCurrency } from "../../utils/helpers";

interface TodayOrderRow {
  id: string;
  total: number | null;
  status: string;
  payment_method: string | null;
  payment_status: string;
}

interface PastWeekOrderRow {
  total: number | null;
  created_at: string;
  payment_method: string | null;
  status: string;
}

interface OrderSummary {
  id: string;
  order_number: string;
  order_type: string;
  table_number: number | null;
  total: number;
  status: string;
  payment_method: string | null;
  payment_status: string;
  created_at: string;
  items?: { name: string; quantity: number }[];
}

interface DailyTrend {
  date: string;
  sales: number;
  orders: number;
}

interface PaymentSplitItem {
  name: string;
  value: number;
  color: string;
  [key: string]: unknown;
}

interface DashboardData {
  pendingOrders: number;
  todayOrders: number;
  todayRevenue: number;
  totalMenuItems: number;
  recentOrders: OrderSummary[];
  dailyTrends: DailyTrend[];
  paymentSplit: PaymentSplitItem[];
}

const PAYMENT_COLORS: Record<string, string> = {
  cash: "#10B981", // Emerald
  bkash: "#E11D48", // Rose/Pink
  nagad: "#F97316", // Orange
  card: "#6366F1", // Indigo
  sslcommerz: "#3B82F6", // Sky
  other: "#94A3B8", // Slate
};

const RestaurantHome: React.FC = () => {
  const { restaurant } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (restaurant?.id) {
      loadDashboardData(restaurant.id);
    }
  }, [restaurant?.id]);

  const loadDashboardData = async (restaurantId: string) => {
    try {
      setLoading(true);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      // Concurrent queries for KPI metrics
      const [
        todayOrdersRes,
        pendingOrdersRes,
        menuItemsRes,
        recentOrdersRes,
        pastWeekOrdersRes,
      ] = await Promise.all([
        supabase
          .from("orders")
          .select("id, total, status, payment_method, payment_status")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", today.toISOString()),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("status", "pending"),
        supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .is("deleted_at", null),
        supabase
          .from("orders")
          .select("id, order_number, order_type, table_number, total, status, payment_method, payment_status, created_at, items")
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("orders")
          .select("total, created_at, payment_method, status")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", sevenDaysAgo.toISOString()),
      ]);

      const todayOrders = (todayOrdersRes.data as TodayOrderRow[]) || [];
      const todayRevenue = todayOrders
        .filter((o: TodayOrderRow) => o.payment_status === "paid" || o.status === "completed")
        .reduce((sum: number, o: TodayOrderRow) => sum + Number(o.total || 0), 0);

      // Process 7-day trend
      const dateMap = new Map<string, { sales: number; orders: number }>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(sevenDaysAgo);
        d.setDate(d.getDate() + i);
        const key = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
        dateMap.set(key, { sales: 0, orders: 0 });
      }

      const pastWeekOrders = (pastWeekOrdersRes.data as PastWeekOrderRow[]) || [];
      const paymentCounts: Record<string, number> = {
        cash: 0,
        bkash: 0,
        nagad: 0,
        card: 0,
      };

      pastWeekOrders.forEach((o: PastWeekOrderRow) => {
        const d = new Date(o.created_at);
        const key = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
        if (dateMap.has(key)) {
          const entry = dateMap.get(key)!;
          entry.orders += 1;
          if (o.status === "completed") {
            entry.sales += Number(o.total || 0);
          }
        }

        // Tally payments
        if (o.payment_method) {
          const m = o.payment_method.toLowerCase();
          paymentCounts[m] = (paymentCounts[m] || 0) + 1;
        }
      });

      const dailyTrends: DailyTrend[] = Array.from(dateMap.entries()).map(([date, val]) => ({
        date,
        sales: val.sales,
        orders: val.orders,
      }));

      // Payment split donut items
      const paymentSplit: PaymentSplitItem[] = Object.entries(paymentCounts)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({
          name: name.toUpperCase(),
          value: count,
          color: PAYMENT_COLORS[name] || PAYMENT_COLORS.other,
        }));

      // Fallback empty pie data if none
      if (paymentSplit.length === 0) {
        paymentSplit.push({ name: "CASH", value: 1, color: PAYMENT_COLORS.cash });
      }

      setData({
        pendingOrders: pendingOrdersRes.count || 0,
        todayOrders: todayOrders.length,
        todayRevenue,
        totalMenuItems: menuItemsRes.count || 0,
        recentOrders: (recentOrdersRes.data as OrderSummary[]) || [],
        dailyTrends,
        paymentSplit,
      });
    } catch (err) {
      console.error("Failed to load restaurant dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return <Loading text="Preparing live dashboard insights..." />;
  }

  const statCards = [
    {
      title: "Today's Revenue",
      value: formatCurrency(data.todayRevenue),
      subtitle: `${data.todayOrders} orders processed`,
      icon: DollarSign,
      color: "text-orange-600",
      bgColor: "bg-orange-50",
      borderColor: "border-orange-200/80",
    },
    {
      title: "Pending Verification",
      value: data.pendingOrders,
      subtitle: data.pendingOrders > 0 ? "Requires waiter attention" : "All orders confirmed",
      icon: Clock,
      color: data.pendingOrders > 0 ? "text-amber-600" : "text-slate-600",
      bgColor: data.pendingOrders > 0 ? "bg-amber-50" : "bg-slate-50",
      borderColor: data.pendingOrders > 0 ? "border-amber-300" : "border-slate-200",
      pulse: data.pendingOrders > 0,
    },
    {
      title: "Total Orders Today",
      value: data.todayOrders,
      subtitle: "Dine-in & counter total",
      icon: ShoppingBag,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      borderColor: "border-emerald-200/80",
    },
    {
      title: "Active Menu Items",
      value: data.totalMenuItems,
      subtitle: "Bilingual dishes live",
      icon: UtensilsCrossed,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      borderColor: "border-indigo-200/80",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Top Welcome & Quick Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Operational Overview
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time sales, order pipeline, and dining floor activity for{" "}
            <span className="font-semibold text-slate-700">
              {restaurant?.name || "your restaurant"}
            </span>
            .
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          <Link
            to="/restaurant/orders"
            className="inline-flex items-center space-x-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-semibold text-xs px-3.5 py-2.5 rounded-xl shadow-sm transition-all"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Live Orders</span>
            {data.pendingOrders > 0 && (
              <span className="bg-white text-orange-600 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                {data.pendingOrders}
              </span>
            )}
          </Link>

          <Link
            to="/restaurant/kitchen"
            className="inline-flex items-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3.5 py-2.5 rounded-xl transition-colors shadow-2xs"
          >
            <ChefHat className="w-4 h-4 text-orange-500" />
            <span>Kitchen KDS</span>
          </Link>

          <Link
            to="/restaurant/tables"
            className="inline-flex items-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-3.5 py-2.5 rounded-xl transition-colors shadow-2xs"
          >
            <QrCode className="w-4 h-4 text-slate-500" />
            <span>Floor Tables</span>
          </Link>
        </div>
      </div>

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

      {/* Charts Section: 7-Day Revenue Area + Payment Split Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Volume Trend Chart (2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-orange-600" />
                <span>Sales Revenue Trend (Past 7 Days)</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Completed orders gross revenue in BDT (৳)
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center space-x-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Live Synced</span>
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.dailyTrends}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EA580C" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#EA580C" stopOpacity={0.0} />
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
                  formatter={(val: unknown) => [formatCurrency(Number(val) || 0), "Sales"]}
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
                  dataKey="sales"
                  stroke="#EA580C"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#revenueGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Methods Split Donut (1 column) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Payment Method Split
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Distribution across Cash, bKash & Card
            </p>
          </div>

          <div className="h-56 my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.paymentSplit}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={4}
                >
                  {data.paymentSplit.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val: unknown) => [`${val} orders`, "Count"]}
                  contentStyle={{
                    backgroundColor: "#0F172A",
                    color: "#FFFFFF",
                    borderRadius: "8px",
                    border: "none",
                    fontSize: "11px",
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Primary Tender</span>
            <span className="font-semibold text-slate-700">Cash & bKash MFS</span>
          </div>
        </div>
      </div>

      {/* Operational Feed: Recent Orders */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Recent Order Tickets
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Latest incoming and processed tickets
            </p>
          </div>

          <Link
            to="/restaurant/orders"
            className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center space-x-1"
          >
            <span>View All Orders</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {data.recentOrders.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p>No recent orders found. QR orders will appear here automatically.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.recentOrders.map((order) => {
              const isPending = order.status === "pending";
              const isCompleted = order.status === "completed";

              return (
                <div
                  key={order.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isPending
                      ? "bg-amber-50/40 border-amber-200"
                      : "bg-slate-50/50 border-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-xs text-slate-900">
                      #{order.order_number}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        isCompleted
                          ? "bg-emerald-100 text-emerald-800"
                          : isPending
                          ? "bg-amber-100 text-amber-800 animate-pulse"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {order.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                    <span>
                      {order.order_type === "dine_in"
                        ? `Table ${order.table_number || "QR"}`
                        : "Counter / Takeaway"}
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(order.total)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-200/60">
                    <span className="capitalize">
                      {order.payment_method || "Unsettled"}
                    </span>
                    <span>
                      {new Date(order.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RestaurantHome;
