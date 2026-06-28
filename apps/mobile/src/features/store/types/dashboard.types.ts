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
  // Ganancia neta del período (Ingresos − Costos − Gastos). Web parity
  // con apps/frontend store/dashboard: stat "Ganancias".
  total_profit?: number;
  // Gastos operativos del período (POS, compras, gastos varios). Web parity:
  // stat "Gastos". Si el backend aún no expone el campo, llega undefined.
  total_expenses?: number;
  revenue_growth?: number;
  orders_growth?: number;
  profit_growth?: number;
  expenses_growth?: number;
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

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom';

export interface DateRange {
  start_date: string;
  end_date: string;
  preset?: DatePreset;
}

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

// Paridad con web: apps/frontend/.../sales-analytics.interface.ts → SalesByCategory
export interface SalesByCategory {
  category_id: number;
  category_name: string;
  units_sold: number;
  revenue: number;
  percentage_of_total: number;
}

// Paridad con web: apps/frontend/.../sales-analytics.interface.ts → SalesByCustomer
export interface SalesByCustomer {
  customer_id: number;
  customer_name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  average_order_value: number;
  last_order_date: string | null;
}

// Paridad con web: apps/frontend/.../sales-analytics.interface.ts → SalesByPaymentMethod
export interface SalesByPaymentMethod {
  payment_method: string;
  display_name: string;
  transaction_count: number;
  total_amount: number;
  percentage: number;
}
