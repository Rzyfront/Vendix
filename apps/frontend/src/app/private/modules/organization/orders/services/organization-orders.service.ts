import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import {
  OrderListItem,
  OrderDetails,
  OrderStats,
  CreateOrderDto,
  UpdateOrderDto,
  OrderQueryParams,
  OrderResponse,
  OrderListResponse,
  OrderStatsResponse,
  OrderStatus,
  PaymentStatus,
  OrderType,
} from '../interfaces/order.interface';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class OrganizationOrdersService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get all orders for the organization with pagination and filtering
   */
  getOrders(query?: OrderQueryParams): Observable<OrderListResponse> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.status) params = params.set('status', query.status);
    if (query?.payment_status)
      params = params.set('payment_status', query.payment_status);
    if (query?.store_id) params = params.set('store_id', query.store_id);
    if (query?.order_type) params = params.set('order_type', query.order_type);
    if (query?.customer_id)
      params = params.set('customer_id', query.customer_id);
    if (query?.date_from) params = params.set('date_from', query.date_from);
    if (query?.date_to) params = params.set('date_to', query.date_to);
    if (query?.min_amount)
      params = params.set('min_amount', query.min_amount.toString());
    if (query?.max_amount)
      params = params.set('max_amount', query.max_amount.toString());
    if (query?.sort) params = params.set('sort', query.sort);
    if (query?.order) params = params.set('order', query.order);

    const url = `${this.apiUrl}/organization/orders`;
    console.log(
      'Fetching orders from:',
      url,
      'with params:',
      params.toString(),
    );

    return this.http.get<OrderListResponse>(url, { params });
  }

  /**
   * Get order by ID
   */
  getOrderById(id: string): Observable<OrderResponse> {
    return this.http.get<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}`,
    );
  }

  /**
   * Get order by order number
   */
  getOrderByNumber(orderNumber: string): Observable<OrderResponse> {
    return this.http.get<OrderResponse>(
      `${this.apiUrl}/organization/orders/number/${orderNumber}`,
    );
  }

  /**
   * Create a new order
   */
  createOrder(data: CreateOrderDto): Observable<OrderResponse> {
    return this.http.post<OrderResponse>(
      `${this.apiUrl}/organization/orders`,
      data,
    );
  }

  /**
   * Update an existing order
   */
  updateOrder(id: string, data: UpdateOrderDto): Observable<OrderResponse> {
    return this.http.patch<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}`,
      data,
    );
  }

  /**
   * Delete an order
   */
  deleteOrder(id: string): Observable<OrderResponse> {
    return this.http.delete<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}`,
    );
  }

  /**
   * Get order statistics for the organization
   */
  getOrderStats(
    dateFrom?: string,
    dateTo?: string,
    storeId?: string,
  ): Observable<OrderStatsResponse> {
    let params = new HttpParams();

    if (dateFrom) params = params.set('date_from', dateFrom);
    if (dateTo) params = params.set('date_to', dateTo);
    if (storeId) params = params.set('store_id', storeId);

    return this.http.get<OrderStatsResponse>(
      `${this.apiUrl}/organization/orders/stats`,
      {
        params,
      },
    );
  }

  /**
   * Get orders by store ID
   */
  getOrdersByStore(
    storeId: string,
    query?: Omit<OrderQueryParams, 'store_id'>,
  ): Observable<OrderListResponse> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.status) params = params.set('status', query.status);
    if (query?.payment_status)
      params = params.set('payment_status', query.payment_status);
    if (query?.order_type) params = params.set('order_type', query.order_type);
    if (query?.customer_id)
      params = params.set('customer_id', query.customer_id);
    if (query?.date_from) params = params.set('date_from', query.date_from);
    if (query?.date_to) params = params.set('date_to', query.date_to);
    if (query?.min_amount)
      params = params.set('min_amount', query.min_amount.toString());
    if (query?.max_amount)
      params = params.set('max_amount', query.max_amount.toString());
    if (query?.sort) params = params.set('sort', query.sort);
    if (query?.order) params = params.set('order', query.order);

    return this.http.get<OrderListResponse>(
      `${this.apiUrl}/organization/stores/${storeId}/orders`,
      { params },
    );
  }

  /**
   * Get orders by customer ID
   */
  getOrdersByCustomer(
    customerId: string,
    query?: Omit<OrderQueryParams, 'customer_id'>,
  ): Observable<OrderListResponse> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.status) params = params.set('status', query.status);
    if (query?.payment_status)
      params = params.set('payment_status', query.payment_status);
    if (query?.store_id) params = params.set('store_id', query.store_id);
    if (query?.order_type) params = params.set('order_type', query.order_type);
    if (query?.date_from) params = params.set('date_from', query.date_from);
    if (query?.date_to) params = params.set('date_to', query.date_to);
    if (query?.min_amount)
      params = params.set('min_amount', query.min_amount.toString());
    if (query?.max_amount)
      params = params.set('max_amount', query.max_amount.toString());
    if (query?.sort) params = params.set('sort', query.sort);
    if (query?.order) params = params.set('order', query.order);

    return this.http.get<OrderListResponse>(
      `${this.apiUrl}/organization/customers/${customerId}/orders`,
      { params },
    );
  }

  /**
   * Update order status
   */
  updateOrderStatus(
    id: string,
    status: OrderStatus,
    reason?: string,
  ): Observable<OrderResponse> {
    const body = reason ? { status, reason } : { status };
    return this.http.patch<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}/status`,
      body,
    );
  }

  /**
   * Update payment status
   */
  updatePaymentStatus(
    id: string,
    paymentStatus: PaymentStatus,
    reason?: string,
  ): Observable<OrderResponse> {
    const body = reason
      ? { payment_status: paymentStatus, reason }
      : { payment_status: paymentStatus };
    return this.http.patch<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}/payment-status`,
      body,
    );
  }

  /**
   * Cancel order
   */
  cancelOrder(id: string, reason: string): Observable<OrderResponse> {
    return this.http.post<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}/cancel`,
      {
        reason,
      },
    );
  }

  /**
   * Refund order
   */
  refundOrder(
    id: string,
    amount?: number,
    reason?: string,
  ): Observable<OrderResponse> {
    const body = amount ? { amount, reason } : { reason };
    return this.http.post<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}/refund`,
      body,
    );
  }

  /**
   * Add tracking information
   */
  addTrackingInfo(
    id: string,
    trackingNumber: string,
    carrier?: string,
    estimatedDelivery?: string,
  ): Observable<OrderResponse> {
    const body = {
      tracking_number: trackingNumber,
      ...(carrier && { carrier }),
      ...(estimatedDelivery && { estimated_delivery: estimatedDelivery }),
    };
    return this.http.post<OrderResponse>(
      `${this.apiUrl}/organization/orders/${id}/tracking`,
      body,
    );
  }

  /**
   * Export orders to CSV
   */
  exportOrders(query?: OrderQueryParams): Observable<Blob> {
    let params = new HttpParams();

    if (query?.search) params = params.set('search', query.search);
    if (query?.status) params = params.set('status', query.status);
    if (query?.payment_status)
      params = params.set('payment_status', query.payment_status);
    if (query?.store_id) params = params.set('store_id', query.store_id);
    if (query?.order_type) params = params.set('order_type', query.order_type);
    if (query?.customer_id)
      params = params.set('customer_id', query.customer_id);
    if (query?.date_from) params = params.set('date_from', query.date_from);
    if (query?.date_to) params = params.set('date_to', query.date_to);
    if (query?.min_amount)
      params = params.set('min_amount', query.min_amount.toString());
    if (query?.max_amount)
      params = params.set('max_amount', query.max_amount.toString());

    return this.http.get(`${this.apiUrl}/organization/orders/export`, {
      params,
      responseType: 'blob',
    });
  }

  /**
   * Print order invoice
   */
  printInvoice(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/organization/orders/${id}/invoice`, {
      responseType: 'blob',
    });
  }

  /**
   * Print order packing slip
   */
  printPackingSlip(id: string): Observable<Blob> {
    return this.http.get(
      `${this.apiUrl}/organization/orders/${id}/packing-slip`,
      {
        responseType: 'blob',
      },
    );
  }
}
