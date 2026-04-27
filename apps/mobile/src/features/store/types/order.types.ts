export type OrderState =
  | 'created'
  | 'pending_payment'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'finished';

export type OrderChannel = 'pos' | 'ecommerce' | 'agent' | 'whatsapp' | 'marketplace';
export type DeliveryType = 'pickup' | 'home_delivery' | 'direct_delivery' | 'other';
export type PaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled';

export interface Order {
  id: number;
  customer_id: number;
  store_id: number;
  order_number: string;
  state: OrderState;
  channel?: OrderChannel | null;
  delivery_type?: DeliveryType | null;
  shipping_method_id?: number | null;
  subtotal_amount: number;
  tax_amount: number;
  shipping_cost: number;
  discount_amount: number;
  grand_total: number;
  currency: string;
  payment_form?: string | null;
  credit_type?: 'free' | 'installments' | null;
  total_paid?: number;
  remaining_balance?: number;
  internal_notes?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  order_items?: OrderItem[];
  payments?: Payment[];
  customer?: OrderCustomer;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_variant_id?: number | null;
  product_name: string;
  variant_sku?: string | null;
  variant_attributes?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_rate?: number | null;
  tax_amount_item?: number | null;
  product?: { id: number; name: string; image_url?: string };
  product_variant?: { id: number; sku: string; attributes?: string };
}

export interface Payment {
  id: number;
  order_id: number;
  amount: number;
  currency: string;
  state: PaymentStatus;
  transaction_id?: string | null;
  gateway_response?: Record<string, unknown>;
  store_payment_method_id?: number | null;
  store_payment_method?: { id: number; display_name: string };
  created_at: string;
}

export interface OrderCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
}

export interface OrderStats {
  total_orders: number;
  total_revenue: number;
  pending_orders: number;
  completed_orders: number;
  average_order_value: number;
}

export interface OrderQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: OrderState | OrderState[];
  channel?: OrderChannel;
  payment_status?: PaymentStatus;
  date_from?: string;
  date_to?: string;
  missing_shipping_method?: boolean;
  sort?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PayOrderDto {
  store_payment_method_id: number;
  payment_type: 'direct' | 'online';
  amount_received?: number;
  amount?: number;
  payment_reference?: string;
}

export interface ShipOrderDto {
  tracking_number?: string;
  carrier?: string;
  notes?: string;
}

export interface CancelOrderDto {
  reason: string;
}

export interface RefundOrderDto {
  amount?: number;
  reason: string;
}

export interface OrderTimelineEntry {
  id: number;
  order_id: number;
  action: string;
  description: string;
  performed_by?: string | null;
  created_at: string;
}

export const ORDER_STATE_LABELS: Record<OrderState, string> = {
  created: 'Creada',
  pending_payment: 'Pendiente Pago',
  processing: 'Procesando',
  shipped: 'Enviada',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
  refunded: 'Reembolsada',
  finished: 'Finalizada',
};

export const ORDER_STATE_COLORS: Record<OrderState, string> = {
  created: 'default',
  pending_payment: 'warning',
  processing: 'info',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'error',
  refunded: 'default',
  finished: 'success',
};
