import { supabase } from "../config/supabase";
import { platformDateRangeSchema } from "../schemas/platformAnalyticsSchema";
import type {
  PlatformAnalyticsData,
} from "../schemas/platformAnalyticsSchema";

/**
 * Fetch cross-tenant platform analytics (GMV, volume, top restaurants, city distribution)
 */
export const getPlatformAnalytics = async (
  startDate: string,
  endDate: string
): Promise<{
  success: boolean;
  data?: PlatformAnalyticsData;
  error?: string;
}> => {
  const validation = platformDateRangeSchema.safeParse({
    startDate,
    endDate,
  });

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid date parameters",
    };
  }

  const { data, error } = await supabase.rpc("get_platform_analytics", {
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to load platform analytics",
    };
  }

  return {
    success: true,
    data: data as PlatformAnalyticsData,
  };
};

/**
 * Export platform analytics overview, top restaurants, and trends to CSV
 */
export const exportPlatformAnalyticsCSV = (data: PlatformAnalyticsData): void => {
  const { period, overview, top_restaurants, city_distribution, daily_trend } = data;

  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines: string[] = [
    `"AmarMenu SaaS Platform Analytics & GMV Report"`,
    `"Period: ${new Date(period.start_date).toLocaleDateString()} to ${new Date(period.end_date).toLocaleDateString()}"`,
    "",
    `"--- PLATFORM OVERVIEW ---"`,
    `"Metric","Value"`,
    `"Gross Merchandise Volume (GMV)",${overview.total_gmv.toFixed(2)}`,
    `"Total Orders Completed",${overview.total_orders}`,
    `"All Orders Placed",${overview.total_all_orders}`,
    `"Average Order Value (AOV)",${overview.avg_order_value.toFixed(2)}`,
    `"NBR VAT Generated",${overview.total_vat.toFixed(2)}`,
    `"Total Discounts Given",${overview.total_discounts.toFixed(2)}`,
    `"Voided/Cancelled Orders",${overview.total_voided}`,
    `"SaaS Subscription Revenue Collected",${overview.saas_revenue.toFixed(2)}`,
    `"Active Restaurant Tenants",${overview.active_tenants}`,
    `"Total Restaurant Tenants",${overview.total_tenants}`,
    "",
    `"--- TOP PERFORMING RESTAURANTS (GMV) ---"`,
    `"Rank","Restaurant Name","City","Plan Tier","Status","Orders Completed","Total GMV (BDT)"`,
  ];

  top_restaurants.forEach((r, idx) => {
    lines.push(
      `${idx + 1},${escapeCSV(r.restaurant_name)},${escapeCSV(r.city)},${escapeCSV(r.plan_code.toUpperCase())},${escapeCSV(r.status)},${r.completed_orders},${r.total_gmv.toFixed(2)}`
    );
  });

  lines.push("");
  lines.push(`"--- GEOGRAPHIC DISTRIBUTION ---"`);
  lines.push(`"City/Division","Restaurants Count","Orders Count","Total GMV (BDT)"`);

  city_distribution.forEach((c) => {
    lines.push(
      `${escapeCSV(c.city)},${c.restaurant_count},${c.orders_count},${c.gmv.toFixed(2)}`
    );
  });

  lines.push("");
  lines.push(`"--- DAILY PLATFORM TREND ---"`);
  lines.push(`"Date","Orders Count","Platform GMV (BDT)","VAT Generated (BDT)"`);

  daily_trend.forEach((d) => {
    lines.push(
      `${escapeCSV(d.date)},${d.orders_count},${d.gmv.toFixed(2)},${d.vat_collected.toFixed(2)}`
    );
  });

  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Platform_Analytics_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
