export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export enum OrderType {
  SALE = 'sale',
  PURCHASE = 'purchase',
  TRANSFER = 'transfer',
  RETURN = 'return',
}

export interface OrderAddress {
  id: string;
  street_address: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  is_primary: boolean;
}

export interface OrderCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  variant?: string;
}

export interface OrderStore {
  id: string;
  name: string;
  slug: string;
}

export type DeliveryType = 'pickup' | 'home_delivery' | 'direct_delivery';

export interface OrderListItem {
  id: string;
  order_number: string;
  customer: OrderCustomer;
  store: OrderStore;
  order_type: OrderType;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total_amount: number;
  subtotal: number;
  tax_amount: number;
  shipping_amount: number;
  discount_amount: number;
  currency: string;
  order_date: string;
  shipping_address?: OrderAddress;
  billing_address?: OrderAddress;
  items_count: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  delivery_type?: DeliveryType;
  shipping_method_id?: number;
  shipping_method_name?: string;
}

export interface OrderDetails extends OrderListItem {
  items: OrderItem[];
  payment_method?: string;
  transaction_id?: string;
  tracking_number?: string;
  estimated_delivery?: string;
  delivered_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  refunded_at?: string;
  refund_reason?: string;
  metadata?: Record<string, any>;
}

export interface OrderStats {
  total_orders: number;
  pending_orders: number;
  confirmed_orders: number;
  processing_orders: number;
  shipped_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  refunded_orders: number;
  total_revenue: number;
  pending_revenue: number;
  average_order_value: number;
  orders_by_status: Record<OrderStatus, number>;
  orders_by_payment_status: Record<PaymentStatus, number>;
  orders_by_store: Array<{
    store_id: string;
    store_name: string;
    orders_count: number;
    revenue: number;
  }>;
  recent_orders: OrderListItem[];
}

export interface CreateOrderDto {
  customer_id: string;
  store_id: string;
  order_type: OrderType;
  items: Array<{
    product_id: string;
    product_variant_id?: string;
    quantity: number;
    unit_price?: number;
  }>;
  shipping_address?: OrderAddress;
  billing_address?: OrderAddress;
  notes?: string;
  payment_method?: string;
  currency: string;
  discount_amount?: number;
  tax_amount?: number;
  shipping_cost?: number;
}

export interface UpdateOrderDto {
  status?: OrderStatus;
  payment_status?: PaymentStatus;
  shipping_address?: OrderAddress;
  billing_address?: OrderAddress;
  notes?: string;
  tracking_number?: string;
  estimated_delivery?: string;
}

export interface OrderQueryParams {
  search?: string;
  status?: OrderStatus;
  payment_status?: PaymentStatus;
  store_id?: string;
  order_type?: OrderType;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
  min_amount?: number;
  max_amount?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface OrderResponse {
  success: boolean;
  data?: OrderListItem | OrderDetails;
  message?: string;
  errors?: string[];
}

export interface OrderListResponse {
  success: boolean;
  data: OrderListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  message?: string;
}

export interface OrderStatsResponse {
  success: boolean;
  data: OrderStats;
  message?: string;
}
