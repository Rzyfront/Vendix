import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  OverviewSummary,
  FinancialAnalytics,
  SalesSummary,
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

/**
 * Analytics detail service — consume los endpoints `/store/analytics/*`
 * que el backend de producción tiene hoy (200 OK):
 *
 *   GET /store/analytics/sales/summary      → SalesSummary
 *   GET /store/analytics/inventory/summary  → InventorySummary
 *
 * Los endpoints `/store/analytics/{sales,inventory,financial,overview}`
 * (sin sufijo) devuelven 404 en producción y se reservan para cuando
 * backend exponga los shapes "ricos" (con `top_products`, `top_movers`,
 * `profit_loss_trends`, etc.) que las pantallas históricas consumen.
 *
 * Mientras tanto:
 *   - `getSalesAnalytics` / `getInventoryAnalytics` → usan los /summary
 *     que sí existen (devuelven SalesSummary / InventorySummary).
 *   - `getProductsAnalytics` → reusa sales/summary (no hay endpoint
 *     dedicado de productos; total_units_sold / total_orders sirven
 *     para "Total Productos Vendidos" / "Órdenes con Productos").
 *   - `getFinancialAnalytics` / `getOverviewSummary` → siguen apuntando a
 *     los endpoints que devuelven 404. Las pantallas correspondientes
 *     muestran empty state hasta que backend agregue esos endpoints.
 */
export const AnalyticsDetailService = {
  async getOverviewSummary(range?: DateRange): Promise<OverviewSummary> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.OVERVIEW}${qs ? `?${qs}` : ''}`);
    return unwrap<OverviewSummary>(res);
  },

  async getSalesAnalytics(range?: DateRange): Promise<SalesSummary> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_SUMMARY}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesSummary>(res);
  },

  async getProductsAnalytics(range?: DateRange): Promise<SalesSummary> {
    // No hay endpoint dedicado de products analytics en backend (404).
    // Reusamos sales/summary: total_units_sold = "Total Productos Vendidos",
    // total_orders = "Órdenes con Productos". Cuando backend exponga
    // /store/analytics/products (con top_products), cambiar aquí.
    return this.getSalesAnalytics(range);
  },

  async getInventoryAnalytics(range?: DateRange): Promise<InventorySummary> {
    // InventorySummary no acepta rango de fechas en backend hoy.
    const res = await apiClient.get(Endpoints.STORE.ANALYTICS.INVENTORY_SUMMARY);
    return unwrap<InventorySummary>(res);
  },

  async getFinancialAnalytics(range?: DateRange): Promise<FinancialAnalytics> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.FINANCIAL}${qs ? `?${qs}` : ''}`);
    return unwrap<FinancialAnalytics>(res);
  },
};