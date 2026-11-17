import { z } from "zod";

export const platformDateRangeSchema = z.object({
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
});

export type PlatformDateRangeInput = z.infer<typeof platformDateRangeSchema>;

export interface PlatformOverviewMetrics {
  total_gmv: number;
  total_orders: number;
  total_all_orders: number;
  avg_order_value: number;
  total_vat: number;
  total_discounts: number;
  total_voided: number;
  saas_revenue: number;
  active_tenants: number;
  total_tenants: number;
}

export interface DailyTrendMetric {
  date: string;
  label: string;
  gmv: number;
  orders_count: number;
  vat_collected: number;
}

export interface TopRestaurantMetric {
  restaurant_id: string;
  restaurant_name: string;
  city: string;
  plan_code: string;
  status: string;
  completed_orders: number;
  total_gmv: number;
}

export interface CityDistributionMetric {
  city: string;
  restaurant_count: number;
  orders_count: number;
  gmv: number;
}

export interface OrderTypeMetric {
  type: string;
  count: number;
  gmv: number;
}

export interface PaymentMethodMetric {
  method: string;
  amount: number;
  count: number;
}

export interface PlatformAnalyticsData {
  success: boolean;
  period: {
    start_date: string;
    end_date: string;
  };
  overview: PlatformOverviewMetrics;
  daily_trend: DailyTrendMetric[];
  top_restaurants: TopRestaurantMetric[];
  city_distribution: CityDistributionMetric[];
  order_types: OrderTypeMetric[];
  payment_methods: PaymentMethodMetric[];
}
