import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Package,
  Calendar,
  Download,
  FileText,
  Percent,
  Receipt,
  RotateCcw,
  CreditCard,
  Layers,
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
  getRestaurantSalesAnalytics,
  getMushak63Report,
  exportMushak63CSV,
  exportSalesAnalyticsCSV,
} from "../../services/reportService";
import type {
  SalesAnalyticsData,
  Mushak63ReportData,
} from "../../schemas/reportSchema";
import { formatCurrency } from "../../utils/helpers";

const COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#A78BFA"];

export const Reports: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"overview" | "mushak">("overview");
  const [loading, setLoading] = useState<boolean>(true);
  const [analytics, setAnalytics] = useState<SalesAnalyticsData | null>(null);
  const [mushakReport, setMushakReport] = useState<Mushak63ReportData | null>(null);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Date filters
  const [rangePreset, setRangePreset] = useState<"today" | "7" | "30" | "90" | "custom">("30");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const calculateDateBounds = useCallback(
    (preset: "today" | "7" | "30" | "90" | "custom") => {
      const now = new Date();
      let start = new Date();
      const end = new Date();

      if (preset === "today") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else if (preset === "7") {
        start.setDate(start.getDate() - 7);
      } else if (preset === "30") {
        start.setDate(start.getDate() - 30);
      } else if (preset === "90") {
        start.setDate(start.getDate() - 90);
      } else if (preset === "custom") {
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

  const fetchReports = useCallback(
    async (rId: string, preset: "today" | "7" | "30" | "90" | "custom") => {
      setLoading(true);
      setError(null);
      try {
        const { startDate, endDate } = calculateDateBounds(preset);

        const [analyticsRes, mushakRes] = await Promise.all([
          getRestaurantSalesAnalytics(rId, startDate, endDate),
          getMushak63Report(rId, startDate, endDate),
        ]);

        if (analyticsRes.success && analyticsRes.data) {
          setAnalytics(analyticsRes.data);
        } else {
          setError(analyticsRes.error || "Failed to load sales analytics");
        }

        if (mushakRes.success && mushakRes.data) {
          setMushakReport(mushakRes.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error fetching reports");
      } finally {
        setLoading(false);
      }
    },
    [calculateDateBounds]
  );

  useEffect(() => {
    let rId = "";
    const currentRestaurant = localStorage.getItem("current_restaurant");
    if (currentRestaurant) {
      try {
        const parsed = JSON.parse(currentRestaurant);
        rId = parsed.id || "";
      } catch {
        // fallback
      }
    }

    if (!rId) {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      rId = user.restaurant_id || "";
    }

    if (rId) {
      setRestaurantId(rId);
      fetchReports(rId, rangePreset);
    } else {
      setLoading(false);
      setError("No active restaurant session found.");
    }
  }, [fetchReports, rangePreset]);

  const handleApplyCustomDates = () => {
    if (restaurantId && customStart && customEnd) {
      fetchReports(restaurantId, "custom");
    }
  };

  const handleExportSales = () => {
    if (analytics) {
      exportSalesAnalyticsCSV(analytics);
    }
  };

  const handleExportMushak = () => {
    if (mushakReport) {
      exportMushak63CSV(mushakReport);
    }
  };

  if (loading && !analytics) {
    return <Loading text="Generating Sales & VAT Reports..." />;
  }

  const summary = analytics?.summary;
  const paymentBreakdown = analytics?.payment_breakdown;
  const paymentChartData = paymentBreakdown?.methods.map((m) => ({
    name: m.method.toUpperCase(),
    value: m.amount,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" />
            Reports & NBR VAT Analytics
          </h2>
          <p className="text-text-secondary text-sm">
            Sales overview, payment breakdown, and Bangladesh NBR Mushak-6.3 VAT compliance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick preset filters */}
          <div className="flex bg-bg-subtle p-1 rounded-lg border border-border text-sm">
            <button
              onClick={() => setRangePreset("today")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                rangePreset === "today"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setRangePreset("7")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                rangePreset === "7"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => setRangePreset("30")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                rangePreset === "30"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              30 Days
            </button>
            <button
              onClick={() => setRangePreset("90")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                rangePreset === "90"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              90 Days
            </button>
            <button
              onClick={() => setRangePreset("custom")}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                rangePreset === "custom"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              Custom
            </button>
          </div>

          {/* Export Buttons */}
          <div className="flex gap-2">
            <Button
              icon={<Download className="w-4 h-4" />}
              onClick={handleExportSales}
              variant="outline"
              size="sm"
              title="Download Sales Summary CSV"
            >
              Sales CSV
            </Button>
            <Button
              icon={<FileText className="w-4 h-4" />}
              onClick={handleExportMushak}
              variant="primary"
              size="sm"
              title="Download Mushak-6.3 Tax Invoice Register CSV"
            >
              Mushak-6.3 CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Custom Date Picker Bar */}
      {rangePreset === "custom" && (
        <Card className="bg-bg-subtle p-4 border border-border">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold text-text flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-primary" /> Select Custom Period:
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="custom-start-date" className="text-text-secondary">From:</label>
              <input
                id="custom-start-date"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input py-1 px-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="custom-end-date" className="text-text-secondary">To:</label>
              <input
                id="custom-end-date"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input py-1 px-2 text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={handleApplyCustomDates}
              disabled={!customStart || !customEnd}
            >
              Apply Filter
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <div className="p-4 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-border space-x-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Sales & Financial Overview
        </button>
        <button
          onClick={() => setActiveTab("mushak")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "mushak"
              ? "border-primary text-primary"
              : "border-transparent text-text-secondary hover:text-text"
          }`}
        >
          <Receipt className="w-4 h-4" />
          NBR Mushak-6.3 VAT Register (কর চালানপত্র)
        </button>
      </div>

      {/* TAB 1: OVERVIEW & ANALYTICS */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 6 Key Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary uppercase">Gross Sales</span>
                <DollarSign className="w-4 h-4 text-success" />
              </div>
              <div className="text-xl font-bold text-text">
                {formatCurrency(summary?.gross_sales || 0)}
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {summary?.total_orders || 0} completed orders
              </p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary uppercase">Net Sales</span>
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <div className="text-xl font-bold text-text">
                {formatCurrency(summary?.net_sales || 0)}
              </div>
              <p className="text-xs text-text-secondary mt-1">Excl. VAT & discounts</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary uppercase">NBR VAT</span>
                <Percent className="w-4 h-4 text-warning" />
              </div>
              <div className="text-xl font-bold text-warning">
                {formatCurrency(summary?.vat_collected || 0)}
              </div>
              <p className="text-xs text-text-secondary mt-1">Govt. Mushak collected</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary uppercase">Discounts</span>
                <Percent className="w-4 h-4 text-accent" />
              </div>
              <div className="text-xl font-bold text-accent">
                {formatCurrency(summary?.discount_total || 0)}
              </div>
              <p className="text-xs text-text-secondary mt-1">Total discounts granted</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary uppercase">Avg Ticket</span>
                <ShoppingBag className="w-4 h-4 text-primary" />
              </div>
              <div className="text-xl font-bold text-text">
                {formatCurrency(summary?.avg_order_value || 0)}
              </div>
              <p className="text-xs text-text-secondary mt-1">Average per bill</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary uppercase">Voided</span>
                <RotateCcw className="w-4 h-4 text-error" />
              </div>
              <div className="text-xl font-bold text-error">
                {summary?.voided_orders || 0}
              </div>
              <p className="text-xs text-text-secondary mt-1">Manager cancelled</p>
            </Card>
          </div>

          {/* Charts Row: Revenue Trend & Payment Breakdown */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Daily Revenue Trend (2 cols) */}
            <Card className="lg:col-span-2 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-text">Daily Revenue Trend</h3>
                  <p className="text-xs text-text-secondary">Gross sales & orders count over selected period</p>
                </div>
              </div>
              {analytics?.daily_sales && analytics.daily_sales.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={analytics.daily_sales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: number) => [formatCurrency(value), "Gross Sales"]}
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
                      dataKey="gross_sales"
                      stroke="#FF6B6B"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      name="Gross Sales (৳)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-text-secondary text-sm">
                  No completed sales in this period
                </div>
              )}
            </Card>

            {/* Payment Methods Split */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-primary" />
                    Payment Channels
                  </h3>
                  <p className="text-xs text-text-secondary">Cash, MFS (bKash/Nagad), Cards</p>
                </div>
              </div>
              {paymentChartData.length > 0 ? (
                <div>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={paymentChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
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
                  <div className="mt-2 space-y-1.5 text-xs">
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

          {/* Bottom Grid: Top Selling Items & Daily Orders */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Top Selling Items (from order_items) */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-accent" />
                  <div>
                    <h3 className="text-base font-bold text-text">Top Selling Menu Items</h3>
                    <p className="text-xs text-text-secondary">Ranked by revenue contribution</p>
                  </div>
                </div>
              </div>

              {!analytics?.top_items || analytics.top_items.length === 0 ? (
                <p className="text-text-secondary text-center py-8 text-sm">
                  No order item data available for this range
                </p>
              ) : (
                <div className="space-y-2.5">
                  {analytics.top_items.map((item, index) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between p-3 bg-bg-subtle rounded-lg border border-border text-sm"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs">
                          {index + 1}
                        </span>
                        <div>
                          <div className="font-semibold text-text">{item.name}</div>
                          <div className="text-xs text-text-secondary">{item.quantity} portions sold</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-success">{formatCurrency(item.revenue)}</div>
                        <div className="text-[10px] text-text-secondary">Gross Revenue</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Daily Order Volume Bar Chart */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-text flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-accent" />
                    Daily Order Volume
                  </h3>
                  <p className="text-xs text-text-secondary">Total orders served per day</p>
                </div>
              </div>

              {analytics?.daily_sales && analytics.daily_sales.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={analytics.daily_sales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(val: number) => [val, "Orders"]}
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="orders_count" fill="#4ECDC4" name="Orders Count" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-text-secondary text-sm">
                  No order data
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: NBR MUSHAK-6.3 VAT REGISTER */}
      {activeTab === "mushak" && (
        <div className="space-y-6">
          {/* NBR Legal Compliance Header Card */}
          <Card className="p-5 bg-gradient-to-r from-bg-subtle to-bg border border-border">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary rounded">
                    গণপ্রজাতন্ত্রী বাংলাদেশ সরকার
                  </span>
                  <span className="px-2 py-0.5 text-xs font-semibold bg-success/10 text-success rounded">
                    জাতীয় রাজস্ব বোর্ড (NBR)
                  </span>
                </div>
                <h3 className="text-lg font-bold text-text">
                  মূসক-৬.৩ কর চালানপত্র রেজিস্টার (Mushak-6.3 Tax Invoice Register)
                </h3>
                <p className="text-xs text-text-secondary mt-1">
                  মূল্য সংযোজন কর ও সম্পূরক শুল্ক বিধিমালা, ২০১৬ (বিধি ৪০ এর উপ-বিধি (১) দ্রষ্টব্য)
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs text-text-secondary">
                  <span>
                    <strong>প্রতিষ্ঠানের নাম:</strong> {mushakReport?.restaurant.name} (
                    {mushakReport?.restaurant.name_bn || "N/A"})
                  </span>
                  <span>
                    <strong>করদাতা শনাক্তকরণ সংখ্যা (BIN):</strong>{" "}
                    <span className="font-mono text-text font-bold">
                      {mushakReport?.restaurant.vat_bin_no || "Pending Registration"}
                    </span>
                  </span>
                  <span>
                    <strong>ট্রেড লাইসেন্স নং:</strong>{" "}
                    <span className="font-mono text-text">
                      {mushakReport?.restaurant.trade_license_no || "N/A"}
                    </span>
                  </span>
                  <span>
                    <strong>প্রযোজ্য ভ্যাট হার:</strong>{" "}
                    <span className="text-primary font-bold">
                      {mushakReport?.restaurant.vat_rate || 5}%
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end justify-center">
                <Button
                  icon={<Download className="w-4 h-4" />}
                  variant="primary"
                  onClick={handleExportMushak}
                  disabled={!mushakReport || mushakReport.invoices.length === 0}
                >
                  Download Mushak-6.3 CSV
                </Button>
              </div>
            </div>
          </Card>

          {/* Mushak Period Summary Banner */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="p-3 bg-bg-subtle rounded-lg border border-border text-center">
              <div className="text-xs text-text-secondary uppercase">মোট চালান (Invoices)</div>
              <div className="text-lg font-bold text-text mt-1">
                {mushakReport?.summary.total_invoices || 0}
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border text-center">
              <div className="text-xs text-text-secondary uppercase">মোট বিক্রয় (Subtotal)</div>
              <div className="text-lg font-bold text-text mt-1">
                {formatCurrency(mushakReport?.summary.total_subtotal || 0)}
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border text-center">
              <div className="text-xs text-text-secondary uppercase">মোট হ্রাস (Discount)</div>
              <div className="text-lg font-bold text-accent mt-1">
                {formatCurrency(mushakReport?.summary.total_discount || 0)}
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border text-center">
              <div className="text-xs text-text-secondary uppercase">করযোগ্য মূল্য (Taxable)</div>
              <div className="text-lg font-bold text-text mt-1">
                {formatCurrency(mushakReport?.summary.total_taxable || 0)}
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border text-center">
              <div className="text-xs text-text-secondary uppercase">মোট মূসক (VAT)</div>
              <div className="text-lg font-bold text-warning mt-1">
                {formatCurrency(mushakReport?.summary.total_vat || 0)}
              </div>
            </div>
            <div className="p-3 bg-bg-subtle rounded-lg border border-border text-center">
              <div className="text-xs text-text-secondary uppercase">সর্বমোট প্রদেয় (Gross)</div>
              <div className="text-lg font-bold text-success mt-1">
                {formatCurrency(mushakReport?.summary.total_gross || 0)}
              </div>
            </div>
          </div>

          {/* Sequential Tax Invoice Register Table */}
          <Card className="overflow-hidden border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-bg-subtle text-text-secondary border-b border-border uppercase font-semibold">
                  <tr>
                    <th className="py-3 px-3">ক্রমিক / চালান নং</th>
                    <th className="py-3 px-3">তারিখ ও সময়</th>
                    <th className="py-3 px-3">অর্ডার নং</th>
                    <th className="py-3 px-3">ক্রেতার বিবরণ</th>
                    <th className="py-3 px-3 text-right">মূল্য (৳)</th>
                    <th className="py-3 px-3 text-right">হ্রাস (৳)</th>
                    <th className="py-3 px-3 text-right">করযোগ্য মূল্য (৳)</th>
                    <th className="py-3 px-3 text-center">ভ্যাট হার</th>
                    <th className="py-3 px-3 text-right">মূসক (৳)</th>
                    <th className="py-3 px-3 text-right">মোট টাকা (৳)</th>
                    <th className="py-3 px-3 text-center">পরিশোধ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {!mushakReport || mushakReport.invoices.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-text-secondary text-sm">
                        কোনো সম্পূর্ণ চালানপত্র পাওয়া যায়নি (No completed tax invoices in selected range)
                      </td>
                    </tr>
                  ) : (
                    mushakReport.invoices.map((inv, idx) => (
                      <tr key={inv.order_id} className="hover:bg-bg-subtle/50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-medium text-text">
                          <span className="text-text-secondary mr-1">#{idx + 1}</span> {inv.invoice_number}
                        </td>
                        <td className="py-2.5 px-3 text-text-secondary whitespace-nowrap">
                          {inv.date_time}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-text">
                          {inv.order_number}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-text">{inv.customer_name}</div>
                          <div className="text-[10px] text-text-secondary">{inv.customer_phone}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-text">
                          {inv.subtotal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-accent font-medium">
                          {inv.discount > 0 ? `-${inv.discount.toFixed(2)}` : "0.00"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-text">
                          {inv.taxable_amount.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-center text-text-secondary">
                          {inv.vat_rate}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-warning">
                          {inv.vat_amount.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-success">
                          {inv.total_amount.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="px-1.5 py-0.5 text-[10px] rounded uppercase font-semibold bg-primary/10 text-primary">
                            {inv.payment_method}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {mushakReport && mushakReport.invoices.length > 0 && (
                  <tfoot className="bg-bg-subtle border-t-2 border-border font-bold text-text">
                    <tr>
                      <td colSpan={4} className="py-3 px-3 text-right uppercase">
                        সর্বমোট (Total):
                      </td>
                      <td className="py-3 px-3 text-right">
                        {mushakReport.summary.total_subtotal.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right text-accent">
                        {mushakReport.summary.total_discount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {mushakReport.summary.total_taxable.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-center">-</td>
                      <td className="py-3 px-3 text-right text-warning">
                        {mushakReport.summary.total_vat.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right text-success">
                        {mushakReport.summary.total_gross.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-center">-</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Reports;
