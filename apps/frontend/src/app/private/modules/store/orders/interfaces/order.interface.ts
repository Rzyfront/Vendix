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

// Para creación de órdenes
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

// Para actualización de estados
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

// Para acciones rápidas
export interface OrderAction {
  id: string;
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

// Para filtros en UI
export interface OrderFilters {
  search: string;
  status: OrderStatus[];
  paymentStatus: PaymentStatus[];
  dateRange: string;
  customerId?: string;
  minAmount?: number;
  maxAmount?: number;
}

// Para configuración de tabla
export interface OrderTableColumn {
  key: keyof Order | 'actions';
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  transform?: (value: any, order: Order) => string;
}
