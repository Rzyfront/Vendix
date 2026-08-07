import { DateRangeFilter } from './analytics.interface';

// Sales Summary
export interface SalesSummary {
  /**
   * QUI-610: revenue is now OPERATING revenue (subtotal − discounts + shipping).
   * VAT is excluded — it is reported separately as `total_taxes` (a DIAN
   * liability, NOT store income).
   */
  total_revenue: number;
  /**
   * QUI-610: IVA collected in the period. Display as "no es ingreso — se
   * declara a la DIAN", not as a revenue line.
   */
  total_taxes: number;
  /**
   * QUI-610: waiter tips collected. These are NOT store revenue.
   */
  total_tips: number;
  total_orders: number;
  average_order_value: number;
  total_units_sold: number;
  total_customers: number;
  /**
   * QUI-610: growth against the previous period on IDENTICAL definitions.
   * `null` when the previous period had no base — the UI must render
   * "sin base de comparación", NOT "0 %" (defect C8 of the catalog).
   */
  revenue_growth: number | null;
  orders_growth: number | null;
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
