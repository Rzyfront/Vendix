import type { ISODateString } from './common.types';

/**
 * Stats del dashboard de organización (GET /organization/organizations/:id/stats).
 * El backend devuelve el bloque `stats` con cada métrica como { value, sub_value } —
 * `value` es el contador/importe del periodo, `sub_value` es el delta vs el periodo
 * anterior (positivo = verde, negativo = rojo en el grid de stats).
 */
export interface OrganizationDashboardStats {
  stats: {
    total_stores: { value: number; sub_value: number };
    active_users: { value: number; sub_value: number };
    monthly_orders: { value: number; sub_value: number };
    revenue: { value: number; sub_value: number };
  };
  pending_orders: number;
  low_stock_products: number;
  expiring_batches: number;
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
