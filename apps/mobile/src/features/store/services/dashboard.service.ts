import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  StoreDashboardStats,
  SalesSummary,
  SalesTrend,
  SalesByChannel,
  SalesByProduct,
  InventorySummary,
  DateRange,
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

  async getInventorySummary(): Promise<InventorySummary> {
    const res = await apiClient.get(Endpoints.STORE.ANALYTICS.INVENTORY_SUMMARY);
    return unwrap<InventorySummary>(res);
  },
};
