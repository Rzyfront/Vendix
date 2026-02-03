import { DateRangeFilter } from './analytics.interface';

// Sales Summary
export interface SalesSummary {
  total_revenue: number;
  total_orders: number;
  average_order_value: number;
  total_units_sold: number;
  total_customers: number;
  revenue_growth?: number;
  orders_growth?: number;
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

// Query DTO for Sales Analytics
export interface SalesAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  category_id?: number;
  brand_id?: number;
  payment_method?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
}
