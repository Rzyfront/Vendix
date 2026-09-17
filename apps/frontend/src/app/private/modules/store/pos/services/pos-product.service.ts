import { Injectable, inject } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { delay, map, catchError, switchMap } from 'rxjs/operators';
import { signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
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
import { PRODUCT_SAVE_ERROR_MAP } from '../../products/utils/product-save-requirements';
import { parseApiError } from '../../../../../core/utils/parse-api-error';

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
  // F-221 — calculado de lectura (ver `vendix-calculated-pricing`): el payload
  // puede no traerlo y entonces la clave queda ausente, nunca fabricada.
  final_price?: number;
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
  // QUI-431 — when true, each unit sold must carry a unique serial number.
  // The POS opens a serial-selection modal before adding the product to cart.
  requires_serial_numbers?: boolean;
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
  /**
   * Product type snapshot. `prepared` flags a dish/recipe-backed product whose
   * inventory is consumed at fire-to-kitchen (restaurant suite). The POS uses
   * this to decide whether the "Enviar a cocina" action applies to a cart line.
   */
  product_type?: string;
  // CP-POS-SVC-BOOKING-001 — Service scheduling fields
  requires_booking?: boolean;
  booking_mode?: 'free_booking' | 'provider_required' | string | null;
  is_eligible_for_home_service?: boolean;
  service_duration_minutes?: number | null;
  duration_minutes?: number | null;
  // Multi-tarifa flags (Phase 5). Packaging (units-per-package) is no longer a
  // product field — it lives on the price tier / per-product tier override and
  // is resolved per cart line via PriceResolverService.resolveWithTier.
  has_multiple_price_tiers?: boolean;
  enabled_price_tier_ids?: number[];
  // ===== QUI-648 · un producto se mide de UNA sola manera =====
  // `undefined` significa "el endpoint no trajo el contrato" (el listado
  // `pos_optimized` todavía no lo expone) y NO "por pieza": ese matiz es el que
  // permite hidratar desde el detalle solo cuando hace falta. `null` sí
  // significa por pieza.
  /** FK a `units_of_measure`: unidad MÍNIMA en la que vive el stock. */
  stock_uom_id?: number | null;
  /** Unidades de stock que cubre `price`. `1` = precio por unidad. */
  price_unit_quantity?: number | null;
  /** Frase que explica cómo se vende, armada por el helper compartido. */
  sale_config_summary?: { headline: string; lines: string[] } | null;
  /**
   * Presentación pistoleada: cuando el código de barras pertenece a una tarifa
   * `sale_unit` del producto, el backend devuelve cuál. El POS agrega la línea
   * con esa presentación ya aplicada, sin preguntarle nada al cajero.
   */
  scanned_price_tier_id?: number | null;
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
  /**
   * Precio final con impuesto (contrato global-final-prices, backend en
   * paralelo). Opcional: el display usa `final_price ?? price_override`.
   */
  final_price?: number | null;
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
  /**
   * Restaurant Suite (Fase H) — when true, the listing is restricted
   * to products with `is_sellable=true`, hiding pure ingredients
   * from the POS product picker. The backend enforces this in the
   * scoped products query; the POS sends it explicitly for clarity.
   */
  is_sellable?: boolean;
  /**
   * Orden por defecto de la grilla del POS: antepone los productos marcados
   * como destacados (`is_featured`). Sólo se envía en la carga sin búsqueda ni
   * filtros — con un filtro activo manda el filtro, no este orden.
   */
  featured_first?: boolean;
  /**
   * Segundo criterio del orden por defecto: los más vendidos de los últimos 30
   * días. Con `featured_first` produce destacados → más vendidos → resto; sin
   * destacados en la tienda, la grilla queda ordenada por ventas.
   */
  best_selling_first?: boolean;
}

/**
 * CP-pos-smart-search · E.1 — espejo frontend de `SearchRankMeta` (backend:
 * `common/responses/response.interface.ts`, contrato ADR-08). Viaja en
 * `meta.search` solo en listados con `search`; ausente en el resto.
 */
