import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  OrderStats,
} from '../interfaces/order.interface';

/**
 * Response unwrap helper — backend `ResponseService` wraps every list/paginated
 * payload in `{success, data, pagination, meta}`. Map any envelope-shaped body
 * (`r?.data ?? r`) to a flat result so consumers receive the inner type without
 * a second `.data` access.
 */
function unwrap<T>(r: any): T {
  return (r && typeof r === 'object' && 'data' in r ? (r.data as T) : (r as T));
}

@Injectable({
  providedIn: 'root',
})
export class OrdersService {
  private readonly api_url = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get paginated orders with filters.
   * Backend envelope: `{success, data: Order[], pagination}` → unwrapped.
   */
  getOrders(query: OrderQuery = {}): Observable<PaginatedOrdersResponse> {
    let params = new HttpParams();

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.append(key, value.toString());
      }
    });

    return this.http
      .get<PaginatedOrdersResponse>(`${this.api_url}/store/orders`, {
        params,
      })
      .pipe(
        map((res) => unwrap<PaginatedOrdersResponse>(res)),
        catchError((error) => {
          console.error('Error fetching orders:', error);
          throw error;
        }),
      );
  }

  /**
   * Get order by ID. Backend envelope: `{success, data: Order}` → unwrapped.
   */
  getOrderById(id: number): Observable<Order> {
    return this.http.get<Order>(`${this.api_url}/store/orders/${id}`).pipe(
      map((res) => unwrap<Order>(res)),
      catchError((error) => {
        console.error('Error fetching order:', error);
        throw error;
      }),
    );
  }

  /**
   * Create a new order. Backend envelope: `{success, data: Order}` → unwrapped.
   */
  createOrder(order: Partial<Order>): Observable<Order> {
    return this.http
      .post<Order>(`${this.api_url}/store/orders`, order)
      .pipe(
        map((res) => unwrap<Order>(res)),
        catchError((error) => {
          console.error('Error creating order:', error);
          throw error;
        }),
      );
  }

  /**
   * Update an existing order. Backend envelope: `{success, data: Order}` → unwrapped.
   */
  updateOrder(id: number, order: Partial<Order>): Observable<Order> {
    return this.http
      .patch<Order>(`${this.api_url}/store/orders/${id}`, order)
      .pipe(
        map((res) => unwrap<Order>(res)),
        catchError((error) => {
          console.error('Error updating order:', error);
          throw error;
        }),
      );
  }

  /**
   * Delete an order.
   */
  deleteOrder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api_url}/store/orders/${id}`).pipe(
      catchError((error) => {
        console.error('Error deleting order:', error);
        throw error;
      }),
    );
  }

  /**
   * Get order statistics. Backend envelope: `{success, data: OrderStats}` → unwrapped.
   */
  getOrderStats(): Observable<OrderStats> {
    return this.http.get<OrderStats>(`${this.api_url}/store/orders/stats`).pipe(
      map((res) => unwrap<OrderStats>(res)),
      catchError((error) => {
        console.error('Error fetching order stats:', error);
        throw error;
      }),
    );
  }

  /**
   * Update order status. Backend envelope: `{success, data: Order}` → unwrapped.
   */
  updateOrderStatus(id: number, status: string): Observable<Order> {
    return this.http
      .patch<Order>(`${this.api_url}/store/orders/${id}/status`, {
        status,
      })
      .pipe(
        map((res) => unwrap<Order>(res)),
        catchError((error) => {
          console.error('Error updating order status:', error);
          throw error;
        }),
      );
  }

  /**
   * Get orders by customer. Backend envelope: `{success, data: Order[], pagination}`.
   */
  getOrdersByCustomer(
    customer_id: number,
    query: OrderQuery = {},
  ): Observable<PaginatedOrdersResponse> {
    let params = new HttpParams();

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.append(key, value.toString());
      }
    });

    return this.http
      .get<PaginatedOrdersResponse>(
        `${this.api_url}/store/orders?customer_id=${customer_id}`,
        { params },
      )
      .pipe(
        map((res) => unwrap<PaginatedOrdersResponse>(res)),
        catchError((error) => {
          console.error('Error fetching customer orders:', error);
          throw error;
        }),
      );
  }
}