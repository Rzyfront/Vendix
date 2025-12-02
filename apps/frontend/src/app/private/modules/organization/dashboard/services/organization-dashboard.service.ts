import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
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
  profit_trend: { month: string; year: number; amount: number }[];
  store_distribution: { type: string; count: number }[];
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

@Injectable({
  providedIn: 'root',
})
export class OrganizationDashboardService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getDashboardStats(
    organizationId: string,
    period?: string,
  ): Observable<OrganizationDashboardStats> {
    const params = period ? `?period=${period}` : '';
    return this.http
      .get<OrganizationDashboardStats>(
        `${this.apiUrl}/organization/organizations/${organizationId}/stats${params}`,
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
}
