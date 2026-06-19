import type { ISODateString } from './common.types';

/**
 * Stats del dashboard de organización (GET /organization/organizations/:id/stats).
 *
 * El backend (apps/backend/src/domains/organization/organizations/organizations.service.ts,
 * método `getDashboard`, líneas ~190-215) devuelve este shape EXACTO:
 *
 *   {
 *     organization_id: string,
 *     store_filter: string | null,
 *     stats: {
 *       total_stores:   { value: number, sub_value: number, sub_label: string },
 *       active_users:   { value: number, sub_value: number | null, sub_label: string },
 *       monthly_orders: { value: number, sub_value: number, sub_label: string },
 *       revenue:        { value: number, sub_value: number, sub_label: string },
 *     },
 *   }
 *
 * Notas:
 * - `value`     = contador/importe del periodo actual
 * - `sub_value` = delta vs el periodo anterior (positivo = verde, negativo = rojo).
 *                 Para `active_users` el backend devuelve `null` (no hay delta a comparar).
 * - `sub_label` = etiqueta legible del sub_valor (ej. "new this month", "orders today").
 *
 * El endpoint NO devuelve `pending_orders`, `low_stock_products` ni
 * `expiring_batches`. Si se necesitan alertas de stock/órdenes/lotes, deben
 * venir de otros endpoints (`OrgOrdersService.getStats`, `OrgStoreService.stats`,
 * etc.) — no de este.
 */
export interface OrganizationDashboardStats {
  organization_id: string;
  store_filter: string | null;
  stats: {
    total_stores: { value: number; sub_value: number; sub_label: string };
    active_users: { value: number; sub_value: number | null; sub_label: string };
    monthly_orders: { value: number; sub_value: number; sub_label: string };
    revenue: { value: number; sub_value: number; sub_label: string };
  };
}

export interface RecentOrder {
  id: string;
  order_number: string;
  store_name: string;
  customer_name: string;
  total: number;
  status: string;
  created_at: ISODateString;
}

export interface StorePerformance {
  store_id: string;
  store_name: string;
  revenue: number;
  orders_count: number;
  active_users: number;
  trend: 'up' | 'down' | 'flat';
}
