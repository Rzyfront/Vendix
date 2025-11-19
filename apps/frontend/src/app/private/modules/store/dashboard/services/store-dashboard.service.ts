import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface StoreDashboardStats {
  totalProducts: number;
  totalCustomers: number;
  monthlyOrders: number;
  monthlyRevenue: number;
  productsGrowth: number;
  customersGrowth: number;
  ordersGrowth: number;
  revenueGrowth: number;
  salesData: SalesData[];
  topProducts: TopProduct[];
  recentOrders: RecentOrder[];
  customerActivity: CustomerActivity[];
}

export interface SalesData {
  date: string;
  orders: number;
  revenue: number;
  customers: number;
}

export interface TopProduct {
  id: string;
  name: string;
  sku: string;
  sales: number;
  revenue: number;
  stock: number;
  status: 'active' | 'inactive' | 'out_of_stock';
}

export interface RecentOrder {
  id: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  items: number;
  timestamp: Date;
}

export interface CustomerActivity {
  date: string;
  newCustomers: number;
  returningCustomers: number;
  totalOrders: number;
}

@Injectable({
  providedIn: 'root',
})
export class StoreDashboardService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getDashboardStats(storeId: string): Observable<StoreDashboardStats> {
    return this.http
      .get<StoreDashboardStats>(
        `${this.apiUrl}/stores/${storeId}/dashboard/stats`,
      )
      .pipe(
        catchError((error) => {
          console.error('Error fetching store dashboard stats:', error);
          return throwError(
            () => new Error('Failed to fetch store dashboard stats'),
          );
        }),
      );
  }

  getSalesStats(
    storeId: string,
    period: 'week' | 'month' | 'year' = 'month',
  ): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/stores/${storeId}/sales/stats?period=${period}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching store sales stats:', error);
          return throwError(() => new Error('Failed to fetch sales stats'));
        }),
      );
  }

  getProductsStats(storeId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/products/stats/store/${storeId}`).pipe(
      catchError((error) => {
        console.error('Error fetching store products stats:', error);
        return throwError(() => new Error('Failed to fetch products stats'));
      }),
    );
  }

  getCustomersStats(storeId: string): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/stores/${storeId}/customers/stats`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching store customers stats:', error);
          return throwError(() => new Error('Failed to fetch customers stats'));
        }),
      );
  }

  getTopProducts(storeId: string, limit: number = 5): Observable<TopProduct[]> {
    return this.http
      .get<
        TopProduct[]
      >(`${this.apiUrl}/stores/${storeId}/products/top?limit=${limit}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching top products:', error);
          return throwError(() => new Error('Failed to fetch top products'));
        }),
      );
  }

  getRecentOrders(
    storeId: string,
    limit: number = 10,
  ): Observable<RecentOrder[]> {
    return this.http
      .get<
        RecentOrder[]
      >(`${this.apiUrl}/stores/${storeId}/orders/recent?limit=${limit}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching recent orders:', error);
          return throwError(() => new Error('Failed to fetch recent orders'));
        }),
      );
  }

  getCustomerActivity(
    storeId: string,
    period: 'week' | 'month' = 'week',
  ): Observable<CustomerActivity[]> {
    return this.http
      .get<
        CustomerActivity[]
      >(`${this.apiUrl}/stores/${storeId}/customers/activity?period=${period}`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching customer activity:', error);
          return throwError(
            () => new Error('Failed to fetch customer activity'),
          );
        }),
      );
  }

  getInventoryStats(storeId: string): Observable<any> {
    return this.http
      .get(`${this.apiUrl}/stores/${storeId}/inventory/stats`)
      .pipe(
        catchError((error) => {
          console.error('Error fetching inventory stats:', error);
          return throwError(() => new Error('Failed to fetch inventory stats'));
        }),
      );
  }

  getRevenueAnalytics(
    storeId: string,
    period: 'week' | 'month' | 'year' = 'month',
  ): Observable<any> {
    return this.http
      .get(
        `${this.apiUrl}/stores/${storeId}/revenue/analytics?period=${period}`,
      )
      .pipe(
        catchError((error) => {
          console.error('Error fetching revenue analytics:', error);
          return throwError(
            () => new Error('Failed to fetch revenue analytics'),
          );
        }),
      );
  }
}
