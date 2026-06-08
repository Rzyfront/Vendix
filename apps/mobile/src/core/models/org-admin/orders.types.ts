import type { ISODateString, MoneyAmount } from './common.types';

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OrganizationOrder {
  id: string;
  order_number: string;
  store_id: string;
  store_name: string;
  customer_id?: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  status: OrderStatus;
  payment_status: 'PENDING' | 'PAID' | 'PARTIAL' | 'REFUNDED' | 'FAILED';
  fulfillment_status: 'UNFULFILLED' | 'PARTIAL' | 'FULFILLED';
  channel: 'POS' | 'ECOMMERCE' | 'WHOLESALE' | 'PHONE';
  items_count: number;
  subtotal: MoneyAmount;
  tax_total: MoneyAmount;
  shipping_total: MoneyAmount;
  discount_total: MoneyAmount;
  total: MoneyAmount;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface OrderStats {
  total_orders: number;
  total_revenue: MoneyAmount;
  pending_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  average_ticket: MoneyAmount;
  by_status: Record<OrderStatus, number>;
  by_channel: Record<string, number>;
  by_store: Array<{ store_id: string; store_name: string; total: number; orders: number }>;
}

export interface OrderTimelineEntry {
  id: string;
  type: 'CREATED' | 'CONFIRMED' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED' | 'NOTE';
  description: string;
  user_name?: string;
  metadata?: Record<string, unknown>;
  created_at: ISODateString;
}
