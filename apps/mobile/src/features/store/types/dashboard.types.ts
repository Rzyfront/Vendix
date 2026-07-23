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

/**
 * Fila individual de "Ventas por Categoría" (analytics/sales/by-category).
 * Paridad con apps/frontend `sales-by-category.component.ts`.
 * Backend agrega a nivel de product_categories y reparte revenue/units
 * entre todas las categorías del producto (multi-categoría soportado).
 * Productos sin categoría se consolidan en `category_id: 0` con
 * `category_name: "Sin categoría"` (ver `sales-analytics.service.ts`).
 */
export interface SalesByCategory {
  category_id: number;
  category_name: string;
  units_sold: number;
  revenue: number;
  percentage_of_total: number;
}

/**
 * Fila individual de "Top Clientes" (analytics/sales/by-customer).
 * Paridad con apps/frontend `sales-by-customer.component.ts`.
 * `customer_id` puede ser `null` para órdenes sin cliente (consolidado
 * en "Cliente" en backend). `last_order_date` viene como ISO string
 * (`toISOString()` en backend) o `null` si no hay órdenes.
 */
export interface SalesByCustomer {
  customer_id: number | null;
  customer_name: string;
  email: string;
  total_orders: number;
  total_spent: number;
  average_order_value: number;
  last_order_date: string | null;
}

/**
 * Fila individual de "Métodos de Pago" (analytics/sales/by-payment-method).
 * Paridad con apps/frontend `sales-by-payment-method.component.ts`.
 * `payment_method` es el `name` interno del `system_payment_method`
 * (e.g. `"cash"`, `"card"`, `"nequi"`); `display_name` es la etiqueta
 * localizada que el merchant configuró (o el fallback del sistema).
 */
export interface SalesByPaymentMethod {
  payment_method: string;
  display_name: string;
  transaction_count: number;
  total_amount: number;
  percentage: number;
}

// Re-export from canonical location to keep types unified across the app.
// `DateRangeFilterValue` (shared) y `DateRange` (features) usan exactamente
// el mismo union. Si agregas un preset, edita solo `shared/types/date.ts`.
export type { DatePreset } from '@/shared/types/date';
import type { DatePreset } from '@/shared/types/date';

export interface DateRange {
  start_date: string;
  end_date: string;
  preset?: DatePreset;
}

/**
 * Resumen Profit & Loss (paridad con `apps/frontend` `ProfitLossSummary`).
 * Consumido por el dashboard Store Admin para mostrar Ganancias y Gastos
 * del mismo período que las métricas de ventas. Los valores monetarios
 * vienen como `number` (el backend los entrega numéricos).
 */
export interface ProfitLossSummary {
  period: { start_date: string; end_date: string };
  revenue: {
    gross_revenue: number;
    discounts: number;
    net_revenue: number;
    shipping_revenue: number;
    tax_collected: number;
  };
  costs: {
    cost_of_goods_sold: number;
    gross_profit: number;
    gross_margin: number;
  };
  refunds: {
    total_refunds: number;
    subtotal_refunds: number;
    tax_refunds: number;
    shipping_refunds: number;
  };
  operating_expenses: number;
  bottom_line: {
    net_profit: number;
    net_margin: number;
    order_count: number;
  };
}
