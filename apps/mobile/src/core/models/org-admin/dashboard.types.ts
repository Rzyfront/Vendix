import type { ISODateString } from './common.types';

export interface OrganizationDashboardStats {
  total_stores: number;
  active_stores: number;
  total_users: number;
  total_orders_today: number;
  total_orders_month: number;
  revenue_month: number;
  revenue_today: number;
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
