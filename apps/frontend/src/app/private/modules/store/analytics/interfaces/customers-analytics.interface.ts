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
  customer_name?: string;
  first_name?: string;
  last_name?: string;
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

// Acquisition Channel
export interface AcquisitionChannel {
  channel: string;
  orders: number;
  revenue: number;
  percentage: number;
}

// Customers By Channel Response
export interface CustomersByChannel {
  summary: {
    total_customers: number;
    total_new_customers: number;
    total_orders: number;
    total_revenue: number;
  };
  channels: AcquisitionChannel[];
}

// QUI-540: Customer Accounts Receivable row
export interface CustomerReceivableRow {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  customer_document: string;
  document_number: string;
  source_type: string;
  source_id: number;
  issue_date: string | Date;
  due_date: string | Date;
  days_overdue: number;
  aging_bucket: '0-30' | '31-60' | '61-90' | '90+';
  original_amount: number;
  paid_amount: number;
  balance: number;
  currency: string;
  status: string;
  last_payment_date: string | Date | null;
}

