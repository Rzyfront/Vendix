import { CartItem, CartSummary, CartDiscount } from './cart.model';
import { PosCustomer } from './customer.model';
import { PaymentMethod, Transaction } from './payment.model';

export interface PosOrder {
  id: string;
  orderNumber: string;
  customer: PosCustomer | null;
  items: PosOrderItem[];
  summary: PosOrderSummary;
  status: PosOrderStatus;
  paymentStatus: PosPaymentStatus;
  payments: PosOrderPayment[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  createdBy: string;
  storeId: string;
  organizationId: string;
}

export interface PosOrderItem {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  cost?: number;
  notes?: string;
  discounts?: PosOrderItemDiscount[];
}

export interface PosOrderItemDiscount {
  id: string;
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  amount: number;
}

export interface PosOrderSummary {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  itemCount: number;
  totalItems: number;
  profit: number;
}

export interface PosOrderPayment {
  id: string;
  paymentMethod: PaymentMethod;
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  transactionId?: string;
  reference?: string;
  details?: any;
  createdAt: Date;
  processedAt?: Date;
}

export type PosOrderStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type PosPaymentStatus =
  | 'pending'
  | 'partial'
  | 'paid'
  | 'overpaid'
  | 'refunded';

export interface CreatePosOrderRequest {
  customer: PosCustomer | null;
  items: CartItem[];
  summary: CartSummary;
  discounts: CartDiscount[];
  notes: string;
  storeId: string;
  organizationId: string;
  createdBy: string;
}

export interface UpdatePosOrderRequest {
  customer?: PosCustomer | null;
  items?: CartItem[];
  notes?: string;
  status?: PosOrderStatus;
}

export interface ProcessPaymentRequest {
  orderId: string;
  paymentMethod: PaymentMethod;
  amount: number;
  reference?: string;
  cashReceived?: number;
}

export interface ProcessPaymentResponse {
  success: boolean;
  payment?: PosOrderPayment;
  transaction?: Transaction;
  change?: number;
  message: string;
}

export interface OrderSearchRequest {
  query?: string;
  status?: PosOrderStatus;
  paymentStatus?: PosPaymentStatus;
  customerId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'total' | 'orderNumber';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedOrdersResponse {
  orders: PosOrder[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  ordersByStatus: Record<PosOrderStatus, number>;
  paymentMethods: Record<string, number>;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
}

export interface OrderValidationError {
  field: string;
  message: string;
}
