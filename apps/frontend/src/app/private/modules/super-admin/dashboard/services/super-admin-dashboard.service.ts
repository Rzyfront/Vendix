import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
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

  constructor(private http: HttpClient) {}

  getDashboardStats(): Observable<SuperAdminStats> {
    return this.http
      .get<SuperAdminStats>(`${this.apiUrl}/admin/dashboard/stats`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching super admin dashboard stats:', error);
          return throwError(() => new Error('Failed to fetch dashboard stats'));
        }),
      );
  }

  getOrganizationsStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/organizations/dashboard`).pipe(
      catchError((error) => {
        console.error('Error fetching organizations stats:', error);
        return throwError(
          () => new Error('Failed to fetch organizations stats'),
        );
      }),
    );
  }

  getUsersStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/users/dashboard`).pipe(
      catchError((error) => {
        console.error('Error fetching users stats:', error);
        return throwError(() => new Error('Failed to fetch users stats'));
      }),
    );
  }

  getStoresStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/stores/dashboard`).pipe(
      catchError((error) => {
        console.error('Error fetching stores stats:', error);
        return throwError(() => new Error('Failed to fetch stores stats'));
      }),
    );
  }

  getDomainsStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/domains/dashboard`).pipe(
      catchError((error) => {
        console.error('Error fetching domains stats:', error);
        return throwError(() => new Error('Failed to fetch domains stats'));
      }),
    );
  }

  getRolesStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/roles/dashboard`).pipe(
      catchError((error) => {
        console.error('Error fetching roles stats:', error);
        return throwError(() => new Error('Failed to fetch roles stats'));
      }),
    );
  }

  getPlatformHealth(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/health`).pipe(
      catchError((error) => {
        console.error('Error fetching platform health:', error);
        return throwError(() => new Error('Failed to fetch platform health'));
      }),
    );
  }

  getSystemMetrics(): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/metrics`).pipe(
      catchError((error) => {
        console.error('Error fetching system metrics:', error);
        return throwError(() => new Error('Failed to fetch system metrics'));
      }),
    );
  }
}
