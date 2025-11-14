import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, delay, map, tap } from 'rxjs/operators';
import {
  PosOrder,
  PosOrderStatus,
  PosPaymentStatus,
  CreatePosOrderRequest,
  UpdatePosOrderRequest,
  ProcessPaymentRequest,
  ProcessPaymentResponse,
  OrderSearchRequest,
  PaginatedOrdersResponse,
  OrderStats,
  OrderValidationError,
} from '../models/order.model';

// Re-export types for component usage
export type { ProcessPaymentRequest } from '../models/order.model';
import { CartState } from '../models/cart.model';
import { PosCustomer } from '../models/customer.model';

@Injectable({
  providedIn: 'root',
})
export class PosOrderService {
  private readonly orders$ = new BehaviorSubject<PosOrder[]>([]);
  private readonly loading$ = new BehaviorSubject<boolean>(false);
  private readonly currentOrder$ = new BehaviorSubject<PosOrder | null>(null);

  constructor() {
    this.initializeMockData();
  }

  // Observable getters
  get orders(): Observable<PosOrder[]> {
    return this.orders$.asObservable();
  }

  get loading(): Observable<boolean> {
    return this.loading$.asObservable();
  }

  get currentOrder(): Observable<PosOrder | null> {
    return this.currentOrder$.asObservable();
  }

