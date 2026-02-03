import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

export interface DashboardStatItem {
  value: number;
  sub_value: number;
  sub_label: string;
}

export interface OrganizationDashboardStats {
  organization_id: number;
  stats: {
    total_stores: DashboardStatItem;
    active_users: DashboardStatItem;
    monthly_orders: DashboardStatItem;
    revenue: DashboardStatItem;
  };
  metrics: {
    active_users: number;
    active_stores: number;
    recent_orders: number;
    total_revenue: number;
    growth_trends: any[];
  };
  store_activity: any[]; // keeping as any for now or define strict type if known
  recent_audit: any[];
  profit_trend: { month: string; year: number; amount: number; revenue: number; costs: number }[];
  store_distribution: { type: string; count: number; revenue: number }[];
  // Keep existing fields if they are still needed by other parts or mark as optional
  revenueBreakdown?: RevenueBreakdown[];
  storeDistribution?: StoreDistribution[];
  topPerformingStores?: TopStore[];
  recentOrders?: RecentOrder[];
  userActivity?: UserActivity[];
}

export interface RevenueBreakdown {
  source: 'online' | 'in-store' | 'other';
  amount: number;
  percentage: number;
  color: string;
}

export interface StoreDistribution {
  category: string;
  count: number;
  percentage: number;
}

export interface TopStore {
  id: string;
  name: string;
  revenue: number;
  orders: number;
  growth: number;
  status: 'active' | 'inactive';
}

export interface RecentOrder {
  id: string;
  storeName: string;
  customerName: string;
  amount: number;
  status: 'pending' | 'completed' | 'cancelled';
  timestamp: Date;
}

export interface UserActivity {
  date: string;
  activeUsers: number;
  newUsers: number;
  returningUsers: number;
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

// Map para caché por organizationId + period
const dashboardCache = new Map<string, CacheEntry<Observable<OrganizationDashboardStats>>>();

@Injectable({
  providedIn: 'root',
})
export class OrganizationDashboardService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  constructor(private http: HttpClient) {}

  getDashboardStats(
    organizationId: string,
    period?: string,
  ): Observable<OrganizationDashboardStats> {
    // Crear clave única para caché: organizationId + period
    const cacheKey = `${organizationId}-${period || 'default'}`;
    const now = Date.now();
    const cached = dashboardCache.get(cacheKey);

    if (cached && (now - cached.lastFetch) < this.CACHE_TTL) {
      return cached.observable;
    }

    const params = period ? `?period=${period}` : '';
    const observable$ = this.http
      .get<any>(`${this.apiUrl}/organization/organizations/${organizationId}/stats${params}`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response) => response.data || response),
        catchError((error) => {
          console.error('Error fetching organization dashboard stats:', error);
          return throwError(
            () => new Error('Failed to fetch organization dashboard stats'),
          );
        }),
        tap(() => {
          const entry = dashboardCache.get(cacheKey);
          if (entry) {
            entry.lastFetch = Date.now();
          }
        }),
      );

    dashboardCache.set(cacheKey, {
      observable: observable$,
      lastFetch: now,
    });

    return observable$;
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de actualizar datos de la organización
   * @param organizationId - ID de la organización. Si no se proporciona, se limpia todo el caché
   * @param period - Periodo específico. Si se proporciona, solo limpia ese periodo
   */
  invalidateCache(organizationId?: string, period?: string): void {
    if (organizationId) {
      const cacheKey = `${organizationId}-${period || 'default'}`;
      dashboardCache.delete(cacheKey);
    } else {
      dashboardCache.clear();
    }
  }
}
