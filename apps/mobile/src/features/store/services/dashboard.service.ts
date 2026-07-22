import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  StoreDashboardStats,
  SalesSummary,
  SalesTrend,
  SalesByChannel,
  SalesByProduct,
  SalesByCategory,
  SalesByCustomer,
  SalesByPaymentMethod,
  InventorySummary,
  DateRange,
  ProfitLossSummary,
} from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

function dateParams(range?: DateRange): Record<string, string> {
  if (!range) return {};
  return {
    date_from: range.start_date,
    date_to: range.end_date,
    ...(range.preset ? { date_preset: range.preset } : {}),
  };
}

export const DashboardService = {
  async getStats(): Promise<StoreDashboardStats> {
    const res = await apiClient.get(Endpoints.STORE.DASHBOARD_STATS);
    return unwrap<StoreDashboardStats>(res);
  },
  async getProfitLossSummary(range?: DateRange): Promise<ProfitLossSummary | null> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(
      `${Endpoints.STORE.ANALYTICS.PROFIT_LOSS}${qs ? `?${qs}` : ''}`,
    );
    const body = res.data as ApiResponse<ProfitLossSummary> | ProfitLossSummary | null;
    if (!body) return null;
    if (typeof body === 'object' && 'success' in body) {
      return (body as ApiResponse<ProfitLossSummary>).data ?? null;
    }
    return body as ProfitLossSummary;
  },
};

export const AnalyticsService = {
  async getSalesSummary(range?: DateRange): Promise<SalesSummary> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_SUMMARY}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesSummary>(res);
  },

  async getSalesTrends(range?: DateRange, granularity = 'day'): Promise<SalesTrend[]> {
    const params = { ...dateParams(range), granularity };
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_TRENDS}?${qs}`);
    return unwrap<SalesTrend[]>(res);
  },

  async getSalesByChannel(range?: DateRange): Promise<SalesByChannel[]> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_BY_CHANNEL}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesByChannel[]>(res);
  },

  /**
   * Ventas por producto (analytics/sales/by-product). Paridad con
   * apps/frontend `sales-by-product.component.ts` — el backend devuelve
   * una lista plana con `product_id`, `product_name`, `units_sold`,
   * `revenue`, `orders_count`. Si el rango está vacío, el endpoint usa
   * el período por defecto del backend (mes actual).
   */
  async getSalesByProduct(range?: DateRange): Promise<SalesByProduct[]> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_BY_PRODUCT}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesByProduct[]>(res);
  },

  /**
   * Ventas por categoría (analytics/sales/by-category). Paridad con
   * apps/frontend `sales-by-category.component.ts`. Backend agrega
   * order_items por product_id, mapea a categorías vía product_categories,
   * y reparte revenue/units cuando un producto tiene varias categorías.
   * Productos sin categoría se consolidan como `category_id: 0`,
   * `category_name: "Sin categoría"`.
   */
  async getSalesByCategory(range?: DateRange): Promise<SalesByCategory[]> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_BY_CATEGORY}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesByCategory[]>(res);
  },

  /**
   * Top clientes por gasto (analytics/sales/by-customer). Paridad con
   * apps/frontend `sales-by-customer.component.ts`. Backend hace
   * `prisma.orders.groupBy({ by: ['customer_id'] })` con `_sum.grand_total`
   * y cruza con `users` para nombre/email. Sin rango = mes actual.
   */
  async getSalesByCustomer(range?: DateRange): Promise<SalesByCustomer[]> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_BY_CUSTOMER}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesByCustomer[]>(res);
  },

  /**
   * Distribución de pagos por método (analytics/sales/by-payment-method).
   * Paridad con apps/frontend `sales-by-payment-method.component.ts`.
   * Backend agrega `payments.state = 'succeeded'` agrupados por
   * `store_payment_method.system_payment_method.name`. `display_name`
   * viene del merchant (configuración local) con fallback al catálogo.
   */
  async getSalesByPaymentMethod(range?: DateRange): Promise<SalesByPaymentMethod[]> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_BY_PAYMENT_METHOD}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesByPaymentMethod[]>(res);
  },

  async getInventorySummary(): Promise<InventorySummary> {
    const res = await apiClient.get(Endpoints.STORE.ANALYTICS.INVENTORY_SUMMARY);
    return unwrap<InventorySummary>(res);
  },
};
