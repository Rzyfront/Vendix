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
  ProductProfitability,
  ProfitabilitySummary,
  ProfitabilityResponse,
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
  CustomersByChannel,
} from '../interfaces/customers-analytics.interface';
import {
  AbandonedCartsSummary,
  AbandonedCartTrend,
  AbandonedCartByReason,
  AbandonedCartsAnalyticsQueryDto,
} from '../interfaces/abandoned-carts-analytics.interface';
import { PaginatedResponse } from '../interfaces/analytics.interface';

// Purchases interfaces
export interface PurchasesSummary {
  total_orders: number;
  total_spent: number;
  pending_orders: number;
  completed_orders: number;
  total_items_ordered: number;
  total_items_received: number;
  total_tax_amount: number;
  average_order_value: number;
}

export interface PurchasesBySupplier {
  supplier_id: number;
  supplier_name: string;
  order_count: number;
  total_spent: number;
  pending_orders: number;
  last_order_date: string | null;
}

// Reviews interfaces
export interface ReviewsSummary {
  total_reviews: number;
  average_rating: number;
  verified_purchases: number;
  pending_reviews: number;
  approved_reviews: number;
  rejected_reviews: number;
  rating_distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
  total_helpful_votes: number;
}

// Financial interfaces
export interface ProfitLossSummary {
  period: { start_date: string; end_date: string };
  revenue: {
    gross_revenue: number;
    discounts: number;
    net_revenue: number;
    shipping_revenue: number;
    tax_collected: number;
  };
  costs: {
    cost_of_goods_sold: number;
    gross_profit: number;
    gross_margin: number;
  };
  refunds: {
    total_refunds: number;
    subtotal_refunds: number;
    tax_refunds: number;
    shipping_refunds: number;
  };
  operating_expenses: number;
  bottom_line: {
    net_profit: number;
    net_margin: number;
    order_count: number;
  };
}

export interface RefundsSummary {
  total_refunds: number;
  subtotal_refunds: number;
  tax_refunds: number;
  shipping_refunds: number;
}

