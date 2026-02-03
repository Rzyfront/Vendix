import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  OrderStats,
  OrderState,
  PaymentStatus,
  CreateOrderDto,
  CreateOrderItemDto,
  UpdateOrderStatusDto,
  UpdatePaymentStatusDto,
} from '../interfaces/order.interface';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let storeOrdersStatsCache: CacheEntry<Observable<OrderStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class StoreOrdersService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) {}

  /**
   * Construye parámetros URL manejando arrays y objetos complejos
   */
  private buildQueryParams(query: OrderQuery): URLSearchParams {
    const params = new URLSearchParams();

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Manejar arrays: status[]=pending&status[]=confirmed
          value.forEach((item) => params.append(key, item.toString()));
        } else if (key === 'date_range' && value) {
          // Manejar rangos de fecha predefinidos
          this.handleDateRange(value, params);
        } else {
          // Manejar valores simples
          params.append(key, value.toString());
        }
      }
    });

    return params;
  }

  /**
   * Convierte rangos de fecha predefinidos a fechas específicas
   */
  private handleDateRange(dateRange: string, params: URLSearchParams): void {
    const now = new Date();
    let fromDate: Date;
    let toDate: Date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );

    switch (dateRange) {
      case 'today':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
        );
        break;
      case 'yesterday':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 1,
          0,
          0,
          0,
        );
        toDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 1,
          23,
          59,
          59,
        );
        break;
      case 'thisWeek':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay(),
          0,
          0,
          0,
        );
        break;
      case 'lastWeek':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay() - 7,
          0,
          0,
          0,
        );
        toDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay(),
          23,
          59,
          59,
        );
        break;
      case 'thisMonth':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        break;
      case 'lastMonth':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0, 0, 0, 0);
        break;
      case 'thisYear':
        fromDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        break;
      case 'lastYear':
        fromDate = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
        break;
      default:
        return; // No hacer nada si el rango no es reconocido
    }

    if (fromDate) {
      params.append('date_from', fromDate.toISOString());
    }
    if (toDate) {
      params.append('date_to', toDate.toISOString());
    }
  }

  getOrders(query: OrderQuery = {}): Observable<PaginatedOrdersResponse> {
    const params = this.buildQueryParams(query);
    const url = `${this.apiUrl}/store/orders?${params.toString()}`;

    return this.http.get<PaginatedOrdersResponse>(url).pipe(
      catchError((error) => {
        console.error('Error fetching orders:', error);
        const errorMessage = this.extractErrorMessage(error);
        return throwError(
          () => new Error(`Failed to fetch orders: ${errorMessage}`),
        );
      }),
    );
  }

  getOrderStats(): Observable<OrderStats> {
    const now = Date.now();

    if (storeOrdersStatsCache && (now - storeOrdersStatsCache.lastFetch) < this.CACHE_TTL) {
      return storeOrdersStatsCache.observable;
    }

    const url = `${this.apiUrl}/store/orders/stats`;
    const observable$ = this.http.get<OrderStats>(url).pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (storeOrdersStatsCache) {
          storeOrdersStatsCache.lastFetch = Date.now();
        }
      }),
      catchError((error) => {
        console.error('Error fetching order stats:', error);
        return throwError(() => new Error('Failed to fetch order stats'));
      }),
    );

    storeOrdersStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  getOrderById(orderId: string): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.get<Order>(url).pipe(
      catchError((error) => {
        console.error('Error fetching order:', error);
        return throwError(() => new Error('Failed to fetch order'));
      }),
    );
  }

  getOrderTimeline(orderId: string): Observable<any[]> {
    const url = `${this.apiUrl}/store/orders/${orderId}/timeline`;

    return this.http.get<any[]>(url).pipe(
      catchError((error) => {
        console.error('Error fetching order timeline:', error);
        return throwError(() => new Error('Failed to fetch order timeline'));
      }),
    );
  }

  updateOrderStatus(orderId: string, status: OrderState): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.patch<Order>(url, { state: status }).pipe(
      catchError((error) => {
        console.error('Error updating order status:', error);
        return throwError(() => new Error('Failed to update order status'));
      }),
    );
  }

  /**
   * Crear una nueva orden
   */
  createOrder(order: CreateOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders`;

    return this.http.post<Order>(url, order).pipe(
      catchError((error) => {
        console.error('Error creating order:', error);
        const errorMessage = this.extractErrorMessage(error);
        return throwError(
          () => new Error(`Failed to create order: ${errorMessage}`),
        );
      }),
    );
  }

  /**
   * Actualizar estado de orden con DTO extendido
   */
  updateOrderStatusExtended(
    orderId: string,
    update: UpdateOrderStatusDto,
  ): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.patch<Order>(url, { state: update.status }).pipe(
      catchError((error) => {
        console.error('Error updating order status:', error);
        const errorMessage = this.extractErrorMessage(error);
        return throwError(
          () => new Error(`Failed to update order status: ${errorMessage}`),
        );
      }),
    );
  }

  /**
   * Actualizar estado de pago
   */
  updatePaymentStatus(
    orderId: string,
    update: UpdatePaymentStatusDto,
  ): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http
      .patch<Order>(url, { payment_status: update.paymentStatus })
      .pipe(
        catchError((error) => {
          console.error('Error updating payment status:', error);
          const errorMessage = this.extractErrorMessage(error);
          return throwError(
            () => new Error(`Failed to update payment status: ${errorMessage}`),
          );
        }),
      );
  }

  /**
   * Eliminar una orden
   */
  deleteOrder(orderId: string): Observable<void> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.delete<void>(url).pipe(
      catchError((error) => {
        console.error('Error deleting order:', error);
        const errorMessage = this.extractErrorMessage(error);
        return throwError(
          () => new Error(`Failed to delete order: ${errorMessage}`),
        );
      }),
    );
  }

  /**
   * Exportar órdenes a CSV/Excel
   */
  exportOrders(query: OrderQuery = {}): Observable<Blob> {
    const params = this.buildQueryParams(query);
    const url = `${this.apiUrl}/store/orders/export?${params.toString()}`;

    return this.http.get(url, { responseType: 'blob' }).pipe(
      catchError((error) => {
        console.error('Error exporting orders:', error);
        const errorMessage = this.extractErrorMessage(error);
        return throwError(
          () => new Error(`Failed to export orders: ${errorMessage}`),
        );
      }),
    );
  }

  /**
   * Extraer mensaje de error de diferentes tipos de errores HTTP
   */
  private extractErrorMessage(error: any): string {
    if (error?.error?.message) {
      return error.error.message;
    }
    if (error?.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error occurred';
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar órdenes
   */
  invalidateCache(): void {
    storeOrdersStatsCache = null;
  }
}
