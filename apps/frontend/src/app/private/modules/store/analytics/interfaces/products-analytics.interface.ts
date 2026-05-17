import { DateRangeFilter } from './analytics.interface';

// Products Summary
export interface ProductsSummary {
  total_products: number;
  active_products: number;
  total_revenue: number;
  total_units_sold: number;
  avg_revenue_per_product: number;
  revenue_growth: number;
  units_growth: number;
}

// Top Selling Product
export interface TopSellingProduct {
  product_id: number;
  product_name: string;
  sku: string;
  image_url: string | null;
  units_sold: number;
  revenue: number;
  average_price: number;
  profit_margin: number | null;
}

// Product Analytics Row (table)
export interface ProductAnalyticsRow {
  product_id: number;
  name: string;
  sku: string;
  image_url: string | null;
  base_price: number;
  cost_price: number;
  stock_quantity: number;
  units_sold: number;
  revenue: number;
  avg_order_value: number;
  profit_margin: number | null;
  last_sold_at: string | null;
}

// Product Trend (time series)
export interface ProductTrend {
  period: string;
  units_sold: number;
  revenue: number;
}

// Product Profitability
export interface ProductProfitability {
  product_id: number;
  product_name: string;
  sku: string;
  category: string | null;
  revenue: number;
  total_cost: number;
  profit: number;
  margin: number;
  markup: number;
  units_sold: number;
  avg_selling_price: number;
  catalog_base_price: number;
  catalog_cost_price: number;
  catalog_margin: number | null;
}

export interface ProfitabilitySummary {
  total_products: number;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  overall_margin: number;
}

export interface ProfitabilityResponse {
  products: ProductProfitability[];
  summary: ProfitabilitySummary;
}

// Query DTO for Products Analytics
export interface ProductsAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  category_id?: number;
  brand_id?: number;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: string;
}
