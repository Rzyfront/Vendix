/**
 * Common interfaces for the Analytics module
 */

// Date Range Filter
export interface DateRangeFilter {
  start_date: string;
  end_date: string;
  preset?:
    | 'today'
    | 'yesterday'
    | 'thisWeek'
    | 'lastWeek'
    | 'thisMonth'
    | 'lastMonth'
    | 'thisYear'
    | 'lastYear'
    | 'custom';
}

// Base Query DTO for all analytics
export interface AnalyticsQueryDto {
  date_range?: DateRangeFilter;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
}

// Summary Card for stats display
export interface AnalyticsSummaryCard {
  title: string;
  value: number | string;
  previousValue?: number | string;
  change?: number;
  changeType?: 'increase' | 'decrease' | 'neutral';
  icon: string;
  iconBgColor: string;
  iconColor: string;
  format?: 'currency' | 'number' | 'percentage';
}

// Chart data point
export interface ChartDataPoint {
  label: string;
  value: number;
  date?: string;
  metadata?: Record<string, any>;
}

// Generic API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

// Paginated Response
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      total_pages: number;
    };
  };
}

// Analytics response with summary and chart data
export interface AnalyticsResponse<T> {
  data: T;
  summary?: AnalyticsSummaryCard[];
  chart_data?: ChartDataPoint[];
  meta: {
    generated_at: string;
    date_range?: DateRangeFilter;
    total_records?: number;
  };
}

// Analytics Category for navigation
export interface AnalyticsCategory {
  id: string;
  label: string;
  description: string;
  icon: string;
  route: string;
  color: string;
  items: AnalyticsItem[];
}

// Individual analytics item
export interface AnalyticsItem {
  id: string;
  label: string;
  description: string;
  route: string;
}
