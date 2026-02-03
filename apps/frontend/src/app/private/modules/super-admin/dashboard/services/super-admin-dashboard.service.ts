import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError, tap, shareReplay } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface SuperAdminStats {
  totalOrganizations: number;
  totalUsers: number;
  activeStores: number;
  platformGrowth: number;
  organizationGrowth: number;
  userGrowth: number;
  storeGrowth: number;
  weeklyData: WeeklyData[];
  recentActivities: RecentActivity[];
  topOrganizations: TopOrganization[];
}

export interface WeeklyData {
  week: string;
  organizations: number;
  users: number;
  stores: number;
}

export interface RecentActivity {
  id: string;
  type: 'organization' | 'user' | 'store' | 'domain';
  action: string;
  description: string;
  timestamp: Date;
  entityName: string;
}

export interface TopOrganization {
  id: string;
  name: string;
  stores: number;
  users: number;
  revenue: number;
  growth: number;
}

@Injectable({
  providedIn: 'root',
})
export class SuperAdminDashboardService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  // Caché para endpoints de stats
  private dashboardStatsCache$: Observable<SuperAdminStats> | undefined;
  private dashboardStatsLastFetch = 0;

  private organizationsStatsCache$: Observable<any> | undefined;
  private organizationsStatsLastFetch = 0;

  private usersStatsCache$: Observable<any> | undefined;
  private usersStatsLastFetch = 0;

  private storesStatsCache$: Observable<any> | undefined;
  private storesStatsLastFetch = 0;

  private domainsStatsCache$: Observable<any> | undefined;
  private domainsStatsLastFetch = 0;

  private rolesStatsCache$: Observable<any> | undefined;
  private rolesStatsLastFetch = 0;

  constructor(private http: HttpClient) {}

  getDashboardStats(): Observable<SuperAdminStats> {
    const now = Date.now();

    if (this.dashboardStatsCache$ && (now - this.dashboardStatsLastFetch) < this.CACHE_TTL) {
      return this.dashboardStatsCache$;
    }

    this.dashboardStatsCache$ = this.http
      .get<SuperAdminStats>(`${this.apiUrl}/superadmin/dashboard/stats`)
      .pipe(
        tap(() => this.dashboardStatsLastFetch = Date.now()),
        shareReplay({ bufferSize: 1, refCount: true }),
        catchError((error) => {
          console.error('Error fetching super admin dashboard stats:', error);
          return throwError(() => new Error('Failed to fetch dashboard stats'));
        }),
      );

    return this.dashboardStatsCache$;
  }

  getOrganizationsStats(): Observable<any> {
    const now = Date.now();

    if (this.organizationsStatsCache$ && (now - this.organizationsStatsLastFetch) < this.CACHE_TTL) {
      return this.organizationsStatsCache$;
    }

    this.organizationsStatsCache$ = this.http
      .get(`${this.apiUrl}/superadmin/organizations/dashboard`)
      .pipe(
        tap(() => this.organizationsStatsLastFetch = Date.now()),
        shareReplay({ bufferSize: 1, refCount: true }),
        catchError((error) => {
          console.error('Error fetching organizations stats:', error);
          return throwError(
            () => new Error('Failed to fetch organizations stats'),
          );
        }),
      );

    return this.organizationsStatsCache$;
  }

  getUsersStats(): Observable<any> {
    const now = Date.now();

    if (this.usersStatsCache$ && (now - this.usersStatsLastFetch) < this.CACHE_TTL) {
      return this.usersStatsCache$;
    }

    this.usersStatsCache$ = this.http.get(`${this.apiUrl}/superadmin/users/dashboard`).pipe(
      tap(() => this.usersStatsLastFetch = Date.now()),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error) => {
        console.error('Error fetching users stats:', error);
        return throwError(() => new Error('Failed to fetch users stats'));
      }),
    );

    return this.usersStatsCache$;
  }

  getStoresStats(): Observable<any> {
    const now = Date.now();

    if (this.storesStatsCache$ && (now - this.storesStatsLastFetch) < this.CACHE_TTL) {
      return this.storesStatsCache$;
    }

    this.storesStatsCache$ = this.http.get(`${this.apiUrl}/superadmin/stores/dashboard`).pipe(
      tap(() => this.storesStatsLastFetch = Date.now()),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error) => {
        console.error('Error fetching stores stats:', error);
        return throwError(() => new Error('Failed to fetch stores stats'));
      }),
    );

    return this.storesStatsCache$;
  }

  getDomainsStats(): Observable<any> {
    const now = Date.now();

    if (this.domainsStatsCache$ && (now - this.domainsStatsLastFetch) < this.CACHE_TTL) {
      return this.domainsStatsCache$;
    }

    this.domainsStatsCache$ = this.http.get(`${this.apiUrl}/superadmin/domains/dashboard`).pipe(
      tap(() => this.domainsStatsLastFetch = Date.now()),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error) => {
        console.error('Error fetching domains stats:', error);
        return throwError(() => new Error('Failed to fetch domains stats'));
      }),
    );

    return this.domainsStatsCache$;
  }

  getRolesStats(): Observable<any> {
    const now = Date.now();

    if (this.rolesStatsCache$ && (now - this.rolesStatsLastFetch) < this.CACHE_TTL) {
      return this.rolesStatsCache$;
    }

    this.rolesStatsCache$ = this.http.get(`${this.apiUrl}/superadmin/roles/dashboard`).pipe(
      tap(() => this.rolesStatsLastFetch = Date.now()),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((error) => {
        console.error('Error fetching roles stats:', error);
        return throwError(() => new Error('Failed to fetch roles stats'));
      }),
    );

    return this.rolesStatsCache$;
  }

  // No cachear - datos en tiempo real
  getPlatformHealth(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/health`).pipe(
      catchError((error) => {
        console.error('Error fetching platform health:', error);
        return throwError(() => new Error('Failed to fetch platform health'));
      }),
    );
  }

  // No cachear - datos en tiempo real
  getSystemMetrics(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/metrics`).pipe(
      catchError((error) => {
        console.error('Error fetching system metrics:', error);
        return throwError(() => new Error('Failed to fetch system metrics'));
      }),
    );
  }

  /**
   * Invalida todo el caché de estadísticas
   * Útil después de crear/editar/eliminar entidades
   */
  invalidateAllStatsCache(): void {
    this.dashboardStatsCache$ = undefined;
    this.dashboardStatsLastFetch = 0;
    this.organizationsStatsCache$ = undefined;
    this.organizationsStatsLastFetch = 0;
    this.usersStatsCache$ = undefined;
    this.usersStatsLastFetch = 0;
    this.storesStatsCache$ = undefined;
    this.storesStatsLastFetch = 0;
    this.domainsStatsCache$ = undefined;
    this.domainsStatsLastFetch = 0;
    this.rolesStatsCache$ = undefined;
    this.rolesStatsLastFetch = 0;
  }
}
