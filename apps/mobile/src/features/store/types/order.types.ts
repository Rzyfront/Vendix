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
  customer_id?: number | null;
  store_id: number;
  order_number: string;
  state: OrderState;
  channel?: OrderChannel | null;
  delivery_type?: DeliveryType | null;
  shipping_method_id?: number | null;
  shipping_rate_id?: number | null;
  shipping_method?: ShippingMethod | null;
  shipping_rate?: ShippingRate | null;
  shipping_address_id?: number | null;
  billing_address_id?: number | null;
  shipping_address_snapshot?: Record<string, unknown> | null;
  billing_address_snapshot?: Record<string, unknown> | null;
  subtotal_amount: number;
  tax_amount: number;
  shipping_cost: number;
  discount_amount: number;
  grand_total: number;
  currency?: string | null;
  coupon_id?: number | null;
  coupon_code?: string | null;
  payment_form?: string | null;
  credit_type?: 'free' | 'installments' | null;
  interest_rate?: number | string | null;
  interest_type?: 'simple' | 'compound' | string | null;
  total_paid?: number;
  remaining_balance?: number;
  total_with_interest?: number | string | null;
  internal_notes?: string | null;
  placed_at?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  estimated_ready_at?: string | null;
  estimated_delivered_at?: string | null;
  stores?: OrderStore | null;
  order_items?: OrderItem[];
  payments?: Payment[];
  order_installments?: OrderInstallment[];
  addresses_orders_billing_address_idToaddresses?: OrderAddress | null;
  addresses_orders_shipping_address_idToaddresses?: OrderAddress | null;
  users?: OrderCustomer | null;
  customer?: OrderCustomer | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id?: number | null;
  product_variant_id?: number | null;
  product_name: string;
  variant_sku?: string | null;
  variant_attributes?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_rate?: number | null;
  tax_amount_item?: number | null;
  cost_price?: number | string | null;
  weight?: number | string | null;
  weight_unit?: string | null;
  item_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  product?: OrderProduct | null;
  products?: OrderProduct | null;
  product_variant?: OrderProductVariant | null;
  product_variants?: OrderProductVariant | null;
}

export interface Payment {
  id: number;
  order_id: number;
  customer_id?: number | null;
  amount: number;
  currency?: string | null;
  state: PaymentStatus;
  transaction_id?: string | null;
  gateway_reference?: string | null;
  gateway_response?: Record<string, unknown>;
  paid_at?: string | null;
  store_payment_method_id?: number | null;
  store_payment_method?: {
    id: number;
    display_name?: string | null;
    system_payment_method?: {
      id?: number;
      name?: string | null;
      display_name?: string | null;
      type?: string | null;
      provider?: string | null;
      dian_code?: string | null;
    } | null;
  } | null;
  users?: OrderCustomer | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OrderCustomer {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  phone?: string | null;
  avatar_url?: string | null;
}

export interface OrderStore {
  id: number;
  name: string;
  store_code?: string | null;
}

export interface OrderAddress {
  id: number;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  postal_code?: string | null;
  country_code: string;
  municipality_code?: string | null;
  phone_number?: string | null;
  type?: string | null;
}

export interface ShippingMethod {
  id: number;
  name: string;
  type: string;
  provider_name?: string | null;
  min_days?: number | null;
  max_days?: number | null;
  logo_url?: string | null;
}

export interface ShippingZone {
  id: number;
  name: string;
  display_name?: string | null;
}

export interface ShippingRate {
  id: number;
  name?: string | null;
  type?: string | null;
  base_cost?: number | string | null;
  per_unit_cost?: number | string | null;
  free_shipping_threshold?: number | string | null;
  shipping_zone?: ShippingZone | null;
}

export interface OrderProduct {
  id: number;
  name: string;
  sku?: string | null;
  image_url?: string | null;
  product_images?: { id: number; image_url: string; is_main?: boolean | null }[];
}

export interface OrderProductVariant {
  id: number;
  sku?: string | null;
  name?: string | null;
  attributes?: string | null;
  price_override?: number | string | null;
}

export interface OrderInstallment {
  id: number;
  order_id: number;
  installment_number: number;
  amount: number;
  capital_amount: number;
  interest_amount: number;
  due_date: string;
  state: 'pending' | 'paid' | 'partial' | 'overdue' | 'forgiven';
  amount_paid: number;
  remaining_balance: number;
  paid_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
