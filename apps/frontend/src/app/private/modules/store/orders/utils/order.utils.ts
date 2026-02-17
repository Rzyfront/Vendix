import {
  Order,
  OrderQuery,
  OrderState,
  PaymentStatus,
} from '../interfaces/order.interface';

export class OrderUtils {
  /**
   * Validate order data
   */
  static validateOrder(order: Partial<Order>): boolean {
    return !!(order.customer_id && order.store_id && order.order_number);
  }

  /**
   * Check if order can be cancelled
   */
  static canCancelOrder(order: Order): boolean {
    const cancellableStates: OrderState[] = [
      'created',
      'pending_payment',
      'processing',
    ];
    return cancellableStates.includes(order.state);
  }

  /**
   * Check if order can be refunded
   */
  static canRefundOrder(order: Order): boolean {
    const refundableStates: OrderState[] = ['delivered', 'finished'];
    const refundablePaymentStatuses: PaymentStatus[] = ['succeeded'];

    return (
      refundableStates.includes(order.state) &&
      (order.payments || []).some((payment) =>
        refundablePaymentStatuses.includes(payment.state),
      )
    );
  }

  /**
   * Check if order is completed
   */
  static isOrderCompleted(order: Order): boolean {
    return order.state === 'finished' || order.state === 'delivered';
  }

  /**
   * Check if order requires payment
   */
  static requiresPayment(order: Order): boolean {
    return order.state === 'pending_payment';
  }

  /**
   * Get order progress percentage
   */
  static getOrderProgress(order: Order): number {
    const progressMap: Record<OrderState, number> = {
      created: 10,
      pending_payment: 20,
      processing: 50,
      shipped: 80,
      delivered: 95,
      finished: 100,
      cancelled: 0,
      refunded: 0,
    };
    return progressMap[order.state] || 0;
  }

  /**
   * Generate order query string from filters
   */
  static buildQueryString(filters: OrderQuery): string {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value.toString());
      }
    });

    return params.toString();
  }

  /**
   * Parse query string to OrderQuery
   */
  static parseQueryString(queryString: string): OrderQuery {
    const params = new URLSearchParams(queryString);
    const query: OrderQuery = {};

    params.forEach((value, key) => {
      if (key === 'page' || key === 'limit') {
        query[key] = parseInt(value, 10);
      } else if (key === 'customer_id' || key === 'store_id') {
        query[key] = parseInt(value, 10);
      } else if (key === 'sort_order') {
        query[key] = value as 'asc' | 'desc';
      } else {
        (query as any)[key] = value;
      }
    });

    return query;
  }

  /**
   * Calculate estimated delivery date
   */
  static calculateEstimatedDelivery(order: Order): Date | null {
    if (!order.created_at) return null;

    const createdDate = new Date(order.created_at);
    const estimatedDate = new Date(createdDate);

    // Add business days (excluding weekends)
    let businessDays = 3; // Default 3 business days

    while (businessDays > 0) {
      estimatedDate.setDate(estimatedDate.getDate() + 1);

      // Skip weekends
      if (estimatedDate.getDay() !== 0 && estimatedDate.getDay() !== 6) {
        businessDays--;
      }
    }

    return estimatedDate;
  }

  /**
   * Get order priority based on status and age
   */
  static getOrderPriority(order: Order): 'high' | 'medium' | 'low' {
    const now = new Date();
    const createdDate = new Date(order.created_at);
    const hoursSinceCreation =
      (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);

    // High priority for pending payment orders older than 1 hour
    if (order.state === 'pending_payment' && hoursSinceCreation > 1) {
      return 'high';
    }

    // High priority for processing orders older than 4 hours
    if (order.state === 'processing' && hoursSinceCreation > 4) {
      return 'high';
    }

    // Medium priority for processing orders
    if (order.state === 'processing') {
      return 'medium';
    }

    // Low priority for other orders
    return 'low';
  }

  /**
   * Sort orders by priority and creation date
   */
  static sortOrdersByPriority(orders: Order[]): Order[] {
    return orders.sort((a, b) => {
      const priorityA = this.getOrderPriority(a);
      const priorityB = this.getOrderPriority(b);

      const priorityOrder = { high: 3, medium: 2, low: 1 };

      if (priorityOrder[priorityA] !== priorityOrder[priorityB]) {
        return priorityOrder[priorityB] - priorityOrder[priorityA];
      }

      // Same priority, sort by creation date (newest first)
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }

  /**
   * Filter orders by search term
   */
  static filterOrdersBySearch(orders: Order[], searchTerm: string): Order[] {
    if (!searchTerm) return orders;

    const term = searchTerm.toLowerCase();
    return orders.filter(
      (order) =>
        order.order_number.toLowerCase().includes(term) ||
        order.customer_id.toString().includes(term) ||
        order.order_items?.some((item) =>
          item.product_name.toLowerCase().includes(term),
        ),
    );
  }
}
