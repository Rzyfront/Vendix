import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay, map, catchError } from 'rxjs/operators';
import { signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import {
  InventoryScope,
  InventorySettings,
} from '../../../../../core/models/store-settings.interface';
import {
  StockSourcingSuggestionQuery,
  StockSourcingSuggestionResponse,
} from '../models/sourcing.model';

/**
 * Promotional descriptor surfaced on POS product cards. Mirrors the backend
 * `ActiveProductPromotion` shape returned by the products listing endpoint.
 * The card uses `promotional_price` + `badge_label` to render the visual
 * discount, but the authoritative discount is always re-computed in backend
 * at checkout via the promotion engine.
 */
export interface ActiveProductPromotion {
  id: number;
  name: string;
  type: 'percentage' | 'fixed_amount';
  scope: 'product' | 'category';
  discount_percentage?: number;
  discount_amount?: number;
  promotional_price: number;
  badge_label: string;
  priority: number;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  final_price: number;
  cost?: number;
  is_on_sale?: boolean;
  sale_price?: number | null;
  active_promotion?: ActiveProductPromotion | null;
  allow_pos_price_override?: boolean;
  category: string;
  category_id?: number | null;
  category_ids?: number[];
  brand?: string;
  stock: number;
  available_stock?: number | null;
  is_available?: boolean;
  effective_track_inventory?: boolean;
  track_inventory?: boolean;
  minStock: number;
  min_stock_level?: number | null;
  reorder_point?: number | null;
  low_stock_threshold?: number | null;
  image?: string;
  image_url?: string;
  description?: string;
  barcode?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tax_assignments?: ProductTaxAssignment[];
  has_variants: boolean;
  product_variants: PosProductVariant[];
  pricing_type?: 'unit' | 'weight';
  // Multi-tarifa flags (Phase 5)
  has_multiple_price_tiers?: boolean;
  units_per_package?: number | null;
  package_consumes_multiple_stock?: boolean;
  enabled_price_tier_ids?: number[];
}

export interface ProductTaxAssignment {
  product_id: number;
  tax_category_id: number;
  tax_categories?: TaxCategory;
}

export interface TaxCategory {
  id: number;
  name: string;
  description?: string;
  tax_rates?: TaxRate[];
  store_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface TaxRate {
  id: number;
  name: string;
  rate: string;
  store_id: number;
  is_compound: boolean;
  priority: number;
  created_at: Date;
  updated_at: Date;
}

export interface Category {
  id: string;
  name: string;
}

export interface Brand {
  id: string;
  name: string;
}

export interface PosVariantAttribute {
  attribute_name: string;
  attribute_value: string;
}

export interface PosProductVariant {
  id: number;
  sku: string | null;
  price_override: number | null;
  cost_price: number | null;
  stock: number;
  available_stock?: number | null;
  is_available?: boolean;
  effective_track_inventory?: boolean;
  is_active: boolean;
  is_on_sale?: boolean;
  sale_price?: number | null;
  track_inventory_override?: boolean | null;
  attributes: PosVariantAttribute[];
  image_url?: string;
  barcode?: string;
}

export interface SearchFilters {
  query?: string;
  search?: string; // Add search as alias for query
  category?: string;
  brand?: string;
  category_id?: string | number; // Add category_id for compatibility
  brand_id?: string | number; // Add brand_id for compatibility
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sortBy?: 'name' | 'price' | 'stock' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  pos_optimized?: boolean;
  barcode?: string;
  include_stock?: boolean;
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable({
  providedIn: 'root',
})
export class PosProductService {
  private readonly apiUrl = `${environment.apiUrl}/store/products`;
  private readonly stockLevelsUrl = `${environment.apiUrl}/store/inventory/stock-levels`;
  private categories: Category[] = [];
  private brands: Brand[] = [];
  readonly searchHistory = signal<string[]>([]);
  readonly searchHistory$ = toObservable(this.searchHistory);

  private readonly storeSettingsFacade = inject(StoreSettingsFacade);

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) {
    this.initializeMockData();
  }

  /**
   * Resolved POS stock scope for the current store. Used by consumers to
   * decide UX flows (e.g. sourcing suggestion modal); stock filtering itself
   * is handled server-side.
   */
  getPosStockScope(): InventoryScope {
    const inventory = this.storeSettingsFacade.settings()?.inventory as
      | InventorySettings
      | undefined;
    return inventory?.pos_stock_scope ?? 'all_locations';
  }

  getLowStockThreshold(): number {
    const inventory = this.storeSettingsFacade.settings()?.inventory as
      | InventorySettings
      | undefined;
    const threshold = Number(inventory?.low_stock_threshold);
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : 10;
  }

  /**
   * Ask the backend for a sourcing recommendation when the in-scope stock
   * does not cover `quantity`. Returns the typed response or throws.
   */
  getStockSourcingSuggestion(
    query: StockSourcingSuggestionQuery,
  ): Observable<StockSourcingSuggestionResponse> {
    const httpQuery: Record<string, string | number> = {
      product_id: query.product_id,
      quantity: query.quantity,
    };
    if (query.product_variant_id != null) {
      httpQuery['product_variant_id'] = query.product_variant_id;
    }
    const params = this.buildParams(httpQuery);

    return this.http
      .get<any>(`${this.stockLevelsUrl}/sourcing-suggestion`, { params })
      .pipe(
        map((response) => {
          const data = response?.success ? response.data : response;
          return data as StockSourcingSuggestionResponse;
        }),
        catchError((error: any) => {
          console.error(
            'PosProductService.getStockSourcingSuggestion Error:',
            error,
          );
          return throwError(
            () =>
              error?.error?.message ||
              'No se pudo consultar la disponibilidad en otras bodegas',
          );
        }),
      );
  }

  private initializeMockData(): void {
    this.categories = [
      { id: 'all', name: 'Todos' },
      { id: 'electronics', name: 'Electronicos' },
      { id: 'clothing', name: 'Ropa' },
      { id: 'food', name: 'Alimentos' },
      { id: 'books', name: 'Libros' },
      { id: 'other', name: 'Otros' },
    ];

    this.brands = [
      { id: 'all', name: 'Todos' },
      { id: 'logitech', name: 'Logitech' },
      { id: 'corsair', name: 'Corsair' },
      { id: 'lg', name: 'LG' },
      { id: 'samsung', name: 'Samsung' },
    ];
  }

  searchProducts(
    filters: SearchFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Observable<SearchResult> {
    const query: any = {
      page,
      limit: pageSize,
      state: 'active',
    };

    if (filters.query || filters.search) {
      query.search = filters.query || filters.search;
    }

    if (
      (filters.category && filters.category !== 'all') ||
      filters.category_id
    ) {
      query.category_id =
        filters.category !== 'all' ? filters.category : filters.category_id;
    }

    if ((filters.brand && filters.brand !== 'all') || filters.brand_id) {
      query.brand_id =
        filters.brand !== 'all' ? filters.brand : filters.brand_id;
    }

    if (filters.inStock) {
      query.include_stock = 'true';
    }

    if (filters.minPrice) {
      query.min_price = filters.minPrice;
    }

    if (filters.maxPrice) {
      query.max_price = filters.maxPrice;
    }

    if (filters.pos_optimized) {
      query.pos_optimized = 'true';
    }

    if (filters.barcode) {
      query.barcode = filters.barcode;
    }

    if (filters.include_stock) {
      query.include_stock = 'true';
    }

    const params = this.buildParams(query);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        // Uniform way to extract data and pagination
        let productsResult = [];
        let total = 0;
        let currentPage = page;
        let limitNum = pageSize;

        // Check for the success wrapper
        const responseData = response.success ? response.data : response;

        if (Array.isArray(responseData)) {
          productsResult = responseData;
          total = productsResult.length;
        } else if (responseData && Array.isArray(responseData.data)) {
          // Format { data: [...], pagination: {...} } or { data: [...], meta: {...} }
          productsResult = responseData.data;
          const pagination =
            responseData.pagination || responseData.meta || response.meta || {};
          total = pagination.total || productsResult.length;
          currentPage = pagination.page || page;
          limitNum = pagination.limit || pageSize;
        } else if (responseData) {
          // Fallback if data is directly in response.data but success check passed
          productsResult = Array.isArray(responseData) ? responseData : [];
          total =
            response.meta?.total || response.total || productsResult.length;
          currentPage = response.meta?.page || response.page || page;
          limitNum = response.meta?.limit || response.limit || pageSize;
        }

        const totalPages = Math.ceil(total / limitNum);
        const transformedProducts = this.transformProducts(productsResult);

        return {
          products: transformedProducts,
          total,
          page: currentPage,
          pageSize: limitNum,
          totalPages,
        };
      }),
      catchError((error: any) => {
        console.error('PosProductService Error:', error);
        let errorMessage = 'Error al cargar productos';

        if (error.error?.message) {
          errorMessage = error.error.message;
        } else if (error.status === 400) {
          errorMessage = 'Datos inválidos proporcionados';
        } else if (error.status === 401) {
          errorMessage = 'Acceso no autorizado';
        } else if (error.status === 403) {
          errorMessage = 'Permisos insuficientes';
        } else if (error.status === 404) {
          errorMessage = 'Producto no encontrado';
        } else if (error.status >= 500) {
          errorMessage = 'Error del servidor. Por favor intenta más tarde';
        }

        return throwError(() => errorMessage);
      }),
    );
  }

  private transformProducts(products: any[]): any[] {
    return products.map((product) => {
      // Backend computes available_stock from stock_levels honoring pos_stock_scope.
      // Prefer it; fall back to legacy denormalized stock_quantity, then to
      // summing per-location levels locally only if neither is present.
      const totalStock =
        product.available_stock ??
        product.stock_quantity ??
        (Array.isArray(product.stock_levels)
          ? product.stock_levels.reduce(
              (sum: number, level: any) =>
                sum + (level?.quantity_available || 0),
              0,
            )
          : 0);

      const effectiveTrackInventory =
        product.effective_track_inventory ?? product.track_inventory;

      const productIsAvailable =
        typeof product.is_available === 'boolean'
          ? product.is_available
          : effectiveTrackInventory === false
            ? true
            : totalStock > 0;

      // Get image URL with fallbacks - PRIORITIZE signed URL at the root
      let imageUrl = '';
      if (product.image_url) {
        imageUrl = product.image_url;
      } else if (product.product_images && product.product_images.length > 0) {
        imageUrl = product.product_images[0].image_url;
      } else if (product.image) {
        imageUrl = product.image;
      }

      // Map product variants
      const rawVariants = product.product_variants || [];
      const productVariants: PosProductVariant[] = rawVariants.map((v: any) => {
        const variantStock =
          v.available_stock ??
          v.stock_quantity ??
          (Array.isArray(v.stock_levels) && v.stock_levels.length > 0
            ? v.stock_levels.reduce(
                (sum: number, sl: any) => sum + (sl?.quantity_available ?? 0),
                0,
              )
            : (v.stock ?? 0));

        const variantEffectiveTracking =
          v.effective_track_inventory ??
          v.track_inventory_override ??
          product.track_inventory;

        const variantIsAvailable =
          typeof v.is_available === 'boolean'
            ? v.is_available
            : variantEffectiveTracking === false
              ? true
              : variantStock > 0;

        return {
          id: v.id,
          sku: v.sku || null,
          price_override:
            v.price_override != null ? Number(v.price_override) : null,
          cost_price: v.cost_price != null ? Number(v.cost_price) : null,
          is_on_sale: v.is_on_sale ?? false,
          sale_price: v.sale_price != null ? Number(v.sale_price) : null,
          track_inventory_override: v.track_inventory_override ?? null,
          stock: variantStock,
          available_stock:
            v.available_stock != null ? Number(v.available_stock) : null,
          is_available: variantIsAvailable,
          effective_track_inventory: variantEffectiveTracking ?? true,
          is_active: v.is_active ?? true,
          attributes: Array.isArray(v.attributes)
            ? v.attributes
            : v.attributes && typeof v.attributes === 'object'
              ? Object.entries(v.attributes).map(
                  ([key, value]: [string, any]) => ({
                    attribute_name: key,
                    attribute_value: String(value),
                  }),
                )
              : [],
          image_url: v.image_url || v.product_images?.image_url || undefined,
          barcode: v.barcode || undefined,
        };
      });

      const categories = Array.isArray(product.categories)
        ? product.categories
        : product.product_categories?.map(
            (pc: any) => pc.categories || pc.category || pc,
          ) || [];
      const categoryIds = categories
        .map((category: any) => Number(category?.id))
        .filter((id: number) => Number.isFinite(id));

      const activePromotion = this.parseActivePromotion(
        product.active_promotion,
      );

      const transformed = {
        id: product.id?.toString() || '',
        name: product.name || '',
        sku: product.sku || '',
        price: parseFloat(product.base_price || product.price || 0),
        final_price: parseFloat(
          product.final_price || product.base_price || product.price || 0,
        ),
        active_promotion: activePromotion,
        allow_pos_price_override: product.allow_pos_price_override === true,
        cost: product.cost_price ? parseFloat(product.cost_price) : undefined,
        category:
          categories[0]?.name || product.category?.name || 'Sin categoría',
        category_id: categoryIds[0] ?? null,
        category_ids: categoryIds,
        brand: product.brands?.name || '',
        stock: totalStock,
        available_stock:
          product.available_stock != null
            ? Number(product.available_stock)
            : null,
        is_available: productIsAvailable,
        effective_track_inventory: effectiveTrackInventory ?? true,
        track_inventory: product.track_inventory,
        minStock: this.resolveLowStockThreshold(product),
        min_stock_level: product.min_stock_level ?? null,
        reorder_point: product.reorder_point ?? null,
        low_stock_threshold: product.low_stock_threshold ?? null,
        image: imageUrl,
        image_url: imageUrl,
        description: product.description || '',
        barcode: product.barcode || '',
        tags: product.tags || [],
        isActive: product.state === 'active',
        createdAt: new Date(product.created_at),
        updatedAt: new Date(product.updated_at),
        tax_assignments: product.product_tax_assignments || [],
        has_variants: product.has_variants ?? productVariants.length > 0,
        product_variants: productVariants,
        pricing_type: product.pricing_type || 'unit',
        // Multi-tarifa (Phase 5)
        has_multiple_price_tiers: product.has_multiple_price_tiers === true,
        enabled_price_tier_ids: Array.isArray(product.enabled_price_tier_ids)
          ? product.enabled_price_tier_ids
              .map((id: unknown) => Number(id))
              .filter((id: number) => Number.isFinite(id))
          : [],
        units_per_package:
          product.units_per_package != null && product.units_per_package > 0
            ? Number(product.units_per_package)
            : null,
        package_consumes_multiple_stock:
          product.package_consumes_multiple_stock === true,
        // Campos de servicio y reserva
        product_type: product.product_type || 'physical',
        requires_booking: product.requires_booking === true,
        booking_mode: product.booking_mode || null,
        service_duration_minutes: product.service_duration_minutes || null,
        service_modality: product.service_modality || null,
        _rawStockLevels: product.stock_levels,
        _rawStockQuantity: product.stock_quantity,
        _rawImageUrl: product.image_url,
      };

      return transformed;
    });
  }

  private buildParams(query: any): HttpParams {
    let params = new HttpParams();

    Object.keys(query).forEach((key) => {
      const value = query[key];
      if (value !== undefined && value !== null) {
        params = params.set(key, value.toString());
      }
    });

    return params;
  }

  private handleError(error: any): Observable<never> {
    // Mensajes de error más descriptivos
    let errorMessage = 'An error occurred';

    if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.status === 400) {
      errorMessage = 'Invalid data provided';
    } else if (error.status === 401) {
      errorMessage = 'Unauthorized access';
    } else if (error.status === 403) {
      errorMessage = 'Insufficient permissions';
    } else if (error.status === 404) {
      errorMessage = 'Product not found';
    } else if (error.status === 409) {
      errorMessage = 'Product with this SKU or slug already exists';
    } else if (error.status >= 500) {
      errorMessage = 'Server error. Please try again later';
    }

    return throwError(() => errorMessage);
  }

  getProductById(id: string): Observable<Product | null> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`).pipe(
      catchError((error: any) => {
        return of(null);
      }),
    );
  }

  getProductByBarcode(barcode: string): Observable<Product | null> {
    const params = new HttpParams().set('barcode', barcode);
    return this.http.get<SearchResult>(this.apiUrl, { params }).pipe(
      map((response) =>
        response.products && response.products.length > 0
          ? response.products[0]
          : null,
      ),
      catchError((error: any) => {
        return of(null);
      }),
    );
  }

  getProductBySku(sku: string): Observable<Product | null> {
    const params = new HttpParams().set('sku', sku);
    return this.http.get<SearchResult>(this.apiUrl, { params }).pipe(
      map((response) =>
        response.products && response.products.length > 0
          ? response.products[0]
          : null,
      ),
      catchError((error: any) => {
        return of(null);
      }),
    );
  }

  getCategories(): Observable<Category[]> {
    return this.http.get<any>(`${environment.apiUrl}/store/categories`).pipe(
      map((response) => {
        const data = response.success ? response.data : response;
        return Array.isArray(data) ? data : data?.data || [];
      }),
      catchError((error: any) => {
        return of([]);
      }),
    );
  }

  getBrands(): Observable<Brand[]> {
    return this.http.get<any>(`${environment.apiUrl}/store/brands`).pipe(
      map((response) => {
        const data = response.success ? response.data : response;
        return Array.isArray(data) ? data : data?.data || [];
      }),
      catchError((error: any) => {
        return of([]);
      }),
    );
  }

  // Simplified method similar to ProductsService.getProducts()
  getProducts(query: any = {}): Observable<SearchResult> {
    const default_query = {
      page: 1,
      limit: 50,
      state: 'active',
      ...query,
    };

    const params = this.buildParams(default_query);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        const dataRoot = response.success ? response.data : response;
        let productsResult = [];
        let total = 0;
        let page = default_query.page;
        let limitNum = default_query.limit;

        if (Array.isArray(dataRoot)) {
          productsResult = dataRoot;
          total = productsResult.length;
        } else if (dataRoot && Array.isArray(dataRoot.data)) {
          productsResult = dataRoot.data;
          const pagination =
            dataRoot.pagination || dataRoot.meta || response.meta || {};
          total = pagination.total || productsResult.length;
          page = pagination.page || page;
          limitNum = pagination.limit || limitNum;
        }

        const transformedProducts = this.transformProducts(productsResult);
        const totalPages = Math.ceil(total / limitNum);

        return {
          products: transformedProducts,
          total,
          page,
          pageSize: limitNum,
          totalPages,
        };
      }),
      catchError((error: any) => {
        console.error('PosProductService.getProducts Error:', error);
        return throwError(() => 'Error al cargar productos');
      }),
    );
  }

  getCategoryIds(): Observable<string[]> {
    return of(this.categories.map((c) => c.id)).pipe(delay(100));
  }

  getBrandIds(): Observable<string[]> {
    return of(this.brands.map((b) => b.id)).pipe(delay(100));
  }

  getSearchHistory(): Observable<string[]> {
    return this.searchHistory$;
  }

  addToSearchHistory(query: string): void {
    if (!query || query.trim().length < 2) return;

    const current = this.searchHistory();
    const filtered = current.filter(
      (q) => q.toLowerCase() !== query.toLowerCase(),
    );
    const updated = [query, ...filtered].slice(0, 10);
    this.searchHistory.set(updated);
  }

  clearSearchHistory(): void {
    this.searchHistory.set([]);
  }

  getPopularProducts(limit: number = 10): Observable<Product[]> {
    // This would normally call an endpoint, for now return empty
    return of([]).pipe(delay(200));
  }

  getLowStockProducts(limit: number = 10): Observable<Product[]> {
    // This would normally call an endpoint, for now return empty
    return of([]).pipe(delay(200));
  }

  updateStock(productId: string, quantity: number): Observable<Product | null> {
    // This would normally call an endpoint, for now return null
    return of(null).pipe(delay(100));
  }

  /**
   * Defensive parser for the `active_promotion` payload that the backend
   * attaches to listing rows. Returns `null` when the field is missing,
   * malformed, or numerically invalid so the card can fall back to the
   * regular price without throwing on legacy/cached responses.
   */
  private parseActivePromotion(raw: any): ActiveProductPromotion | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = Number(raw.id);
    const promotionalPrice = Number(raw.promotional_price);
    if (!Number.isFinite(id) || !Number.isFinite(promotionalPrice)) {
      return null;
    }
    const type = raw.type === 'fixed_amount' ? 'fixed_amount' : 'percentage';
    const scope = raw.scope === 'category' ? 'category' : 'product';
    const badgeLabel =
      typeof raw.badge_label === 'string' && raw.badge_label.length > 0
        ? raw.badge_label
        : 'OFERTA';

    return {
      id,
      name: typeof raw.name === 'string' ? raw.name : 'Promoción',
      type,
      scope,
      discount_percentage:
        raw.discount_percentage != null
          ? Number(raw.discount_percentage)
          : undefined,
      discount_amount:
        raw.discount_amount != null ? Number(raw.discount_amount) : undefined,
      promotional_price: promotionalPrice,
      badge_label: badgeLabel,
      priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    };
  }

  private resolveLowStockThreshold(product: any): number {
    const productThreshold = [product.reorder_point, product.min_stock_level]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);

    if (productThreshold !== undefined) {
      return productThreshold;
    }

    const apiThreshold = Number(product.low_stock_threshold);
    if (Number.isFinite(apiThreshold) && apiThreshold >= 0) {
      return apiThreshold;
    }

    return this.getLowStockThreshold();
  }
}