  /**
   * Create order from cart state
   */
  createOrderFromCart(
    cartState: CartState,
    storeId: string,
    organizationId: string,
    createdBy: string,
  ): Observable<PosOrder> {
    this.loading$.next(true);

    // Validate cart state
    const validationErrors = this.validateCartForOrder(cartState);
    if (validationErrors.length > 0) {
      this.loading$.next(false);
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    const request: CreatePosOrderRequest = {
      customer: cartState.customer,
      items: cartState.items,
      summary: cartState.summary,
      discounts: cartState.appliedDiscounts,
      notes: cartState.notes,
      storeId,
      organizationId,
      createdBy,
    };

    return of(request).pipe(
      delay(500),
      map((req) => this.processCreateOrder(req)),
      tap((order) => {
        const currentOrders = this.orders$.value;
        this.orders$.next([order, ...currentOrders]);
        this.currentOrder$.next(order);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Create draft order
   */
  createDraftOrder(
    cartState: CartState,
    storeId: string,
    organizationId: string,
    createdBy: string,
  ): Observable<PosOrder> {
    this.loading$.next(true);

    const request: CreatePosOrderRequest = {
      customer: cartState.customer,
      items: cartState.items,
      summary: cartState.summary,
      discounts: cartState.appliedDiscounts,
      notes: cartState.notes,
      storeId,
      organizationId,
      createdBy,
    };

    return of(request).pipe(
      delay(300),
      map((req) => this.createOrderFromRequest(req, 'draft')),
      tap((order) => {
        const currentOrders = this.orders$.value;
        this.orders$.next([order, ...currentOrders]);
        this.currentOrder$.next(order);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Update existing order
   */
  updateOrder(
    orderId: string,
    request: UpdatePosOrderRequest,
  ): Observable<PosOrder> {
    this.loading$.next(true);

    return of({ orderId, request }).pipe(
      delay(400),
      map(({ orderId, request }) => this.updateOrderInternal(orderId, request)),
      tap((order) => {
        const currentOrders = this.orders$.value;
        const orderIndex = currentOrders.findIndex((o) => o.id === orderId);
        if (orderIndex >= 0) {
          currentOrders[orderIndex] = order;
          this.orders$.next([...currentOrders]);
        }
        if (this.currentOrder$.value?.id === orderId) {
          this.currentOrder$.next(order);
        }
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Process payment for order
   */
  processPayment(
    request: ProcessPaymentRequest,
  ): Observable<ProcessPaymentResponse> {
    this.loading$.next(true);

    return of(request).pipe(
      delay(2000), // Simulate payment processing
      map((req) => this.processPaymentRequest(req)),
      tap((response) => {
        if (response.success && response.payment) {
          this.updateOrderPaymentStatus(request.orderId, response.payment);
        }
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get order by ID
   */
  getOrderById(orderId: string): Observable<PosOrder | null> {
    const order = this.orders$.value.find((o) => o.id === orderId);
    return of(order || null).pipe(delay(100));
  }

  /**
   * Get order by order number
   */
  getOrderByOrderNumber(orderNumber: string): Observable<PosOrder | null> {
    const order = this.orders$.value.find((o) => o.orderNumber === orderNumber);
    return of(order || null).pipe(delay(100));
  }

  /**
   * Search orders
   */
  searchOrders(
    request: OrderSearchRequest = {},
  ): Observable<PaginatedOrdersResponse> {
    this.loading$.next(true);

    const {
      query = '',
      status,
      paymentStatus,
      customerId,
      dateFrom,
      dateTo,
      limit = 20,
      offset = 0,
    } = request;

    return of(this.orders$.value).pipe(
      delay(300),
      map((orders) => {
        let filteredOrders = [...orders];

        // Filter by query
        if (query.trim()) {
          const searchTerm = query.toLowerCase().trim();
          filteredOrders = filteredOrders.filter(
            (order) =>
              order.orderNumber.toLowerCase().includes(searchTerm) ||
              order.customer?.name.toLowerCase().includes(searchTerm) ||
              order.customer?.email.toLowerCase().includes(searchTerm),
          );
        }

        // Filter by status
        if (status) {
          filteredOrders = filteredOrders.filter(
            (order) => order.status === status,
          );
        }

        // Filter by payment status
        if (paymentStatus) {
          filteredOrders = filteredOrders.filter(
            (order) => order.paymentStatus === paymentStatus,
          );
        }

        // Filter by customer
        if (customerId) {
          filteredOrders = filteredOrders.filter(
            (order) => order.customer?.id === customerId,
          );
        }

        // Filter by date range
        if (dateFrom) {
          filteredOrders = filteredOrders.filter(
            (order) => order.createdAt >= dateFrom,
          );
        }
        if (dateTo) {
          filteredOrders = filteredOrders.filter(
            (order) => order.createdAt <= dateTo,
          );
        }

        // Sort
        if (request.sortBy) {
          filteredOrders.sort((a, b) => {
            let aValue: any;
            let bValue: any;

            if (request.sortBy === 'orderNumber') {
              aValue = parseInt(a.orderNumber.replace('ORD-', ''));
              bValue = parseInt(b.orderNumber.replace('ORD-', ''));
            } else if (request.sortBy === 'createdAt') {
              aValue = a.createdAt.getTime();
              bValue = b.createdAt.getTime();
            } else if (request.sortBy === 'total') {
              aValue = a.summary.total;
              bValue = b.summary.total;
            }

            if (request.sortOrder === 'desc') {
              return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            } else {
              return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            }
          });
        } else {
          // Default sort by creation date descending
          filteredOrders.sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }

        const total = filteredOrders.length;
        const paginatedOrders = filteredOrders.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        return {
          orders: paginatedOrders,
          total,
          limit,
          offset,
          hasMore,
        };
      }),
      tap(() => this.loading$.next(false)),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get order statistics
   */
  getOrderStats(dateFrom?: Date, dateTo?: Date): Observable<OrderStats> {
    return of(this.orders$.value).pipe(
      delay(200),
      map((orders) => {
        let filteredOrders = [...orders];

        if (dateFrom) {
          filteredOrders = filteredOrders.filter(
            (order) => order.createdAt >= dateFrom,
          );
        }
        if (dateTo) {
          filteredOrders = filteredOrders.filter(
            (order) => order.createdAt <= dateTo,
          );
        }

        const completedOrders = filteredOrders.filter(
          (order) => order.status === 'completed',
        );
        const totalRevenue = completedOrders.reduce(
          (sum, order) => sum + order.summary.total,
          0,
        );
        const averageOrderValue =
          completedOrders.length > 0
            ? totalRevenue / completedOrders.length
            : 0;

        // Orders by status
        const ordersByStatus = filteredOrders.reduce(
          (acc, order) => {
            acc[order.status] = (acc[order.status] || 0) + 1;
            return acc;
          },
          {} as Record<PosOrderStatus, number>,
        );

        // Payment methods
        const paymentMethods = completedOrders.reduce(
          (acc, order) => {
            order.payments.forEach((payment) => {
              if (payment.status === 'completed') {
                acc[payment.paymentMethod.name] =
                  (acc[payment.paymentMethod.name] || 0) + payment.amount;
              }
            });
            return acc;
          },
          {} as Record<string, number>,
        );

        // Top products
        const topProducts = filteredOrders
          .reduce(
            (acc, order) => {
              order.items.forEach((item) => {
                const existing = acc.find(
                  (p) => p.productId === item.productId,
                );
                if (existing) {
                  existing.quantity += item.quantity;
                  existing.revenue += item.totalPrice;
                } else {
                  acc.push({
                    productId: item.productId,
                    productName: item.productName,
                    quantity: item.quantity,
                    revenue: item.totalPrice,
                  });
                }
              });
              return acc;
            },
            [] as Array<{
              productId: string;
              productName: string;
              quantity: number;
              revenue: number;
            }>,
          )
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10);

        return {
          totalOrders: filteredOrders.length,
          totalRevenue,
          averageOrderValue,
          ordersByStatus,
          paymentMethods,
          topProducts,
        };
      }),
    );
  }

  /**
   * Cancel order
   */
  cancelOrder(orderId: string, reason?: string): Observable<PosOrder> {
    return this.updateOrder(orderId, {
      status: 'cancelled',
      notes: reason ? `Cancelado: ${reason}` : undefined,
    });
  }

  /**
   * Refund order
   */
  refundOrder(orderId: string, reason?: string): Observable<PosOrder> {
    return this.updateOrder(orderId, {
      status: 'refunded',
      notes: reason ? `Reembolsado: ${reason}` : undefined,
    });
  }

  /**
   * Set current order
   */
  setCurrentOrder(order: PosOrder | null): void {
    this.currentOrder$.next(order);
  }

  /**
   * Clear current order
   */
  clearCurrentOrder(): void {
    this.currentOrder$.next(null);
  }

  /**
   * Get current order value
   */
  getCurrentOrderValue(): PosOrder | null {
    return this.currentOrder$.value;
  }

  /**
   * Validate cart for order creation
   */
  private validateCartForOrder(cartState: CartState): OrderValidationError[] {
    const errors: OrderValidationError[] = [];

    if (!cartState.items || cartState.items.length === 0) {
      errors.push({ field: 'items', message: 'El carrito está vacío' });
    }

    if (cartState.summary.total <= 0) {
      errors.push({ field: 'total', message: 'El total debe ser mayor a 0' });
    }

    return errors;
  }

  /**
   * Process create order
   */
  private processCreateOrder(request: CreatePosOrderRequest): PosOrder {
    const order = this.createOrderFromRequest(request, 'confirmed');
    order.completedAt = new Date();
    return order;
  }

  /**
   * Create order from request
   */
  private createOrderFromRequest(
    request: CreatePosOrderRequest,
    status: PosOrderStatus,
  ): PosOrder {
    const orderItems = request.items.map((item) => ({
      id: this.generateOrderItemId(),
      productId: item.product.id,
      productName: item.product.name,
      productSku: item.product.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      cost: item.product.cost,
      notes: item.notes,
      discounts:
        item.discounts?.map((discount) => ({
          id: this.generateDiscountId(),
          type: discount.type,
          value: discount.value,
          description: discount.description,
          amount: discount.amount,
        })) || [],
    }));

    const profit = orderItems.reduce((sum, item) => {
      const itemProfit = (item.unitPrice - (item.cost || 0)) * item.quantity;
      return sum + itemProfit;
    }, 0);

    return {
      id: this.generateOrderId(),
      orderNumber: this.generateOrderNumber(),
      customer: request.customer,
      items: orderItems,
      summary: {
        ...request.summary,
        profit,
      },
      status,
      paymentStatus: status === 'confirmed' ? 'pending' : 'pending',
      payments: [],
      notes: request.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: status === 'confirmed' ? new Date() : undefined,
      createdBy: request.createdBy,
      storeId: request.storeId,
      organizationId: request.organizationId,
    };
  }

  /**
   * Process payment request
   */
  private processPaymentRequest(
    request: ProcessPaymentRequest,
  ): ProcessPaymentResponse {
    const order = this.orders$.value.find((o) => o.id === request.orderId);
    if (!order) {
      return {
        success: false,
        message: 'Orden no encontrada',
      };
    }

    const payment = {
      id: this.generatePaymentId(),
      paymentMethod: request.paymentMethod,
      amount: request.amount,
      status: 'completed' as const,
      transactionId: this.generateTransactionId(),
      reference: request.reference,
      details:
        request.paymentMethod.type === 'cash'
          ? {
              amountReceived: request.cashReceived || request.amount,
              change: (request.cashReceived || request.amount) - request.amount,
            }
          : undefined,
      createdAt: new Date(),
      processedAt: new Date(),
    };

    return {
      success: true,
      payment,
      message: 'Pago procesado correctamente',
      change:
        request.paymentMethod.type === 'cash' && request.cashReceived
          ? request.cashReceived - request.amount
          : undefined,
    };
  }

  /**
   * Update order payment status
   */
  private updateOrderPaymentStatus(orderId: string, payment: any): void {
    const currentOrders = this.orders$.value;
    const orderIndex = currentOrders.findIndex((o) => o.id === orderId);

    if (orderIndex >= 0) {
      const order = currentOrders[orderIndex];
      const updatedPayments = [...order.payments, payment];
      const totalPaid = updatedPayments
        .filter((p) => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0);

      let paymentStatus: PosPaymentStatus = 'pending';
      if (totalPaid >= order.summary.total) {
        paymentStatus = totalPaid > order.summary.total ? 'overpaid' : 'paid';
      } else if (totalPaid > 0) {
        paymentStatus = 'partial';
      }

      const updatedOrder = {
        ...order,
        payments: updatedPayments,
        paymentStatus,
        updatedAt: new Date(),
      };

      currentOrders[orderIndex] = updatedOrder;
      this.orders$.next([...currentOrders]);

      if (this.currentOrder$.value?.id === orderId) {
        this.currentOrder$.next(updatedOrder);
      }
    }
  }

  /**
   * Initialize mock data
   */
  private initializeMockData(): void {
    const mockOrders: PosOrder[] = [
      {
        id: 'ORDER_001',
        orderNumber: 'ORD-2024-001',
        customer: {
          id: 'CUST_001',
          email: 'juan.perez@email.com',
          name: 'Juan Pérez',
          phone: '+5491123456789',
          createdAt: new Date('2024-01-15'),
          updatedAt: new Date('2024-01-15'),
        },
        items: [
          {
            id: 'ITEM_001',
            productId: '1',
            productName: 'Laptop Dell Inspiron 15',
            productSku: 'LAP-DEL-001',
            quantity: 1,
            unitPrice: 899.99,
            totalPrice: 899.99,
            cost: 650,
          },
        ],
        summary: {
          subtotal: 899.99,
          discountAmount: 0,
          taxAmount: 188.9979,
          total: 1088.9879,
          itemCount: 1,
          totalItems: 1,
          profit: 249.99,
        },
        status: 'completed',
        paymentStatus: 'paid',
        payments: [
          {
            id: 'PAY_001',
            paymentMethod: {
              id: 'card',
              name: 'Tarjeta de Crédito/Débito',
              type: 'card',
              icon: 'credit-card',
              enabled: true,
            },
            amount: 1088.99,
            status: 'completed',
            transactionId: 'TXN_001',
            reference: '1234',
            createdAt: new Date('2024-01-15'),
            processedAt: new Date('2024-01-15'),
          },
        ],
        notes: '',
        createdAt: new Date('2024-01-15T10:30:00'),
        updatedAt: new Date('2024-01-15T10:35:00'),
        completedAt: new Date('2024-01-15T10:35:00'),
        createdBy: 'user_001',
        storeId: 'store_001',
        organizationId: 'org_001',
      },
    ];

    this.orders$.next(mockOrders);
  }

  /**
   * Update order internal
   */
  private updateOrderInternal(
    orderId: string,
    request: UpdatePosOrderRequest,
  ): PosOrder {
    const currentOrders = this.orders$.value;
    const orderIndex = currentOrders.findIndex((o) => o.id === orderId);

    if (orderIndex === -1) {
      throw new Error('Order not found');
    }

    const order = currentOrders[orderIndex];
    const updatedOrder: PosOrder = {
      ...order,
      customer:
        request.customer !== undefined ? request.customer : order.customer,
      notes: request.notes !== undefined ? request.notes : order.notes,
      status: request.status !== undefined ? request.status : order.status,
      updatedAt: new Date(),
    };

    return updatedOrder;
  }

  /**
   * Generate unique order ID
   */
  private generateOrderId(): string {
    return 'ORDER_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  /**
   * Generate order number
   */
  private generateOrderNumber(): string {
    const date = new Date();
    const year = date.getFullYear();
    const sequence = Math.floor(Math.random() * 9999) + 1;
    return `ORD-${year}-${sequence.toString().padStart(3, '0')}`;
  }

  /**
   * Generate order item ID
   */
  private generateOrderItemId(): string {
    return 'OITEM_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Generate discount ID
   */
  private generateDiscountId(): string {
    return 'ODISC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * Generate payment ID
   */
  private generatePaymentId(): string {
    return 'PAY_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  /**
   * Generate transaction ID
   */
  private generateTransactionId(): string {
    return (
      'TXN_' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 11).toUpperCase()
    );
  }
}
