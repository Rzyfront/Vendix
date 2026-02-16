import { DateRangeFilter } from './analytics.interface';

// Inventory Summary
export interface InventorySummary {
  total_sku_count: number;
  total_stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
  low_stock_percentage: number;
  out_of_stock_percentage: number;
  total_quantity_on_hand: number;
}

// Stock Level Report
export interface StockLevelReport {
  product_id: number;
  product_name: string;
  sku: string;
  image_url?: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  reorder_point: number;
  cost_per_unit: number;
  total_value: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';
  days_of_stock?: number;
}

// Stock Movement Report
export interface StockMovementReport {
  id: number;
  date: string;
  product_id: number;
  product_name: string;
  sku: string;
  movement_type: 'in' | 'out' | 'transfer' | 'adjustment';
  quantity: number;
  from_location?: string;
  to_location?: string;
  reason?: string;
  user_name?: string;
  reference_id?: string;
}

// Inventory Valuation
export interface InventoryValuation {
  location_id: number;
  location_name: string;
  total_quantity: number;
  total_value: number;
  average_cost: number;
  percentage_of_total: number;
}

// Inventory Aging
export interface InventoryAging {
  product_id: number;
  product_name: string;
  sku: string;
  quantity_on_hand: number;
  days_without_movement: number;
  last_movement_date: string;
  status: 'active' | 'slow' | 'dead';
}

// Expiring Product
export interface ExpiringProduct {
  product_id: number;
  product_name: string;
  sku: string;
  lot_number: string;
  expiration_date: string;
  quantity: number;
  days_until_expiry: number;
  status: 'ok' | 'warning' | 'critical' | 'expired';
}

// Movement Summary (aggregated by type)
export interface MovementSummaryItem {
  movement_type: string;
  count: number;
  total_quantity: number;
  percentage: number;
}

// Movement Trend (time-series)
export interface MovementTrend {
  period: string;
  stock_in: number;
  stock_out: number;
  adjustments: number;
  transfers: number;
  total: number;
}

// Query DTO for Inventory Analytics
export interface InventoryAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  location_id?: number;
  category_id?: number;
  status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';
  movement_type?: string;
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
  days_threshold?: number;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}
