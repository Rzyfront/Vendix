import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  OrderStats,
} from '../interfaces/order.interface';

@Injectable({
  providedIn: 'root',
})
export class OrdersService {
  private readonly api_url = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get paginated orders with filters
   */
  getOrders(query: OrderQuery = {}): Observable<PaginatedOrdersResponse> {
    let params = new HttpParams();

    // Add query parameters
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.append(key, value.toString());
      }
    });

    return this.http
      .get<PaginatedOrdersResponse>(`${this.api_url}/orders`, {
        params,
      })
      .pipe(
        catchError((error) => {
          console.error('Error fetching orders:', error);
          throw error;
        }),
      );
  }

  /**
   * Get order by ID
   */
  getOrderById(id: number): Observable<Order> {
    return this.http.get<Order>(`${this.api_url}/orders/${id}`).pipe(
      catchError((error) => {
        console.error('Error fetching order:', error);
        throw error;
      }),
    );
  }

  /**
   * Create a new order
   */
  createOrder(order: Partial<Order>): Observable<Order> {
    return this.http.post<Order>(`${this.api_url}/orders`, order).pipe(
      catchError((error) => {
        console.error('Error creating order:', error);
        throw error;
      }),
    );
  }

  /**
   * Update an existing order
   */
  updateOrder(id: number, order: Partial<Order>): Observable<Order> {
    return this.http.patch<Order>(`${this.api_url}/orders/${id}`, order).pipe(
      catchError((error) => {
        console.error('Error updating order:', error);
        throw error;
      }),
    );
  }

  /**
   * Delete an order
   */
  deleteOrder(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api_url}/orders/${id}`).pipe(
      catchError((error) => {
        console.error('Error deleting order:', error);
        throw error;
      }),
    );
  }

  /**
   * Get order statistics
   */
  getOrderStats(): Observable<OrderStats> {
    return this.http.get<OrderStats>(`${this.api_url}/orders/stats`).pipe(
      catchError((error) => {
        console.error('Error fetching order stats:', error);
        throw error;
      }),
    );
  }

  /**
   * Update order status
   */
  updateOrderStatus(id: number, status: string): Observable<Order> {
    return this.http
      .patch<Order>(`${this.api_url}/orders/${id}/status`, {
        status,
      })
      .pipe(
        catchError((error) => {
          console.error('Error updating order status:', error);
          throw error;
        }),
      );
  }

  /**
   * Get orders by customer
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
        `${this.api_url}/orders?customer_id=${customer_id}`,
        { params },
      )
      .pipe(
        catchError((error) => {
          console.error('Error fetching customer orders:', error);
          throw error;
        }),
      );
  }
}
