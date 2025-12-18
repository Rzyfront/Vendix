// Core entities - Aligned with backend models
export interface Order {
  id: number;
  customer_id: number;
  store_id: number;
  order_number: string;
  state: OrderState;
  subtotal_amount: number;
  tax_amount: number;
  shipping_cost: number;
  discount_amount: number;
  grand_total: number;
  currency: string;
  billing_address_id?: number;
  shipping_address_id?: number;
  internal_notes?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  stores?: {
    id: number;
    name: string;
    store_code: string;
  };
  order_items?: OrderItem[];
  addresses_orders_billing_address_idToaddresses?: Address;
  addresses_orders_shipping_address_idToaddresses?: Address;
  payments?: Payment[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  variant_attributes?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_rate?: number;
  tax_amount_item?: number;
  created_at: string;
  updated_at: string;
  products?: Product;
  product_variants?: ProductVariant;
}

export interface Address {
  id: number;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string;
  sku: string;
  price: number;
}

export interface ProductVariant {
  id: number;
  sku: string;
  price: number;
  attributes?: string;
}

export interface Payment {
  id: number;
  order_id: number;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_method: string;
  transaction_id?: string;
  created_at: string;
  updated_at: string;
}

// Types and enums - Aligned with backend enums
export type OrderState =
  | 'created'
  | 'pending_payment'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'finished';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'cancelled';

// Query and response interfaces
export interface OrderQuery {
  // Búsqueda
  search?: string;

  // Filtros principales
  status?: OrderState;
  customer_id?: number;
  store_id?: number;
  payment_status?: PaymentStatus;
  date_range?: string;

  // Filtros de fecha
  date_from?: string;
  date_to?: string;

  // Paginación
  page?: number;
  limit?: number;

  // Ordenamiento
  sort?: string; // Format: 'field:direction' e.g., 'created_at:desc'
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedOrdersResponse {
  data: Order[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface OrderStats {
  total_orders: number;
  total_revenue: number;
  pending_orders: number;
  completed_orders: number;
  average_order_value: number;
}

// DTOs
export interface CreateOrderDto {
  customerId: string;
  items: CreateOrderItemDto[];
  notes?: string;
  paymentMethod?: string;
}

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  unitPrice?: number; // Opcional, usa precio del producto si no se especifica
}

export interface UpdateOrderStatusDto {
  status: OrderState;
  notes?: string;
  notifyCustomer?: boolean;
}

export interface UpdatePaymentStatusDto {
  paymentStatus: PaymentStatus;
  transactionId?: string;
  notes?: string;
}

// UI interfaces
export interface OrderAction {
  id: string;
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface OrderFilters {
  search: string;
  status: OrderState[];
  paymentStatus: PaymentStatus[];
  dateRange: string;
  customerId?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
}

export interface FilterConfig {
  status: FilterOption[];
  paymentStatus: FilterOption[];
  dateRange: FilterOption[];
}

export interface OrderTableColumn {
  key: keyof Order | 'actions';
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  transform?: (value: any, order: Order) => string;
  badge?: {
    type?: 'status' | 'custom';
    colorKey?: string;
    colorMap?: Record<string, string>;
    size?: 'sm' | 'md' | 'lg';
  };
}

export interface TableConfig {
  columns: OrderTableColumn[];
  loading: boolean;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TableActions {
  refresh: () => void;
  newOrder: () => void;
  export: () => void;
}

// Order Types
export interface SalesOrder extends Order {
  orderType: 'sales';
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
  shippingAddress?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  billingAddress?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  salesRep?: {
    id: string;
    name: string;
  };
  commission?: number;
}

export interface PurchaseOrder extends Order {
  orderType: 'purchase';
  supplier: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
  expectedDeliveryDate?: string;
  purchaseRep?: {
    id: string;
    name: string;
  };
}

export interface StockTransfer extends Order {
  orderType: 'transfer';
  fromLocation: {
    id: string;
    name: string;
    type: 'warehouse' | 'store';
  };
  toLocation: {
    id: string;
    name: string;
    type: 'warehouse' | 'store';
  };
  transferReason?: string;
  approvedBy?: {
    id: string;
    name: string;
  };
  receivedBy?: {
    id: string;
    name: string;
  };
}

// Create Request DTOs
export interface CreateSalesOrderRequest {
  customerId: string;
  items: CreateOrderItemDto[];
  shippingAddress?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  billingAddress?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  notes?: string;
  paymentMethod?: string;
  salesRepId?: string;
  commission?: number;
}

export interface CreatePurchaseOrderRequest {
  supplierId: string;
  items: CreateOrderItemDto[];
  expectedDeliveryDate?: string;
  notes?: string;
  purchaseRepId?: string;
}

export interface CreateStockTransferRequest {
  fromLocationId: string;
  toLocationId: string;
  items: CreateOrderItemDto[];
  transferReason?: string;
  notes?: string;
}

// Extended OrderStats with growth rates
// Note: These properties are calculated on the frontend
// and not part of the backend response

export interface ExtendedOrderStats extends OrderStats {
  ordersGrowthRate?: number;
  pendingGrowthRate?: number;
  completedGrowthRate?: number;
  revenueGrowthRate?: number;
}
