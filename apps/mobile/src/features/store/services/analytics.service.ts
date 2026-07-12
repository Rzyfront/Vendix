import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  OverviewSummary,
  SalesAnalytics,
  SalesSummary,
  InventoryAnalytics,
  FinancialAnalytics,
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
 * del backend de producción. Las firmas de los métodos reflejan el shape
 * esperado por los consumers (analytics/{overview,sales,inventory,financial}.tsx);
 * los tipos `SalesAnalytics`/`InventoryAnalytics` prometen los campos ricos
 * (`top_products`, `top_movers`, `trends`, etc.) que los screens consumen.
 *
 * Estado real del backend hoy (sub-PR #4 verificado contra
 * apps/backend/src/domains/store/analytics/analytics.controller.ts):
 *   - `/store/analytics/sales/summary` y `/store/analytics/inventory/summary`
 *     → 200 OK, devuelven `SalesSummary` / `InventorySummary` (shape reducido).
 *   - `/store/analytics/{sales,inventory,financial,overview}` (sin sufijo)
 *     → 404 (no implementados). Los screens correspondientes muestran
 *     empty state hasta que backend exponga los shapes "ricos".
 *   - `/store/analytics/products/{summary,top-sellers,trends,table,
 *     performance,profitability}` → 200 OK (existe el controller). No los
 *     usamos todavía — `getProductsAnalytics` reusa `/sales/summary`
 *     como fuente agregada hasta que se migre a `products/summary`.
 *
 * Los consumers usan optional chaining (`data?.top_movers?.length > 0`) por
 * lo que la falta de los campos ricos a runtime NO rompe la UI — solo
 * mantiene las tarjetas de "Productos Más Movidos" / "Alertas de Stock Bajo"
 * ocultas cuando el backend devuelve el shape reducido. Cuando backend
 * exponga los shapes ricos, basta cambiar los endpoints en este archivo.
 */
export const AnalyticsDetailService = {
  async getOverviewSummary(range?: DateRange): Promise<OverviewSummary> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.OVERVIEW}${qs ? `?${qs}` : ''}`);
    return unwrap<OverviewSummary>(res);
  },

  async getSalesAnalytics(range?: DateRange): Promise<SalesAnalytics> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesAnalytics>(res);
  },

  async getInventoryAnalytics(range?: DateRange): Promise<InventoryAnalytics> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.INVENTORY}${qs ? `?${qs}` : ''}`);
    return unwrap<InventoryAnalytics>(res);
  },

  async getFinancialAnalytics(range?: DateRange): Promise<FinancialAnalytics> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.FINANCIAL}${qs ? `?${qs}` : ''}`);
    return unwrap<FinancialAnalytics>(res);
  },

  /**
   * Resumen de productos vendidos en el período. Backend NO expone
   * todavía `/store/analytics/products/top-sellers` (404) — mientras
   * tanto, reusamos `SALES_SUMMARY` como fuente de datos agregados
   * (total_units_sold, total_revenue, etc.) y derivamos el resto en UI.
   *
   * Paridad con apps/frontend `top-sellers.component.ts`:
   *   totalUnits   = data.total_units_sold
   *   totalRevenue = data.total_revenue
   *   totalProducts / topProduct se dejan como "—" hasta que el
   *   backend exponga el endpoint real — ver comentario en
   *   `app/(store-admin)/analytics/products.tsx` (línea ~219).
   */
  async getProductsAnalytics(range?: DateRange): Promise<SalesSummary> {
    const params = dateParams(range);
    const qs = new URLSearchParams(params).toString();
    const res = await apiClient.get(`${Endpoints.STORE.ANALYTICS.SALES_SUMMARY}${qs ? `?${qs}` : ''}`);
    return unwrap<SalesSummary>(res);
  },
};
