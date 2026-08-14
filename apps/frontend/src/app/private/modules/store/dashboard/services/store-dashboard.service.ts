import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { TenantCacheRegistry } from '../../../../../core/services/tenant-cache-registry.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

export interface StoreDashboardStats {
  recentOrders: RecentOrder[];
  dispatchPendingOrders: DispatchPendingOrder[];
  dispatchPendingCount: number;
  refundPendingOrders: RefundPendingOrder[];
  refundPendingCount: number;
}

export interface RecentOrder {
  id: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'finished';
  items: number;
  timestamp: Date;
  hasShipping: boolean;
  shippingMethodName: string | null;
  isPaid: boolean;
  deliveryType: 'pickup' | 'home_delivery' | 'direct_delivery';
}

export interface DispatchPendingOrder {
  id: string;
  customerName: string;
  items: number;
  amount: number;
  createdAt: Date;
}

export interface RefundPendingOrder {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  refundAmount: number;
  state: string;
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

// Map para caché por storeId
const storeDashboardCache = new Map<string, CacheEntry<Observable<StoreDashboardStats>>>();
const storeProductsStatsCache = new Map<string, CacheEntry<Observable<any>>>();

@Injectable({
  providedIn: 'root',
})
export class StoreDashboardService {
  private readonly apiUrl = environment.apiUrl;
  private tenantCacheRegistry = inject(TenantCacheRegistry);
  private readonly CACHE_TTL = 30000; // 30 segundos
  private readonly authFacade = inject(AuthFacade);

  constructor(private http: HttpClient) {
    // QUI-563 Fase 2: register with the bus so the switch service
    // evicts us proactively on store change.
    this.tenantCacheRegistry.register(
      'store-dashboard',
      () => this.invalidateCache(),
      'StoreDashboardService',
    );
  }

  /**
   * Store scope of the current session. The endpoint below is store-scoped by the
   * session, not by a path param, so the URL does NOT identify whose stats a
   * response holds — the cache key has to. The key used to be the constant
   * `'dashboard'`, so a store switch inside the 30 s TTL served the previous
   * store's alerts; and `invalidateCache(storeId)` deleted the key `storeId`,
   * which never existed, so the entry was never actually invalidated.
   */
  private storeScopeKey(): string {
    const id = (this.authFacade.userStore() as any)?.id;
    return id != null ? `dashboard:s${id}` : 'dashboard:s_';
  }

