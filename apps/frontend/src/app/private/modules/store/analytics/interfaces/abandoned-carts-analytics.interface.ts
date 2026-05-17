import { DateRangeFilter } from './analytics.interface';

export interface AbandonedCartsSummary {
  total_abandoned_carts: number;
  total_abandoned_value: number;
  abandonment_rate: number;
  abandonment_rate_growth?: number;
  recovered_carts: number;
  recovered_value: number;
  recovery_rate: number;
  recovery_rate_growth?: number;
  average_cart_value: number;
  potential_recovery_value: number;
}

export interface AbandonedCartTrend {
  period: string;
  abandoned_carts: number;
  recovered_carts: number;
  abandonment_rate: number;
  recovery_rate: number;
}

export interface AbandonedCartByReason {
  reason: string;
  count: number;
  percentage: number;
  total_value: number;
}

export interface AbandonedCartByHour {
  hour: number;
  abandoned_carts: number;
  recovery_rate: number;
}

export interface AbandonedCartsAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
}
