import { DateRangeFilter } from './analytics.interface';

// Customers Summary
export interface CustomersSummary {
  total_customers: number;
  active_customers: number;
  inactive_customers: number;
  new_customers: number;
  new_customers_growth?: number;
  average_spend: number;
  average_spend_growth?: number;
}

// Customer Trend data point
export interface CustomerTrend {
  period: string;
  new_customers: number;
  cumulative_customers: number;
}

// Top Customer by spend
export interface TopCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  last_order_date: string | null;
}

// Query DTO for Customers Analytics
export interface CustomersAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
}
