import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  OrderStats,
  OrderStatus,
} from '../interfaces/order.interface';

@Injectable({
  providedIn: 'root',
})
export class StoreOrdersService {
  private readonly apiUrl = environment.apiUrl;


  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) { }

  getOrders(query: OrderQuery = {}): Observable<PaginatedOrdersResponse> {
    // 1. Obtener ID de tienda actual
    const storeId = this.storeContextService.getStoreIdOrThrow();

    // 2. Construir parámetros URL
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });

    // 3. Construir URL completa
    const url = `${this.apiUrl}/stores/${storeId}/orders?${params.toString()}`;

    // 4. Hacer petición HTTP con manejo de errores
    return this.http.get<PaginatedOrdersResponse>(url).pipe(
      catchError((error) => {
        console.error('Error fetching orders:', error);
        return throwError(() => new Error('Failed to fetch orders'));
      }),
    );
  }

  getOrderStats(): Observable<OrderStats> {
    const storeId = this.storeContextService.getStoreIdOrThrow();
    const url = `${this.apiUrl}/stores/${storeId}/orders/stats`;

    return this.http.get<OrderStats>(url).pipe(
      catchError((error) => {
        console.error('Error fetching order stats:', error);
        return throwError(() => new Error('Failed to fetch order stats'));
      }),
    );
  }

  getOrderById(orderId: string): Observable<Order> {
    const storeId = this.storeContextService.getStoreIdOrThrow();
    const url = `${this.apiUrl}/stores/${storeId}/orders/${orderId}`;

    return this.http.get<Order>(url).pipe(
      catchError((error) => {
        console.error('Error fetching order:', error);
        return throwError(() => new Error('Failed to fetch order'));
      }),
    );
  }

  updateOrderStatus(orderId: string, status: OrderStatus): Observable<Order> {
    const storeId = this.storeContextService.getStoreIdOrThrow();
    const url = `${this.apiUrl}/stores/${storeId}/orders/${orderId}/status`;

    return this.http.patch<Order>(url, { status }).pipe(
      catchError((error) => {
        console.error('Error updating order status:', error);
        return throwError(() => new Error('Failed to update order status'));
      }),
    );
  }
}
