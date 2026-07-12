export interface OverviewSummary {
  total_revenue: number;
  total_expenses: number;
  total_taxes: number;
  net_profit: number;
  revenue_growth: number;
  expense_growth: number;
  profit_margin: number;
}

export interface SalesAnalytics {
  total_revenue: number;
  total_orders: number;
  average_ticket: number;
  total_products_sold: number;
  top_products: Array<{
    product_name: string;
    quantity_sold: number;
    revenue: number;
  }>;
  trends: Array<{
    period: string;
    revenue: number;
    orders: number;
  }>;
  by_channel: Array<{
    channel: string;
    revenue: number;
    count: number;
  }>;
  /**
   * Campos opcionales — los consume `sales.tsx` (sub-PR #4) para mostrar
   * growth % y AOV en las StatCards. El backend `/store/analytics/sales`
   * NO los devuelve hoy (404 — ver JSDoc en `analytics.service.ts`).
   * Mientras tanto, el screen cae en empty state porque el query falla.
   * Marcar como opcionales deja el shape `SalesAnalytics` compatible con
   * el consumer nuevo sin perder el contrato con el shape original.
   */
  revenue_growth?: number;
  orders_growth?: number;
  average_order_value?: number;
  total_units_sold?: number;
}

export interface InventoryAnalytics {
  total_products: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_value: number;
  top_movers: Array<{
    product_name: string;
    total_moved: number;
  }>;
  low_stock_items: Array<{
    product_name: string;
    current_stock: number;
    threshold: number;
  }>;
}

export interface FinancialAnalytics {
  gross_profit: number;
  net_profit: number;
  total_taxes: number;
  total_refunds: number;
  profit_loss_trends: Array<{
    period: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
}
