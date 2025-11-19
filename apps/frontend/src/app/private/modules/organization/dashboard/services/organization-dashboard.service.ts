import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface OrganizationDashboardStats {
  totalStores: number;
  activeUsers: number;
  monthlyOrders: number;
  revenue: number;
  storesGrowth: number;
  usersGrowth: number;
  ordersGrowth: number;
  revenueGrowth: number;
  revenueBreakdown: RevenueBreakdown[];
  storeDistribution: StoreDistribution[];
  topPerformingStores: TopStore[];
  recentOrders: RecentOrder[];
  userActivity: UserActivity[];
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

@Injectable({
  providedIn: 'root',
})
export class OrganizationDashboardService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getDashboardStats(
    organizationId: string,
  ): Observable<OrganizationDashboardStats> {
    return this.http
      .get<OrganizationDashboardStats>(
        `${this.apiUrl}/organizations/${organizationId}/dashboard/stats`,
      )
      .pipe(
        catchError((error) => {
          console.error('Error fetching organization dashboard stats:', error);
          return throwError(
            () => new Error('Failed to fetch organization dashboard stats'),
          );
        }),
      );
  }

  getStoresStats(organizationId: string): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/organizations/${organizationId}/stores/stats`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching organization stores stats:', error);
          return throwError(() => new Error('Failed to fetch stores stats'));
        }),
      );
  }

  getUsersStats(organizationId: string): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/organizations/${organizationId}/users/stats`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching organization users stats:', error);
          return throwError(() => new Error('Failed to fetch users stats'));
        }),
      );
  }

  getOrdersStats(organizationId: string): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/organizations/${organizationId}/orders/stats`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching organization orders stats:', error);
          return throwError(() => new Error('Failed to fetch orders stats'));
        }),
      );
  }

  getRevenueStats(
    organizationId: string,
    period: 'week' | 'month' | 'year' = 'month',
  ): Observable<any> {
    return this.http
      .get(
        `${this.apiUrl}/organizations/${organizationId}/revenue/stats?period=${period}`,
      )
      .pipe(
        catchError((error) => {
          console.error('Error fetching organization revenue stats:', error);
          return throwError(() => new Error('Failed to fetch revenue stats'));
        }),
      );
  }

  getTopStores(
    organizationId: string,
    limit: number = 5,
  ): Observable<TopStore[]> {
    return this.http
      .get<
        TopStore[]
      >(`${this.apiUrl}/organizations/${organizationId}/stores/top?limit=${limit}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching top stores:', error);
          return throwError(() => new Error('Failed to fetch top stores'));
        }),
      );
  }

  getRecentOrders(
    organizationId: string,
    limit: number = 10,
  ): Observable<RecentOrder[]> {
    return this.http
      .get<
        RecentOrder[]
      >(`${this.apiUrl}/organizations/${organizationId}/orders/recent?limit=${limit}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching recent orders:', error);
          return throwError(() => new Error('Failed to fetch recent orders'));
        }),
      );
  }

  getUserActivity(
    organizationId: string,
    period: 'week' | 'month' = 'week',
  ): Observable<UserActivity[]> {
    return this.http
      .get<
        UserActivity[]
      >(`${this.apiUrl}/organizations/${organizationId}/users/activity?period=${period}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching user activity:', error);
          return throwError(() => new Error('Failed to fetch user activity'));
        }),
      );
  }

  getStoreCategories(organizationId: string): Observable<StoreDistribution[]> {
    return this.http
      .get<
        StoreDistribution[]
      >(`${this.apiUrl}/organizations/${organizationId}/stores/categories`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching store categories:', error);
          return throwError(
            () => new Error('Failed to fetch store categories'),
          );
        }),
      );
  }
}