export interface TaxSummary {
  period: { start_date: string; end_date: string };
  total_tax_collected: number;
  total_tax_refunded: number;
  net_tax: number;
  total_taxable_revenue: number;
  effective_tax_rate: number;
  breakdown: Array<{
    tax_name: string;
    tax_rate: number;
    total_tax: number;
    taxable_amount: number;
    is_compound: boolean;
  }>;
}

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
          if (dateRange.start_date && dateRange.end_date) {
            params = params.set('date_from', dateRange.start_date);
            params = params.set('date_to', dateRange.end_date);
          } else if (dateRange.preset) {
            params = params.set('date_preset', dateRange.preset);
          }
        } else {
          params = params.set(key, String(value));
        }
      }
    });

    // Auto-inject browser timezone so backend calculates "hoy"/"este mes"
    // en la zona local del usuario (no en UTC). Sin esto, usuarios al
    // oeste de UTC ven ventas de la tarde aparecer en "mañana".
    if (!params.has('timezone')) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) params = params.set('timezone', tz);
      } catch {
        // Intl no disponible: omitir timezone → backend usa UTC fallback
      }
    }

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
    const cacheKey = `overview-trends-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<OverviewTrend[]>>(
        this.getApiUrl('overview/trends'),
        { params: this.buildParams(query) },
      ),
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
    const cacheKey = `sales-by-product-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<SalesByProduct[]>>(
        this.getApiUrl('sales/by-product'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getSalesByCategory(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByCategory[]>> {
    const cacheKey = `sales-by-category-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<SalesByCategory[]>>(
        this.getApiUrl('sales/by-category'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getSalesByPaymentMethod(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByPaymentMethod[]>> {
    const cacheKey = `sales-by-payment-method-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<SalesByPaymentMethod[]>>(
        this.getApiUrl('sales/by-payment-method'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getSalesTrends(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesTrend[]>> {
    const cacheKey = `sales-trends-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<SalesTrend[]>>(
        this.getApiUrl('sales/trends'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getSalesByCustomer(
    query: SalesAnalyticsQueryDto = {},
  ): Observable<ApiResponse<SalesByCustomer[]>> {
    const cacheKey = `sales-by-customer-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<SalesByCustomer[]>>(
        this.getApiUrl('sales/by-customer'),
        { params: this.buildParams(query) },
      ),
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
    const cacheKey = `products-top-sellers-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<TopSellingProduct[]>>(
        this.getApiUrl('products/top-sellers'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getProductsTrends(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<ProductTrend[]>> {
    const cacheKey = `products-trends-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<ProductTrend[]>>(
        this.getApiUrl('products/trends'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getProductsTable(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<PaginatedResponse<ProductAnalyticsRow>> {
    const cacheKey = `products-table-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<PaginatedResponse<ProductAnalyticsRow>>(
        this.getApiUrl('products/table'),
        { params: this.buildParams(query) },
      ),
    );
  }

  exportProductsAnalytics(query: ProductsAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('products/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  getProductProfitability(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<ProfitabilityResponse>> {
    const cacheKey = `product-profitability-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<ProfitabilityResponse>>(
        this.getApiUrl('products/profitability'),
        { params: this.buildParams(query) },
      ),
    );
  }

  exportProductProfitability(
    query: ProductsAnalyticsQueryDto = {},
  ): Observable<Blob> {
    return this.http.get(this.getApiUrl('products/profitability/export'), {
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
    const cacheKey = `inventory-movements-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<StockMovementReport[]>>(
        this.getApiUrl('inventory/movements'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getInventoryValuation(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<InventoryValuation[]>> {
    const cacheKey = `inventory-valuation-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<InventoryValuation[]>>(
        this.getApiUrl('inventory/valuation'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getInventoryAging(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<InventoryAging[]>> {
    const cacheKey = `inventory-aging-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<InventoryAging[]>>(
        this.getApiUrl('inventory/aging'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getExpiringProducts(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<ExpiringProduct[]>> {
    const cacheKey = `inventory-expiring-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<ExpiringProduct[]>>(
        this.getApiUrl('inventory/expiring'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getMovementSummary(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<MovementSummaryItem[]>> {
    const cacheKey = `inventory-movement-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<MovementSummaryItem[]>>(
        this.getApiUrl('inventory/movement-summary'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getMovementTrends(
    query: InventoryAnalyticsQueryDto = {},
  ): Observable<ApiResponse<MovementTrend[]>> {
    const cacheKey = `inventory-movement-trends-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<MovementTrend[]>>(
        this.getApiUrl('inventory/movement-trends'),
        { params: this.buildParams(query) },
      ),
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

  getCustomersChannels(
    query: CustomersAnalyticsQueryDto = {},
  ): Observable<ApiResponse<CustomersByChannel>> {
    return this.http.get<ApiResponse<CustomersByChannel>>(
      this.getApiUrl('customers/channels'),
      { params: this.buildParams(query) },
    );
  }

  exportCustomersAnalytics(query: CustomersAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('customers/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  // ==================== ABANDONED CARTS ANALYTICS ====================

  getAbandonedCartsSummary(
    query: AbandonedCartsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<AbandonedCartsSummary>> {
    const cacheKey = `abandoned-carts-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<AbandonedCartsSummary>>(
        this.getApiUrl('customers/abandoned-carts/summary'),
        { params: this.buildParams(query) },
      ),
    );
  }

  getAbandonedCartsTrends(
    query: AbandonedCartsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<AbandonedCartTrend[]>> {
    return this.http.get<ApiResponse<AbandonedCartTrend[]>>(
      this.getApiUrl('customers/abandoned-carts/trends'),
      { params: this.buildParams(query) },
    );
  }

  getAbandonedCartsByReason(
    query: AbandonedCartsAnalyticsQueryDto = {},
  ): Observable<ApiResponse<AbandonedCartByReason[]>> {
    return this.http.get<ApiResponse<AbandonedCartByReason[]>>(
      this.getApiUrl('customers/abandoned-carts/by-reason'),
      { params: this.buildParams(query) },
    );
  }

  exportAbandonedCartsAnalytics(query: AbandonedCartsAnalyticsQueryDto = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('customers/abandoned-carts/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  // ==================== PURCHASES ANALYTICS ====================

  getPurchasesSummary(
    query: any = {},
  ): Observable<ApiResponse<PurchasesSummary>> {
    const cacheKey = `purchases-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<PurchasesSummary>>(this.getApiUrl('purchases/summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  getPurchasesBySupplier(
    query: any = {},
  ): Observable<PaginatedResponse<PurchasesBySupplier>> {
    const cacheKey = `purchases-by-supplier-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<PaginatedResponse<PurchasesBySupplier>>(
        this.getApiUrl('purchases/by-supplier'),
        { params: this.buildParams(query) },
      ),
    );
  }

  // ==================== REVIEWS ANALYTICS ====================

  getReviewsSummary(
    query: any = {},
  ): Observable<ApiResponse<ReviewsSummary>> {
    const cacheKey = `reviews-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<ReviewsSummary>>(this.getApiUrl('reviews/summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  // ==================== FINANCIAL ANALYTICS ====================

  getProfitLossSummary(
    query: any = {},
  ): Observable<ApiResponse<ProfitLossSummary>> {
    const cacheKey = `profit-loss-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<ProfitLossSummary>>(this.getApiUrl('financial/profit-loss'), {
        params: this.buildParams(query),
      }),
    );
  }

  getTaxSummary(
    query: any = {},
  ): Observable<ApiResponse<TaxSummary>> {
    const cacheKey = `tax-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<TaxSummary>>(this.getApiUrl('financial/tax-summary'), {
        params: this.buildParams(query),
      }),
    );
  }

  getRefundsSummary(
    query: any = {},
  ): Observable<ApiResponse<RefundsSummary>> {
    const cacheKey = `refunds-summary-${JSON.stringify(query)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<ApiResponse<RefundsSummary>>(this.getApiUrl('financial/refunds'), {
        params: this.buildParams(query),
      }),
    );
  }

  // ==================== EXPORTS ====================

  exportPurchasesAnalytics(query: any = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('purchases/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  exportReviewsAnalytics(query: any = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('reviews/export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }

  exportFinancialAnalytics(query: any = {}): Observable<Blob> {
    return this.http.get(this.getApiUrl('financial/export'), {
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
