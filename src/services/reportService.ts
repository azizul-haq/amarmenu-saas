import { supabase } from "../config/supabase";
import { reportDateRangeSchema } from "../schemas/reportSchema";
import type {
  SalesAnalyticsData,
  Mushak63ReportData,
} from "../schemas/reportSchema";

/**
 * Fetch complete sales analytics including gross, net, VAT, daily trends and top items
 */
export const getRestaurantSalesAnalytics = async (
  restaurantId: string,
  startDate: string,
  endDate: string
): Promise<{
  success: boolean;
  data?: SalesAnalyticsData;
  error?: string;
}> => {
  const validation = reportDateRangeSchema.safeParse({
    restaurantId,
    startDate,
    endDate,
  });

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid report parameters",
    };
  }

  const { data, error } = await supabase.rpc("get_restaurant_sales_analytics", {
    p_restaurant_id: restaurantId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to load sales analytics",
    };
  }

  return {
    success: true,
    data: data as SalesAnalyticsData,
  };
};

/**
 * Fetch official Bangladesh NBR Mushak-6.3 VAT Tax Invoice Register
 */
export const getMushak63Report = async (
  restaurantId: string,
  startDate: string,
  endDate: string
): Promise<{
  success: boolean;
  data?: Mushak63ReportData;
  error?: string;
}> => {
  const validation = reportDateRangeSchema.safeParse({
    restaurantId,
    startDate,
    endDate,
  });

  if (!validation.success) {
    return {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid report parameters",
    };
  }

  const { data, error } = await supabase.rpc("get_mushak_6_3_report", {
    p_restaurant_id: restaurantId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || !data) {
    return {
      success: false,
      error: error?.message || "Failed to load Mushak-6.3 report",
    };
  }

  return {
    success: true,
    data: data as Mushak63ReportData,
  };
};

/**
 * Export official Mushak-6.3 Tax Invoice Register to CSV
 */
export const exportMushak63CSV = (report: Mushak63ReportData): void => {
  const { restaurant, period, summary, invoices } = report;

  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines: string[] = [
    `"GOVERNMENT OF THE PEOPLE'S REPUBLIC OF BANGLADESH"`,
    `"NATIONAL BOARD OF REVENUE (NBR)"`,
    `"MUSHAK-6.3 TAX INVOICE REGISTER (কর চালানপত্র রেজিস্টার)"`,
    `"Restaurant: ${restaurant.name} (${restaurant.name_bn || ""})"`,
    `"Address: ${restaurant.address || "Dhaka, Bangladesh"}"`,
    `"VAT BIN: ${restaurant.vat_bin_no || "N/A"}"`,
    `"Trade License: ${restaurant.trade_license_no || "N/A"}"`,
    `"Period: ${new Date(period.start_date).toLocaleDateString()} to ${new Date(period.end_date).toLocaleDateString()}"`,
    "",
    [
      escapeCSV("Invoice No"),
      escapeCSV("Order No"),
      escapeCSV("Date & Time"),
      escapeCSV("Customer Name"),
      escapeCSV("Customer Phone"),
      escapeCSV("Subtotal (BDT)"),
      escapeCSV("Discount (BDT)"),
      escapeCSV("Net Taxable Value (BDT)"),
      escapeCSV("VAT Rate (%)"),
      escapeCSV("VAT Collected (BDT)"),
      escapeCSV("Gross Total (BDT)"),
      escapeCSV("Payment Method"),
    ].join(","),
  ];

  invoices.forEach((inv) => {
    lines.push(
      [
        escapeCSV(inv.invoice_number),
        escapeCSV(inv.order_number),
        escapeCSV(inv.date_time),
        escapeCSV(inv.customer_name),
        escapeCSV(inv.customer_phone),
        inv.subtotal.toFixed(2),
        inv.discount.toFixed(2),
        inv.taxable_amount.toFixed(2),
        `${inv.vat_rate}%`,
        inv.vat_amount.toFixed(2),
        inv.total_amount.toFixed(2),
        escapeCSV(inv.payment_method.toUpperCase()),
      ].join(",")
    );
  });

  // Summary row
  lines.push("");
  lines.push(
    [
      escapeCSV("TOTALS"),
      escapeCSV(`${summary.total_invoices} Invoices`),
      escapeCSV("-"),
      escapeCSV("-"),
      escapeCSV("-"),
      summary.total_subtotal.toFixed(2),
      summary.total_discount.toFixed(2),
      summary.total_taxable.toFixed(2),
      escapeCSV("-"),
      summary.total_vat.toFixed(2),
      summary.total_gross.toFixed(2),
      escapeCSV("-"),
    ].join(",")
  );

  const csvContent = "\uFEFF" + lines.join("\r\n"); // Add UTF-8 BOM for Bangla character support in Excel
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Mushak_6_3_${restaurant.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Export Sales Analytics summary, top items and daily metrics to CSV
 */
export const exportSalesAnalyticsCSV = (analytics: SalesAnalyticsData): void => {
  const { restaurant, period, summary, payment_breakdown, top_items, daily_sales } = analytics;

  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines: string[] = [
    `"AmarMenu Sales & Financial Analytics Report"`,
    `"Restaurant: ${restaurant.name}"`,
    `"Period: ${new Date(period.start_date).toLocaleDateString()} to ${new Date(period.end_date).toLocaleDateString()}"`,
    "",
    `"--- FINANCIAL SUMMARY ---"`,
    `"Metric","Amount (BDT)"`,
    `"Gross Sales",${summary.gross_sales.toFixed(2)}`,
    `"Net Sales (Excl. Tax)",${summary.net_sales.toFixed(2)}`,
    `"NBR VAT Collected",${summary.vat_collected.toFixed(2)}`,
    `"Discounts Given",${summary.discount_total.toFixed(2)}`,
    `"Total Orders Completed",${summary.total_orders}`,
    `"Average Order Value",${summary.avg_order_value.toFixed(2)}`,
    `"Voided Orders",${summary.voided_orders}`,
    "",
    `"--- PAYMENT METHOD SPLIT ---"`,
    `"Payment Method","Amount (BDT)"`,
    `"Cash",${payment_breakdown.cash_sales.toFixed(2)}`,
    `"bKash",${payment_breakdown.bkash_sales.toFixed(2)}`,
    `"Nagad",${payment_breakdown.nagad_sales.toFixed(2)}`,
    `"Card",${payment_breakdown.card_sales.toFixed(2)}`,
    `"Other",${payment_breakdown.other_sales.toFixed(2)}`,
    "",
    `"--- TOP SELLING ITEMS ---"`,
    `"Rank","Item Name","Quantity Sold","Total Revenue (BDT)"`,
  ];

  top_items.forEach((item, index) => {
    lines.push(
      `${index + 1},${escapeCSV(item.name)},${item.quantity},${item.revenue.toFixed(2)}`
    );
  });

  lines.push("");
  lines.push(`"--- DAILY SALES TREND ---"`);
  lines.push(`"Date","Orders Count","Net Sales","VAT Collected","Gross Sales"`);

  daily_sales.forEach((day) => {
    lines.push(
      `${escapeCSV(day.date)},${day.orders_count},${day.net_sales.toFixed(2)},${day.vat_collected.toFixed(2)},${day.gross_sales.toFixed(2)}`
    );
  });

  const csvContent = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Sales_Analytics_${restaurant.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
