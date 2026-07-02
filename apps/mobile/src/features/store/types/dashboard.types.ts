export interface StoreDashboardStats {
  dispatchPendingCount: number;
  refundPendingCount: number;
  dispatchPendingOrders: DispatchPendingOrder[];
  refundPendingOrders: RefundPendingOrder[];
}

export interface DispatchPendingOrder {
  id: string;
  customerName: string;
  items: number;
  amount: number;
  createdAt: string;
}

export interface RefundPendingOrder {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  refundAmount: number;
  state: string;
}

export interface SalesSummary {
  total_revenue: number;
  total_orders: number;
  average_order_value: number;
  total_units_sold: number;
  total_customers: number;
  revenue_growth?: number;
  orders_growth?: number;
}

export interface SalesTrend {
  period: string;
  revenue: number;
  orders: number;
  units_sold: number;
  average_order_value: number;
}

export interface SalesByChannel {
  channel: string;
  display_name: string;
  order_count: number;
  revenue: number;
  percentage: number;
}

export interface InventorySummary {
  total_products: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_value: number;
}

/**
 * Fila individual de "Ventas por Producto" (analytics/sales/by-product).
 * Paridad con apps/frontend `sales-by-product.component.ts`:
 *   product_id, product_name, units_sold, revenue, orders_count.
 * `image_url` es opcional — backend puede no devolverlo si el producto
 * no tiene imagen principal configurada.
 */
export interface SalesByProduct {
  product_id: number;
  product_name: string;
  units_sold: number;
  revenue: number;
  orders_count: number;
  image_url?: string | null;
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'custom';

export interface DateRange {
  start_date: string;
  end_date: string;
  preset?: DatePreset;
}
