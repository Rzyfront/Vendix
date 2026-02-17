import {
  Order,
  OrderState,
  PaymentStatus,
} from '../interfaces/order.interface';

export class OrderFormatUtils {
  /**
   * Format currency amount
   */
  static formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  }

  /**
   * Format date for display
   */
  static formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  /**
   * Format order status for display
   */
  static formatOrderStatus(status: OrderState): string {
    const statusMap: Record<OrderState, string> = {
      created: 'Created',
      pending_payment: 'Pending Payment',
      processing: 'Processing',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      finished: 'Finished',
    };
    return statusMap[status] || status;
  }

  /**
   * Format payment status for display
   */
  static formatPaymentStatus(status: PaymentStatus): string {
    const statusMap: Record<PaymentStatus, string> = {
      pending: 'Pending',
      succeeded: 'Succeeded',
      failed: 'Failed',
      authorized: 'Authorized',
      captured: 'Captured',
      refunded: 'Refunded',
      partially_refunded: 'Partially Refunded',
      cancelled: 'Cancelled',
    };
    return statusMap[status] || status;
  }

  /**
   * Get status badge color
   */
  static getStatusColor(status: OrderState): string {
    const colorMap: Record<OrderState, string> = {
      created: 'blue',
      pending_payment: 'yellow',
      processing: 'purple',
      shipped: 'indigo',
      delivered: 'green',
      cancelled: 'red',
      refunded: 'gray',
      finished: 'green',
    };
    return colorMap[status] || 'gray';
  }

  /**
   * Get payment status badge color
   */
  static getPaymentStatusColor(status: PaymentStatus): string {
    const colorMap: Record<PaymentStatus, string> = {
      pending: 'yellow',
      succeeded: 'green',
      failed: 'red',
      authorized: 'blue',
      captured: 'purple',
      refunded: 'gray',
      partially_refunded: 'orange',
      cancelled: 'red',
    };
    return colorMap[status] || 'gray';
  }

  /**
   * Calculate order total
   */
  static calculateOrderTotal(order: Order): number {
    return (
      order.subtotal_amount +
      order.tax_amount +
      order.shipping_cost -
      order.discount_amount
    );
  }

  /**
   * Format order number for display
   */
  static formatOrderNumber(orderNumber: string): string {
    return `#${orderNumber}`;
  }

  /**
   * Truncate text with ellipsis
   */
  static truncateText(text: string, maxLength: number = 50): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}