export interface SearchRankMeta {
  rank_mode: 'ranked' | 'unranked_scan_cap' | 'unranked_error' | 'legacy';
  layer: 'legacy' | 'l1' | 'l2' | 'trigram';
  degraded: boolean;
}

/**
 * CP-pos-smart-search · E.4 (F-069) — input del evento CTR. `query` es la
 * cruda del input; el servicio la hashea antes de enviar (jamás viaja).
 */
export interface SearchSelectionInput {
  query: string;
  /** Posición 1-based dentro de la grilla visible al elegir. */
  position: number;
  product_id: number;
  /** Total backend (`meta.total`), no el largo de página. */
  result_count: number;
  rank_mode: SearchRankMeta['rank_mode'];
  layer?: SearchRankMeta['layer'];
  surface?: string;
}

/**
 * CP-pos-smart-search · E.4 (F-069) — sha256-hex de la query normalizada
 * (lowercase + trim + espacios colapsados). Misma normalización que el
 * backend documenta para `query_hash`: permite agrupar sin PII.
 */
export async function hashSearchQuery(query: string): Promise<string> {
  const norm = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(norm),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * CP-pos-smart-search · E.1 — error estructurado de `searchProducts`.
 * Conserva la causa (transporte vs HTTP vs envelope `success:false`) para
 * que la UI mensaje por causa (F-065) en vez de colapsar todo a un toast
 * genérico que contradice la grilla.
 */
export interface PosProductsLoadError {
  message: string;
  /** Status HTTP; 0 = fallo de transporte (red caída/timeout/DNS, ERR-13). */
  status: number;
  /** `error_code` del backend cuando viaja en el envelope. */
  code?: string;
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Meta de ranking (ADR-08); null cuando el backend no lo envía. */
  searchMeta: SearchRankMeta | null;
}

/** Type-guard para re-lanzar sin re-mapear errores ya estructurados. */
export function isPosProductsLoadError(
  value: unknown,
): value is PosProductsLoadError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['message'] === 'string' &&
    typeof candidate['status'] === 'number'
  );
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
    // E.1 (F-037) — clamp defensivo: un off-by-one jamás envía ?page=0 ni
    // limit=0 (el DTO no tiene @Min y Prisma muere → ERR-06 silencioso).
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safePageSize = Number.isFinite(pageSize)
      ? Math.max(1, Math.floor(pageSize))
      : 20;
    const query: any = {
      page: safePage,
      limit: safePageSize,
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

    if (filters.is_sellable !== undefined) {
      query.is_sellable = filters.is_sellable ? 'true' : 'false';
    }

    // Orden por defecto de la grilla (destacados → más vendidos). Se serializa
    // como string: el DTO del backend lo lee crudo con `@Transform`, así que
    // `'false'` se respeta como falso en vez de coaccionarse a `true`.
    if (filters.featured_first !== undefined) {
      query.featured_first = filters.featured_first ? 'true' : 'false';
    }

    if (filters.best_selling_first !== undefined) {
      query.best_selling_first = filters.best_selling_first ? 'true' : 'false';
    }

    const params = this.buildParams(query);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        // E.1 (F-036) — un envelope `success:false` (ERR-06/ERR-12) es un
        // FALLO, no una lista vacía: se lanza para que el path de error
        // (toast/banner + retry, items intactos) actúe en vez de pintar
        // textos ERR-01 engañosos.
        if (response?.success === false) {
          throw this.errorFromEnvelope(response);
        }

        // Uniform way to extract data and pagination
        let productsResult = [];
        let total = 0;
        let currentPage = safePage;
        let limitNum = safePageSize;

        // Check for the success wrapper
        const responseData = response.success ? response.data : response;

        if (Array.isArray(responseData)) {
          // E.1 (F-023) — el backend devuelve `{success,data:[...],meta}`:
          // `total` es `meta.total` (45), NO el largo de la página (20), o
          // un "cargar más" gateado en `total>loaded` nunca renderiza.
          productsResult = responseData;
          total = response.meta?.total ?? productsResult.length;
          currentPage = response.meta?.page ?? safePage;
          limitNum = response.meta?.limit ?? safePageSize;
        } else if (responseData && Array.isArray(responseData.data)) {
          // Format { data: [...], pagination: {...} } or { data: [...], meta: {...} }
          productsResult = responseData.data;
          const pagination =
            responseData.pagination || responseData.meta || response.meta || {};
          total = pagination.total || productsResult.length;
          currentPage = pagination.page || safePage;
          limitNum = pagination.limit || safePageSize;
        } else if (responseData) {
          // Fallback if data is directly in response.data but success check passed
          productsResult = Array.isArray(responseData) ? responseData : [];
          total =
            response.meta?.total || response.total || productsResult.length;
          currentPage = response.meta?.page || response.page || safePage;
          limitNum = response.meta?.limit || response.limit || safePageSize;
        }

        const totalPages = Math.ceil(total / limitNum);
        const transformedProducts = this.transformProducts(productsResult);

        return {
          products: transformedProducts,
          total,
          page: currentPage,
          pageSize: limitNum,
          totalPages,
          searchMeta: this.extractSearchMeta(response),
        };
      }),
      catchError((error: unknown) => {
        console.error('PosProductService Error:', error);
        // E.1 review fix — `HttpErrorResponse` TAMBIÉN tiene `message`+`status`
        // y el guard de abajo lo dejaba pasar crudo ("Http failure response
        // for https://..." ante el cajero). El transporte SIEMPRE se mapea;
        // el guard solo deja pasar lo que el `map` anterior ya estructuró.
        if (error instanceof HttpErrorResponse) {
          return throwError(() => this.errorFromHttp(error));
        }
        if (isPosProductsLoadError(error)) {
          return throwError(() => error);
        }
        return throwError(() => this.errorFromHttp(error));
      }),
    );
  }

  /**
   * E.1 (ADR-08) — extrae `meta.search` validando forma. Null ante payloads
   * legacy/cacheados sin el contrato o con valores desconocidos.
   */
  private extractSearchMeta(response: unknown): SearchRankMeta | null {
    if (typeof response !== 'object' || response === null) return null;
    const search = (response as { meta?: { search?: unknown } }).meta?.search;
    if (typeof search !== 'object' || search === null) return null;
    const candidate = search as Partial<SearchRankMeta>;
    const rankModes: SearchRankMeta['rank_mode'][] = [
      'ranked',
      'unranked_scan_cap',
      'unranked_error',
      'legacy',
    ];
    const layers: SearchRankMeta['layer'][] = [
      'legacy',
      'l1',
      'l2',
      'trigram',
    ];
    if (
      !rankModes.includes(candidate.rank_mode as SearchRankMeta['rank_mode']) ||
      !layers.includes(candidate.layer as SearchRankMeta['layer'])
    ) {
      return null;
    }
    return {
      rank_mode: candidate.rank_mode as SearchRankMeta['rank_mode'],
      layer: candidate.layer as SearchRankMeta['layer'],
      degraded: candidate.degraded === true,
    };
  }

  /**
   * E.4 (F-069) — registra la selección del cajero para CTR-por-posición.
   * Fire-and-forget: traga cualquier error (hash o red) porque telemetría
   * jamás debe romper una venta. La query cruda nunca sale del navegador.
   */
  logSearchSelection(input: SearchSelectionInput): Observable<unknown> {
    return from(hashSearchQuery(input.query)).pipe(
      switchMap((query_hash) =>
        this.http.post(`${this.apiUrl}/search-selections`, {
          query_hash,
          position: input.position,
          product_id: input.product_id,
          result_count: input.result_count,
          rank_mode: input.rank_mode,
          flags: input.layer ? { layer: input.layer } : undefined,
          surface: input.surface ?? 'pos_web',
        }),
      ),
      catchError(() => of(null)),
    );
  }

  /**
   * E.1 (F-036/F-065) — convierte un envelope `success:false` (HTTP 200 con
   * el fallo en el body: ERR-06/ERR-12) a error estructurado con causa.
   */
  private errorFromEnvelope(response: unknown): PosProductsLoadError {
    const body =
      (typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {}) ?? {};
    const message =
      typeof body['message'] === 'string' && body['message'].length > 0
        ? body['message']
        : 'Error al cargar productos';
    const code =
      typeof body['error_code'] === 'string' ? body['error_code'] : undefined;
    const status =
      typeof body['statusCode'] === 'number' ? body['statusCode'] : 200;
    return code ? { message, status, code } : { message, status };
  }

  /**
   * E.1 (F-065) — mapea un fallo HTTP/transporte a error estructurado con
   * mensaje por causa. El componente decide superficie (banner vs toast).
   */
  private errorFromHttp(error: unknown): PosProductsLoadError {
    const asRecord =
      typeof error === 'object' && error !== null
        ? (error as Record<string, unknown>)
        : {};
    const status = typeof asRecord['status'] === 'number' ? asRecord['status'] : 0;
    const nested =
      typeof asRecord['error'] === 'object' && asRecord['error'] !== null
        ? (asRecord['error'] as Record<string, unknown>)
        : {};
    // E.1 review fix (vendix-error-handling) — el copy backend sale SIEMPRE
    // de `parseApiError` (canned por error_code o default seguro), jamás del
    // `message` crudo: un 429 sin código llegaba al banner como
    // "Http failure response for https://..." (URL interna + jerga en inglés
    // ante el cajero). Sin error_code, manda la tabla por causa de abajo.
    const parsed = parseApiError(error);
    const backendMessage = parsed.errorCode ? parsed.userMessage : null;
    const code =
      typeof nested['error_code'] === 'string'
        ? nested['error_code']
        : undefined;

    let message: string;
    if (backendMessage) {
      message = backendMessage;
    } else if (status === 0) {
      message = 'Sin conexión. Revisa tu red e intenta de nuevo.';
    } else if (status === 400) {
      message = 'Datos inválidos proporcionados';
    } else if (status === 401) {
      message = 'Tu sesión venció. Vuelve a iniciar sesión.';
    } else if (status === 403) {
      message = 'Permisos insuficientes';
    } else if (status === 404) {
      message = 'Producto no encontrado';
    } else if (status === 429) {
      message = 'Demasiadas solicitudes. Espera unos segundos e intenta de nuevo.';
    } else if (status >= 500) {
      message = 'Error del servidor. Por favor intenta más tarde';
    } else {
      message = 'Error al cargar productos';
    }
    // Cinturón: aunque cambie parseApiError, boilerplate de transporte o URLs
    // jamás llegan al cajero.
    if (/^Http failure/i.test(message) || /https?:\/\//.test(message)) {
      message = 'Error al cargar productos';
    }
    return code ? { message, status, code } : { message, status };
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
          final_price:
            v.final_price != null ? Number(v.final_price) : null,
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
        // F-221 — no fabricar `final_price`: el `||` convertía la ausencia en
        // el NETO (`base_price`) y lo declaraba como BRUTO editado (-19 %).
        // Si el payload no lo trae, la clave queda ausente y el catálogo manda
        // (`resolveCatalogFinalUnitPrice` en el carrito, `catalogFinalPrice`
        // en el backend).
        ...(product.final_price != null && Number(product.final_price) > 0
          ? { final_price: Number(product.final_price) }
          : {}),
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
        // QUI-431 — surfaced so the POS opens the serial-selection modal for
        // serialized products before adding them to the cart.
        requires_serial_numbers: product.requires_serial_numbers === true,
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
        // Multi-tarifa (Phase 5). Packaging is tier-owned and resolved per
        // cart line — no product-level units_per_package mapping here.
        has_multiple_price_tiers: product.has_multiple_price_tiers === true,
        enabled_price_tier_ids: Array.isArray(product.enabled_price_tier_ids)
          ? product.enabled_price_tier_ids
              .map((id: unknown) => Number(id))
              .filter((id: number) => Number.isFinite(id))
          : [],
        // QUI-648. Se copian SOLO si el endpoint los trajo: dejar la clave
        // ausente es lo que distingue "no vino en el payload" de "por pieza",
        // y de eso depende que el POS no dispare una consulta de detalle por
        // cada producto que el cajero toca.
        ...(product.stock_uom_id !== undefined && {
          stock_uom_id: product.stock_uom_id ?? null,
        }),
        ...(product.price_unit_quantity !== undefined && {
          price_unit_quantity: Number(product.price_unit_quantity ?? 1) || 1,
        }),
        ...(product.sale_config_summary !== undefined && {
          sale_config_summary: product.sale_config_summary ?? null,
        }),
        ...(product.scanned_price_tier_id !== undefined && {
          scanned_price_tier_id: product.scanned_price_tier_id ?? null,
        }),
        // Campos de servicio y reserva
        product_type: product.product_type || 'physical',
        requires_booking: product.requires_booking === true,
        booking_mode: product.booking_mode || null,
        is_eligible_for_home_service: product.is_eligible_for_home_service === true,
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
    console.error('PosProductService Error:', error);

    // Mensajes de error más descriptivos
    let errorMessage = 'Ocurrió un error';

    // El backend envía `error_code` (VendixHttpException). Si lo conocemos,
    // usamos el mensaje curado en español del catálogo compartido — así el
    // texto que recibe la UI (modal de requisitos o toast) explica el
    // escenario concreto aunque este handler aplane el error a string y
    // pierda el código. Misma cadena de fallbacks que `products.service.ts:715`
    // para que las dos superficies digan lo mismo ante el mismo error.
    const backendCode: string | undefined =
      error?.error?.error_code ?? error?.error_code;

    if (backendCode && PRODUCT_SAVE_ERROR_MAP[backendCode]) {
      errorMessage = PRODUCT_SAVE_ERROR_MAP[backendCode].reason;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    } else if (error.status === 400) {
      errorMessage = 'Datos inválidos proporcionados';
    } else if (error.status === 401) {
      errorMessage = 'Acceso no autorizado';
    } else if (error.status === 403) {
      errorMessage = 'Permisos insuficientes';
    } else if (error.status === 404) {
      errorMessage = 'Producto no encontrado';
    } else if (error.status === 409) {
      errorMessage = 'Ya existe un producto con este SKU o slug';
    } else if (error.status >= 500) {
      errorMessage = 'Error del servidor. Por favor intenta más tarde';
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
    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => this.firstTransformedProduct(response)),
      catchError((error: any) => {
        return of(null);
      }),
    );
  }

  getProductBySku(sku: string): Observable<Product | null> {
    const params = new HttpParams().set('sku', sku);
    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => this.firstTransformedProduct(response)),
      catchError((error: any) => {
        return of(null);
      }),
    );
  }

  /**
   * Desempaqueta el envelope estándar (`{ success, data, meta }`) o un payload
   * plano, transforma con `transformProducts` (para que el producto traiga la
   * forma que consume el POS: precios, variantes mapeadas, stock) y devuelve el
   * primero. Devuelve `null` si la respuesta no trae productos.
   *
   * Nota: la búsqueda por `barcode`/`sku` viaja en `response.data`, no en
   * `response.products`; leer la clave equivocada hacía que el POS reportara
   * "Producto no encontrado" aunque la API sí lo devolviera.
   */
  private firstTransformedProduct(response: any): Product | null {
    const dataRoot = response?.success ? response.data : response;
    const list = Array.isArray(dataRoot)
      ? dataRoot
      : Array.isArray(dataRoot?.data)
        ? dataRoot.data
        : [];
    if (list.length === 0) return null;
    return (this.transformProducts(list)[0] as Product) ?? null;
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
          searchMeta: this.extractSearchMeta(response),
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
