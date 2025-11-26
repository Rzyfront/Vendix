// Core entities
export interface Order {
  id: string;
  orderNumber: string;
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  } | null;
  items: OrderItem[];
  summary: OrderSummary;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  total: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderSummary {
  subtotal: number;
  taxAmount: number;
  total: number;
  itemCount: number;
}

// Types and enums
export type OrderStatus =
  | 'draft' // Borrador
  | 'pending' // Pendiente de confirmación
  | 'confirmed' // Confirmado, listo para preparar
  | 'preparing' // En preparación
  | 'ready' // Listo para envío
  | 'shipped' // Enviado
  | 'delivered' // Entregado
  | 'cancelled' // Cancelado
  | 'refunded' // Reembolsado
  | 'returned'; // Devuelto

export type PaymentStatus =
  | 'pending' // Pendiente de pago
  | 'processing' // Procesando pago
  | 'paid' // Pagado completamente
  | 'partial' // Pagado parcialmente
  | 'overpaid' // Pagado de más
  | 'failed' // Pago fallido
  | 'refunded' // Reembolsado
  | 'disputed'; // En disputa

// Query and response interfaces
export interface OrderQuery {
  // Búsqueda
  search?: string;

  // Filtros principales
  status?: OrderStatus | OrderStatus[];
  paymentStatus?: PaymentStatus | PaymentStatus[];

  // Filtros de fecha
  dateFrom?: string;
  dateTo?: string;
  dateRange?:
    | 'today'
    | 'yesterday'
    | 'thisWeek'
    | 'lastWeek'
    | 'thisMonth'
    | 'lastMonth'
    | 'thisYear'
    | 'lastYear';

  // Filtros de cliente
  customerId?: string;
  customerEmail?: string;

  // Filtros de monto
  minAmount?: number;
  maxAmount?: number;

  // Paginación
  page?: number;
  limit?: number;

  // Ordenamiento
  sortBy?: 'createdAt' | 'updatedAt' | 'total' | 'orderNumber' | 'customerName';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedOrdersResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  completedOrders: number;
  averageOrderValue: number;
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
  status: OrderStatus;
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
  status: OrderStatus[];
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
