import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Store,
  MapPin,
  Calendar,
  Download,
  CreditCard,
  Crown,
  Percent,
  Layers,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Card, Button, Loading } from "../../components/ui";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  getPlatformAnalytics,
  exportPlatformAnalyticsCSV,
} from "../../services/platformAnalyticsService";
import type { PlatformAnalyticsData } from "../../schemas/platformAnalyticsSchema";
import { formatCurrency } from "../../utils/helpers";

const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#A78BFA", "#F59E0B"];

export const Analytics: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<PlatformAnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Date filters
  const [preset, setPreset] = useState<"7" | "30" | "90" | "all" | "custom">("30");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const calculateDateBounds = useCallback(
    (p: "7" | "30" | "90" | "all" | "custom") => {
      let start = new Date();
      const end = new Date();

      if (p === "7") {
        start.setDate(start.getDate() - 7);
      } else if (p === "30") {
        start.setDate(start.getDate() - 30);
      } else if (p === "90") {
        start.setDate(start.getDate() - 90);
      } else if (p === "all") {
        start = new Date("2026-01-01T00:00:00Z");
      } else if (p === "custom") {
        if (customStart && customEnd) {
          return {
            startDate: new Date(customStart + "T00:00:00").toISOString(),
            endDate: new Date(customEnd + "T23:59:59").toISOString(),
          };
        }
        start.setDate(start.getDate() - 30);
      }

      return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
    },
    [customStart, customEnd]
  );

  const fetchAnalytics = useCallback(
    async (p: "7" | "30" | "90" | "all" | "custom") => {
      setLoading(true);
      setError(null);
      try {
        const { startDate, endDate } = calculateDateBounds(p);
        const res = await getPlatformAnalytics(startDate, endDate);
        if (res.success && res.data) {
          setData(res.data);
        } else {
          setError(res.error || "Failed to load platform analytics");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error fetching analytics");
      } finally {
        setLoading(false);
      }
    },
    [calculateDateBounds]
  );

  useEffect(() => {
    fetchAnalytics(preset);
  }, [fetchAnalytics, preset]);

  const handleApplyCustomDates = () => {
    if (customStart && customEnd) {
      fetchAnalytics("custom");
    }
  };

  const handleExportCSV = () => {
    if (data) {
      exportPlatformAnalyticsCSV(data);
    }
  };

  if (loading && !data) {
    return <Loading text="Aggregating Platform Analytics & GMV..." />;
  }

  const overview = data?.overview;
  const paymentChartData =
    data?.payment_methods.map((pm) => ({
      name: pm.method.toUpperCase(),
      value: pm.amount,
    })) || [];

  const cityChartData =
    data?.city_distribution.map((cd) => ({
      name: cd.city,
      gmv: cd.gmv,
      restaurants: cd.restaurant_count,
    })) || [];

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" />
            Platform Analytics & GMV Oversight
          </h2>
          <p className="text-text-secondary text-sm">
            Cross-tenant Gross Merchandise Volume (GMV), order trends, geographic spread, and SaaS revenue
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick preset filters */}
          <div className="flex bg-bg-subtle p-1 rounded-lg border border-border text-sm">
            <button
              onClick={() => setPreset("7")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                preset === "7"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => setPreset("30")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                preset === "30"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              30 Days
            </button>
            <button
              onClick={() => setPreset("90")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                preset === "90"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              90 Days
            </button>
            <button
              onClick={() => setPreset("all")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                preset === "all"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setPreset("custom")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                preset === "custom"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              Custom
            </button>
          </div>

          <Button
            icon={<Download className="w-4 h-4" />}
            onClick={handleExportCSV}
            variant="outline"
            size="sm"
            disabled={!data}
          >
            Export Report CSV
          </Button>
        </div>
      </div>

      {/* Custom Date Filter */}
      {preset === "custom" && (
        <Card className="bg-bg-subtle p-4 border border-border">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold text-text flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-primary" /> Custom Period:
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="platform-start-date" className="text-text-secondary">From:</label>
              <input
                id="platform-start-date"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input py-1 px-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="platform-end-date" className="text-text-secondary">To:</label>
              <input
                id="platform-end-date"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input py-1 px-2 text-sm"
              />
            </div>
            <Button size="sm" onClick={handleApplyCustomDates} disabled={!customStart || !customEnd}>
              Apply Filter
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <div className="p-3 bg-error/10 border border-error/30 text-error rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 6 High-Impact Platform KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="p-4 border-l-4 border-l-primary">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Total GMV</span>
            <DollarSign className="w-4 h-4 text-primary" />
          </div>
          <div className="text-xl font-bold text-text">
            {formatCurrency(overview?.total_gmv || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Platform food sales</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Orders Served</span>
            <ShoppingBag className="w-4 h-4 text-success" />
          </div>
          <div className="text-xl font-bold text-text">
            {overview?.total_orders || 0}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">
            {overview?.total_all_orders || 0} total placed
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Avg Ticket</span>
            <TrendingUp className="w-4 h-4 text-accent" />
          </div>
          <div className="text-xl font-bold text-text">
            {formatCurrency(overview?.avg_order_value || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Average order value</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">NBR VAT</span>
            <Percent className="w-4 h-4 text-warning" />
          </div>
          <div className="text-xl font-bold text-warning">
            {formatCurrency(overview?.total_vat || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Total tax generated</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-success">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-success">SaaS Revenue</span>
            <Sparkles className="w-4 h-4 text-success" />
          </div>
          <div className="text-xl font-bold text-success">
            {formatCurrency(overview?.saas_revenue || 0)}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">Paid subscriptions</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase font-semibold text-text-secondary">Tenant Network</span>
            <Store className="w-4 h-4 text-primary" />
          </div>
          <div className="text-xl font-bold text-text">
            {overview?.active_tenants || 0}
          </div>
          <p className="text-[10px] text-text-secondary mt-1">
            of {overview?.total_tenants || 0} restaurants active
          </p>
        </Card>
      </div>

      {/* Main Charts: Daily GMV Trend & Payment Methods */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Daily Platform GMV (2 cols) */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-text">Platform GMV & Order Volume Trend</h3>
              <p className="text-xs text-text-secondary">Daily aggregate food volume across all active restaurants</p>
            </div>
          </div>
          {data?.daily_trend && data.daily_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.daily_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 12 }} />
                <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), "Platform GMV"]}
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="gmv"
                  stroke="#FF6B6B"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  name="Platform GMV (৳)"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-text-secondary text-sm">
              No sales data recorded in this period
            </div>
          )}
        </Card>

        {/* Payment Channels Split */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-text flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-primary" />
                Payment Channels
              </h3>
              <p className="text-xs text-text-secondary">Cash, bKash, Nagad, Card</p>
            </div>
          </div>
          {paymentChartData.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {paymentChartData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1 text-xs">
                {paymentChartData.map((item, idx) => (
                  <div key={item.name} className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                      />
                      <span className="text-text font-medium">{item.name}</span>
                    </span>
                    <span className="font-semibold text-text">{formatCurrency(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-text-secondary text-sm">
              No payments recorded
            </div>
          )}
        </Card>
      </div>

      {/* Secondary Row: Top Restaurants & Geographic Distribution */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top 10 Restaurants Leaderboard */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-warning" />
              <div>
                <h3 className="text-base font-bold text-text">Top Restaurants by GMV</h3>
                <p className="text-xs text-text-secondary">Ranked by total completed sales revenue</p>
              </div>
            </div>
          </div>

          {!data?.top_restaurants || data.top_restaurants.length === 0 ? (
            <p className="text-text-secondary text-center py-8 text-sm">
              No restaurant performance data available for this range
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.top_restaurants.map((rest, index) => (
                <div
                  key={rest.restaurant_id}
                  className="flex items-center justify-between p-3 bg-bg-subtle rounded-lg border border-border text-sm"
                >
                  <div className="flex items-center space-x-3">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs">
                      {index + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-text flex items-center gap-2">
                        {rest.restaurant_name}
                        <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold bg-bg text-text-secondary border border-border">
                          {rest.plan_code}
                        </span>
                      </div>
                      <div className="text-xs text-text-secondary flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {rest.city}
                        </span>
                        <span>•</span>
                        <span>{rest.completed_orders} orders served</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success">{formatCurrency(rest.total_gmv)}</div>
                    <div className="text-[10px] text-text-secondary">Total GMV</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Geographic Distribution (Cities) */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-text flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-primary" />
                Geographic GMV Distribution
              </h3>
              <p className="text-xs text-text-secondary">Revenue and restaurant count across cities</p>
            </div>
          </div>

          {cityChartData.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cityChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" stroke="#6b7280" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip
                    formatter={(val: number) => [formatCurrency(val), "GMV"]}
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="gmv" fill="#4ECDC4" name="City GMV (৳)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {cityChartData.map((c) => (
                  <div key={c.name} className="p-2 bg-bg-subtle rounded border border-border">
                    <div className="font-bold text-text">{c.name}</div>
                    <div className="text-text-secondary text-[11px]">
                      {c.restaurants} restaurants • {formatCurrency(c.gmv)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-text-secondary text-sm">
              No geographic data available
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Grid: Order Channels Breakdown */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-text flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-accent" />
              Platform Ordering Channels
            </h3>
            <p className="text-xs text-text-secondary">Dine-in QR scans vs Counter / POS orders</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
          {data?.order_types.map((ot) => (
            <div key={ot.type} className="p-4 bg-bg-subtle rounded-xl border border-border">
              <span className="text-xs font-semibold text-text-secondary uppercase">
                {ot.type === "qr" ? "Dine-In QR" : ot.type === "counter" ? "Counter / POS" : ot.type}
              </span>
              <div className="text-xl font-bold text-text mt-1">
                {formatCurrency(ot.gmv)}
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {ot.count} orders completed
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default Analytics;
