import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  AnalyticsResponse,
  DateRangeFilter,
} from '../interfaces/analytics.interface';
import {
  SalesSummary,
  SalesByProduct,
  SalesByCategory,
  SalesByPaymentMethod,
  SalesTrend,
  SalesByCustomer,
  SalesByChannel,
  SalesAnalyticsQueryDto,
} from '../interfaces/sales-analytics.interface';
import {
  InventorySummary,
  StockLevelReport,
  StockMovementReport,
  InventoryValuation,
  InventoryAging,
  ExpiringProduct,
  InventoryAnalyticsQueryDto,
  MovementSummaryItem,
  MovementTrend,
} from '../interfaces/inventory-analytics.interface';
import {
  ProductsSummary,
  TopSellingProduct,
  ProductAnalyticsRow,
  ProductTrend,
  ProductsAnalyticsQueryDto,
} from '../interfaces/products-analytics.interface';
import {
  OverviewSummary,
  OverviewTrend,
  OverviewAnalyticsQueryDto,
} from '../interfaces/overview-analytics.interface';
import {
  CustomersSummary,
  CustomerTrend,
  TopCustomer,
  CustomersAnalyticsQueryDto,
} from '../interfaces/customers-analytics.interface';
import { PaginatedResponse } from '../interfaces/analytics.interface';

// Cache entry interface
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

