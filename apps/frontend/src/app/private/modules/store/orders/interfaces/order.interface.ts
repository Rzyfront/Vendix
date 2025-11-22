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
export type OrderStatus = 'draft' | 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled' | 'refunded';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'overpaid' | 'refunded';
export interface OrderQuery {
    search?: string;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
    sortBy?: 'createdAt' | 'total' | 'orderNumber';
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