  getDashboardStats(): Observable<StoreDashboardStats> {
    const cacheKey = this.storeScopeKey();
    const now = Date.now();
    const cached = storeDashboardCache.get(cacheKey);

    if (cached && (now - cached.lastFetch) < this.CACHE_TTL) {
      return cached.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiUrl}/store/stores/dashboard/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response: any) => response.data || response),
        tap(() => {
          const entry = storeDashboardCache.get(cacheKey);
          if (entry) {
            entry.lastFetch = Date.now();
          }
        }),
        catchError((error) => {
          console.error('Error fetching store dashboard stats:', error);
          return throwError(
            () => new Error('Failed to fetch store dashboard stats'),
          );
        }),
      );

    storeDashboardCache.set(cacheKey, {
      observable: observable$,
      lastFetch: now,
    });

    return observable$;
  }

  // Commented out: endpoint does not exist in backend
  // getSalesStats(
  //   storeId: string,
  //   period: 'week' | 'month' | 'year' = 'month',
  // ): Observable<any> {
  //   return this.http
  //     .get(
  //       `${this.apiUrl}/store/stores/${storeId}/sales/stats?period=${period}`,
  //     )
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching store sales stats:', error);
  //         return throwError(() => new Error('Failed to fetch sales stats'));
  //       }),
  //     );
  // }

  getProductsStats(storeId: string): Observable<any> {
    const now = Date.now();
    const cached = storeProductsStatsCache.get(storeId);

    if (cached && (now - cached.lastFetch) < this.CACHE_TTL) {
      return cached.observable;
    }

    const observable$ = this.http
      .get(`${this.apiUrl}/store/products/stats/store/${storeId}`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          const entry = storeProductsStatsCache.get(storeId);
          if (entry) {
            entry.lastFetch = Date.now();
          }
        }),
        catchError((error) => {
          console.error('Error fetching store products stats:', error);
          return throwError(() => new Error('Failed to fetch products stats'));
        }),
      );

    storeProductsStatsCache.set(storeId, {
      observable: observable$,
      lastFetch: now,
    });

    return observable$;
  }

  // Commented out: endpoint does not exist in backend
  // getCustomersStats(storeId: string): Observable<any> {
  //   return this.http
  //     .get(`${this.apiUrl}/store/stores/${storeId}/customers/stats`)
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching store customers stats:', error);
  //         return throwError(() => new Error('Failed to fetch customers stats'));
  //       }),
  //     );
  // }

  // Commented out: endpoint does not exist in backend
  // getTopProducts(storeId: string, limit: number = 5): Observable<TopProduct[]> {
  //   return this.http
  //     .get<
  //       TopProduct[]
  //     >(`${this.apiUrl}/store/stores/${storeId}/products/top?limit=${limit}`)
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching top products:', error);
  //         return throwError(() => new Error('Failed to fetch top products'));
  //       }),
  //     );
  // }

  // Commented out: endpoint does not exist in backend
  // getRecentOrders(
  //   storeId: string,
  //   limit: number = 10,
  // ): Observable<RecentOrder[]> {
  //   return this.http
  //     .get<
  //       RecentOrder[]
  //     >(`${this.apiUrl}/store/stores/${storeId}/orders/recent?limit=${limit}`)
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching recent orders:', error);
  //         return throwError(() => new Error('Failed to fetch recent orders'));
  //       }),
  //     );
  // }

  // Commented out: endpoint does not exist in backend
  // getCustomerActivity(
  //   storeId: string,
  //   period: 'week' | 'month' = 'week',
  // ): Observable<CustomerActivity[]> {
  //   return this.http
  //     .get<
  //       CustomerActivity[]
  //     >(`${this.apiUrl}/store/stores/${storeId}/customers/activity?period=${period}`)
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching customer activity:', error);
  //         return throwError(
  //           () => new Error('Failed to fetch customer activity'),
  //         );
  //       }),
  //     );
  // }

  // Commented out: endpoint does not exist in backend
  // getInventoryStats(storeId: string): Observable<any> {
  //   return this.http
  //     .get(`${this.apiUrl}/store/stores/${storeId}/inventory/stats`)
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching inventory stats:', error);
  //         return throwError(() => new Error('Failed to fetch inventory stats'));
  //       }),
  //     );
  // }

  // Commented out: endpoint does not exist in backend
  // getRevenueAnalytics(
  //   storeId: string,
  //   period: 'week' | 'month' | 'year' = 'month',
  // ): Observable<any> {
  //   return this.http
  //     .get(
  //       `${this.apiUrl}/store/stores/${storeId}/revenue/analytics?period=${period}`,
  //     )
  //     .pipe(
  //       catchError((error) => {
  //         console.error('Error fetching revenue analytics:', error);
  //         return throwError(
  //           () => new Error('Failed to fetch revenue analytics'),
  //         );
  //       }),
  //     );
  // }

  /**
   * Invalida el caché de estadísticas
   * Útil después de actualizar datos de la tienda
   * @param storeId - ID de la tienda. Si no se proporciona, se limpia todo el caché
   */
  invalidateCache(storeId?: string): void {
    if (storeId) {
      storeDashboardCache.delete(storeId);
      storeProductsStatsCache.delete(storeId);
    } else {
      storeDashboardCache.clear();
      storeProductsStatsCache.clear();
    }
  }
}