// Static cache
const analyticsCache = new Map<string, CacheEntry<Observable<any>>>();

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private http = inject(HttpClient);
  private readonly CACHE_TTL = 60000; // 60 seconds for analytics

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/analytics/${endpoint}`;
  }

  private buildParams(query: Record<string, any>): HttpParams {
    let params = new HttpParams();

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (typeof value === 'object' && key === 'date_range') {
          const dateRange = value as DateRangeFilter;
          if (dateRange.start_date) {
            params = params.set('date_from', dateRange.start_date);
          }
          if (dateRange.end_date) {
            params = params.set('date_to', dateRange.end_date);
          }
          if (dateRange.preset) {
            params = params.set('date_preset', dateRange.preset);
          }
        } else {
          params = params.set(key, String(value));
        }
      }
    });

    return params;
  }

  private withCache<T>(
    key: string,
    factory: () => Observable<T>,
  ): Observable<T> {
    const now = Date.now();
    const cached = analyticsCache.get(key);

    if (cached && now - cached.lastFetch < this.CACHE_TTL) {
      return cached.observable as Observable<T>;
    }

    const observable$ = factory().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        const entry = analyticsCache.get(key);
        if (entry) entry.lastFetch = Date.now();
      }),
    );

    analyticsCache.set(key, { observable: observable$, lastFetch: now });
    return observable$;
  }

  // ==================== OVERVIEW ANALYTICS ====================

  getOverviewSummary(
    query: OverviewAnalyticsQueryDto = {},
  ): Observable<ApiResponse<OverviewSummary>> {
    const cacheKey = `overview-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<OverviewSummary>>(this.getApiUrl('overview/summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  getOverviewTrends(
    query: OverviewAnalyticsQueryDto = {},
  ): Observable<ApiResponse<OverviewTrend[]>> {
    return this.http.get<ApiResponse<OverviewTrend[]>>(
      this.getApiUrl('overview/trends'),
      { params: this.buildParams(query) },
    );
  }

  // ==================== SALES ANALYTICS ====================

  getSalesSummary(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesSummary>> {
    const cacheKey = `sales-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<SalesSummary>>(this.getApiUrl('sales/summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  getSalesByProduct(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByProduct[]>> {
    return this.http.get<ApiResponse<SalesByProduct[]>>(
      this.getApiUrl('sales/by-product'),
      { params: this.buildParams(query) },
    );
  }

  getSalesByCategory(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByCategory[]>> {
    return this.http.get<ApiResponse<SalesByCategory[]>>(
      this.getApiUrl('sales/by-category'),
      { params: this.buildParams(query) },
    );
  }

  getSalesByPaymentMethod(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByPaymentMethod[]>> {
    return this.http.get<ApiResponse<SalesByPaymentMethod[]>>(
      this.getApiUrl('sales/by-payment-method'),
      { params: this.buildParams(query) },
    );
  }

  getSalesTrends(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesTrend[]>> {
    return this.http.get<ApiResponse<SalesTrend[]>>(
      this.getApiUrl('sales/trends'),
      { params: this.buildParams(query) },
    );
  }

  getSalesByCustomer(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByCustomer[]>> {
    return this.http.get<ApiResponse<SalesByCustomer[]>>(
      this.getApiUrl('sales/by-customer'),
      { params: this.buildParams(query) },
    );
  }

  getSalesByChannel(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByChannel[]>> {
    return this.http.get<ApiResponse<SalesByChannel[]>>(
      this.getApiUrl('sales/by-channel'),
      { params: this.buildParams(query) },
    );
  }

  exportSalesAnalytics(query: SalesAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('sales/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  // ==================== PRODUCTS ANALYTICS ====================

  getProductsSummary(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<ProductsSummary>> {
    const cacheKey = `products-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<ProductsSummary>>(this.getApiUrl('products/summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  getTopSellingProducts(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<TopSellingProduct[]>> {
    return this.http.get<ApiResponse<TopSellingProduct[]>>(
      this.getApiUrl('products/top-sellers'),
      { params: this.buildParams(query) },
    );
  }

  getProductsTrends(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<ProductTrend[]>> {
    return this.http.get<ApiResponse<ProductTrend[]>>(
      this.getApiUrl('products/trends'),
      { params: this.buildParams(query) },
    );
  }

  getProductsTable(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<PaginatedResponse<ProductAnalyticsRow>> {
    return this.http.get<PaginatedResponse<ProductAnalyticsRow>>(
      this.getApiUrl('products/table'),
      { params: this.buildParams(query) },
    );
  }

  exportProductsAnalytics(query: ProductsAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('products/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  // ==================== INVENTORY ANALYTICS ====================

  getInventorySummary(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<InventorySummary>> {
    const cacheKey = `inventory-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<InventorySummary>>(
        this.getApiUrl('inventory/summary'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getStockLevels(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<StockLevelReport[]>> {
    return this.http.get<ApiResponse<StockLevelReport[]>>(
      this.getApiUrl('inventory/stock-levels'),
      { params: this.buildParams(query) },
    );
  }

  getLowStockAlerts(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<StockLevelReport[]>> {
    return this.http.get<ApiResponse<StockLevelReport[]>>(
      this.getApiUrl('inventory/low-stock'),
      { params: this.buildParams(query) },
    );
  }

  getStockMovements(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<StockMovementReport[]>> {
    return this.http.get<ApiResponse<StockMovementReport[]>>(
      this.getApiUrl('inventory/movements'),
      { params: this.buildParams(query) },
    );
  }

  getInventoryValuation(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<InventoryValuation[]>> {
    return this.http.get<ApiResponse<InventoryValuation[]>>(
      this.getApiUrl('inventory/valuation'),
      { params: this.buildParams(query) },
    );
  }

  getInventoryAging(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<InventoryAging[]>> {
    return this.http.get<ApiResponse<InventoryAging[]>>(
      this.getApiUrl('inventory/aging'),
      { params: this.buildParams(query) },
    );
  }

  getExpiringProducts(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<ExpiringProduct[]>> {
    return this.http.get<ApiResponse<ExpiringProduct[]>>(
      this.getApiUrl('inventory/expiring'),
      { params: this.buildParams(query) },
    );
  }

  getMovementSummary(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<MovementSummaryItem[]>> {
    return this.http.get<ApiResponse<MovementSummaryItem[]>>(
      this.getApiUrl('inventory/movement-summary'),
      { params: this.buildParams(query) },
    );
  }

  getMovementTrends(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<MovementTrend[]>> {
    return this.http.get<ApiResponse<MovementTrend[]>>(
      this.getApiUrl('inventory/movement-trends'),
      { params: this.buildParams(query) },
    );
  }

  exportMovementsXlsx(query: InventoryAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('inventory/movements/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  exportInventoryAnalytics(query: InventoryAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('inventory/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  // ==================== CUSTOMERS ANALYTICS ====================

  getCustomersSummary(
    query: CustomersAnalyticsQueryDto = {},
  ): Observable<ApiResponse<CustomersSummary>> {
    const cacheKey = `customers-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<CustomersSummary>>(this.getApiUrl('customers/summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  getCustomersTrends(
    query: CustomersAnalyticsQueryDto = {},
  ): Observable<ApiResponse<CustomerTrend[]>> {
    return this.http.get<ApiResponse<CustomerTrend[]>>(
      this.getApiUrl('customers/trends'),
      { params: this.buildParams(query) },
    );
  }

  getTopCustomers(
    query: CustomersAnalyticsQueryDto = {},
  ): Observable<ApiResponse<TopCustomer[]>> {
    return this.http.get<ApiResponse<TopCustomer[]>>(
      this.getApiUrl('customers/top'),
      { params: this.buildParams(query) },
    );
  }

  exportCustomersAnalytics(query: CustomersAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('customers/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  // ==================== CACHE MANAGEMENT ====================

  invalidateCache(prefix?: string): void {
    if (prefix) {
      for (const key of analyticsCache.keys()) {
        if (key.startsWith(prefix)) {
          analyticsCache.delete(key);
        }
      }
    } else {
      analyticsCache.clear();
    }
  }
}
