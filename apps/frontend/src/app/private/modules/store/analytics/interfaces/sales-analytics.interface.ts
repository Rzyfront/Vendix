import { DateRangeFilter } from './analytics.interface';

// Sales Summary
export interface SalesSummary {
  total_revenue: number;
  /**
   * IVA + consumption tax collected. Excluded from `total_revenue` (it's a
   * liability, not income). Surfaced separately so the panel can show the tax
   * collected this period while keeping the operating-revenue number clean.
   */
  total_taxes?: number;
  /** Tips collected this period, surfaced for the same reason as taxes. */
  total_tips?: number;
  total_orders: number;
  average_order_value: number;
  total_units_sold: number;
  total_customers: number;
  /**
   * Growth as a percentage. `null` (NOT `0`) when the previous period is `0`,
   * which means there is no comparable base. Frontends must render `null` as
   * "—" or "sin base", never as "+0%". The `computeGrowth` helper in
   * `analytics-metrics.contract.ts` enforces this convention server-side.
   */
  revenue_growth?: number | null;
  orders_growth?: number | null;
}

// Sales by Product
export interface SalesByProduct {
  product_id: number;
  product_name: string;
  sku: string;
  image_url?: string;
  units_sold: number;
  revenue: number;
  average_price: number;
  profit_margin?: number;
}

// Sales by Category
export interface SalesByCategory {
  category_id: number;
  category_name: string;
  units_sold: number;
  revenue: number;
  percentage_of_total: number;
}

// Sales by Payment Method
export interface SalesByPaymentMethod {
  payment_method: string;
  display_name: string;
  transaction_count: number;
  total_amount: number;
  percentage: number;
}

// Sales Trend data point
export interface SalesTrend {
  period: string;
  revenue: number;
  orders: number;
  units_sold: number;
  average_order_value: number;
}

// Sales by Customer
export interface SalesByCustomer {
  customer_id: number;
  customer_name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  average_order_value: number;
  last_order_date: string | null;
}

// Sales by Channel
export interface SalesByChannel {
  channel: string;
  display_name: string;
  order_count: number;
  revenue: number;
  percentage: number;
}

// Query DTO for Sales Analytics
export interface SalesAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  category_id?: number;
  brand_id?: number;
  payment_method?: string;
  channel?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
}
