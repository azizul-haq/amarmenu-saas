import { z } from "zod";

export const reportDateRangeSchema = z.object({
  restaurantId: z.string().uuid("Invalid restaurant ID"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
});

export type ReportDateRangeInput = z.infer<typeof reportDateRangeSchema>;

export interface SalesSummary {
  gross_sales: number;
  net_sales: number;
  vat_collected: number;
  discount_total: number;
  total_orders: number;
  avg_order_value: number;
  voided_orders: number;
}

export interface PaymentBreakdown {
  cash_sales: number;
  bkash_sales: number;
  nagad_sales: number;
  card_sales: number;
  other_sales: number;
  methods: Array<{
    method: string;
    amount: number;
    count: number;
  }>;
}

export interface OrderTypeDistribution {
  type: string;
  count: number;
  revenue: number;
}

export interface DailySalesMetric {
  date: string;
  label: string;
  gross_sales: number;
  net_sales: number;
  vat_collected: number;
  orders_count: number;
}

export interface TopSellingItem {
  name: string;
  quantity: number;
  revenue: number;
}

export interface RestaurantHeaderInfo {
  id: string;
  name: string;
  name_bn?: string | null;
  address?: string | null;
  vat_bin_no?: string | null;
  trade_license_no?: string | null;
  currency_symbol?: string;
  vat_rate?: number;
}

export interface SalesAnalyticsData {
  success: boolean;
  restaurant: RestaurantHeaderInfo;
  period: {
    start_date: string;
    end_date: string;
  };
  summary: SalesSummary;
  payment_breakdown: PaymentBreakdown;
  order_types: OrderTypeDistribution[];
  daily_sales: DailySalesMetric[];
  top_items: TopSellingItem[];
}

export interface MushakInvoiceRow {
  order_id: string;
  invoice_number: string;
  order_number: string;
  date_time: string;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  discount: number;
  taxable_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  payment_method: string;
}

export interface MushakSummary {
  total_invoices: number;
  total_subtotal: number;
  total_discount: number;
  total_taxable: number;
  total_vat: number;
  total_gross: number;
}

export interface Mushak63ReportData {
  success: boolean;
  mushak_form: string;
  title: string;
  restaurant: RestaurantHeaderInfo;
  period: {
    start_date: string;
    end_date: string;
  };
  summary: MushakSummary;
  invoices: MushakInvoiceRow[];
}
