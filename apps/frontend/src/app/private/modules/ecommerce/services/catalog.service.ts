import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

/**
 * Promotional descriptor returned by the catalog endpoints for product
 * cards. Mirrors backend `ActiveProductPromotion`. The card uses
 * `promotional_price` + `badge_label` for the visual discount; the real
 * discount is recomputed in backend at checkout.
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
  /**
   * True when the promotion is a quantity-tiered rule. In this case there is
   * no instant single-unit discount (`promotional_price === unit price`), so
   * the card must show only the informative badge (e.g. "Desde 3 und:
   * descuento") without a struck-through / discounted price.
   */
  is_quantity_tiered?: boolean;
  /** Minimum discount preview across the tier ladder (informative only). */
  preview_min_discount?: number;
  /**
   * Ladder of quantity-tiered discount steps. Emitted by the backend (Phase
   * A.1) when the promotion is quantity-tiered (`is_quantity_tiered=true`).
   * Each entry defines the discount applied when `quantity` is between
   * `min_quantity` and `max_quantity` (inclusive lower, exclusive upper; null
   * `max_quantity` = open-ended). `value` is in the unit defined by `type`
   * (percentage points or fixed amount in cents).
   *
   * Used by `<app-promotion-stack mode="expanded-cards">` to render the
   * full tier ladder on the product detail page, so the buyer can see what
   * each step unlocks as they increase the quantity.
   */
  quantity_tiers?: Array<{
    min_quantity: number;
    max_quantity: number | null;
    type: 'percentage' | 'fixed_amount';
    value: number;
    sort_order: number;
  }>;
}

/**
 * Store-wide active auto promotion returned by the public
 * `GET /ecommerce/promotions/active` endpoint. The backend only returns
 * currently-active automatic promotions for the tenant resolved from the
 * public domain context, and `badge_label` arrives already formatted
 * (tiered: "Desde N und: -X% / -$Y"; flat: "-X% OFF" / "-$Y OFF"), so the
 * storefront renders it verbatim without recomputing anything.
 */
export interface ActiveStorePromotion {
  id: number;
  name: string;
  rule_type: string;
  scope: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  badge_label: string;
  min_purchase_amount: number | null;
  /**
   * Frase lista para pintar con beneficio + alcance ("20% OFF en toda tu
   * compra", "Desde 3 und: -10% en este producto"). La compone el backend
   * (`EcommercePromotionsService.buildPromotionTypeLabel`) y está
   * garantizada no vacía; el banner del catálogo la usa verbatim con
   * fallback a `badge_label` para payloads que aún no la traigan.
   */
  promotion_type_label?: string;
  /**
   * Optional quantity-tier ladder. Mirrors the same shape used by
   * `ActiveProductPromotion.quantity_tiers` and lets the storefront render
   * the `<app-promotion-stack mode="expanded-cards">` ladder for store-wide
   * automatic promotions when the public endpoint decides to expose them.
   */
  quantity_tiers?: Array<{
    min_quantity: number;
    max_quantity: number | null;
    type: 'percentage' | 'fixed_amount';
    value: number;
    sort_order: number;
  }>;
}

/**
 * Una presentación de venta ofrecida al comprador (`price_tiers.kind='sale_unit'`):
 * "Bulto 50kg", "Rollo 100m", "Kilo suelto".
 *
 * REGLA DE DINERO (no negociable): `price` es el precio del PAQUETE COMPLETO,
 * ya resuelto por el backend en la MISMA base que `final_price` (con impuesto
 * incluido). La cantidad de una línea cuenta PAQUETES, de modo que el total es
 * `price * quantity`. NUNCA se multiplica dinero por `units_per_package`: el
 * packSize solo sirve para stock, peso de envío y el texto informativo
 * ("= 100 u."). Multiplicarlo por el precio inflaría el cobro por el tamaño
 * del empaque, que es exactamente el bug que este contrato previene.
 */
export interface SaleUnitOption {
  /**
   * `null` es la UNIDAD SUELTA del producto: la línea sin tarifa, cobrada al
   * precio base. Es una opción de pleno derecho —el backend la publica de
   * primera, igual que el POS abre su menú con "Default (sin tarifa)"— y se usa
   * como clave de selección igual que cualquier otro chip. Enviar `null` al
   * carrito es exactamente omitir `price_tier_id`.
   */
  price_tier_id: number | null;
  /** Etiqueta lista para pintar, p.ej. "Bulto 50kg" o "Unidad". */
  name: string;
  /** packSize efectivo: el backend ya aplicó la cascada override ?? tier ?? 1. */
  units_per_package: number | null;
  /** Precio del PAQUETE entero (ver regla de dinero arriba). */
  price: number;
  compare_at_price: number | null;
  /** Paquetes disponibles. `null` = el producto no rastrea inventario. */
  available_packages: number | null;
  is_default: boolean;
  is_available: boolean;
}

export interface EcommerceProduct {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  base_price: number;
  sale_price?: number;
  is_on_sale?: boolean;
  is_featured?: boolean;
  active_promotion?: ActiveProductPromotion | null;
  sku: string | null;
  stock_quantity: number | null;
  track_inventory?: boolean;
  available_stock: number | null;
  is_available: boolean;
  final_price: number;
  image_url: string | null;
  weight?: number | null;
  pricing_type?: 'unit' | 'weight';
  product_type?: 'physical' | 'service';
  service_duration_minutes?: number | null;
  service_modality?: 'in_person' | 'virtual' | 'hybrid' | null;
  requires_booking?: boolean;
  booking_mode?: 'provider_required' | 'free_booking';
  brand: { id: number; name: string } | null;
  categories: { id: number; name: string; slug: string }[];
  variant_count?: number;
  variants?: ProductVariantDetail[];
  /**
   * Menu (carta) availability for restaurant dishes. A product NOT tied to a
   * menu schedule arrives with `is_available_now: true`. Optional for
   * robustness against an older backend / cached payload — consumers MUST
   * treat `undefined` as available and gate only on an explicit `=== false`.
   */
  is_available_now?: boolean;
  next_available?: MenuNextAvailable | null;
  /**
   * Escala en la que se publica el precio cuando el producto se mide en una
   * unidad fina: `label` viene listo para pintar ("por m"). `null` = precio por
   * unidad, que es el catálogo histórico.
   */
  price_unit?: {
    quantity: number;
    stock_unit_code: string | null;
    reference_unit_code: string | null;
    label: string;
  } | null;
  /**
   * Presentación de venta por defecto del producto. El backend YA la devuelve
   * hoy; simplemente no estaba declarada, así que los consumidores la leían
   * como `any` o la ignoraban. Declararla es puro saneo de contrato.
   */
  sale_unit?: {
    price_tier_id: number;
    name: string;
    units_per_package: number | null;
  } | null;
  /**
   * Nº de presentaciones ofrecidas (LISTADO). `> 1` significa que el comprador
   * debe ELEGIR, así que la card no puede añadir a ciegas: manda al detalle.
   * Mismo criterio que `variant_count`.
   */
  sale_unit_count?: number;
  /**
   * Precio de la presentación más barata, para pintar el "desde $X" en la card
   * cuando hay varias (LISTADO). `final_price` sigue siendo el de la
   * presentación por defecto.
   */
  price_from?: number | null;
  /**
   * Precio de la UNIDAD SUELTA (la opción sin tarifa). `null`/ausente cuando el
   * producto no la ofrece o el selector está apagado, y en ese caso el precio
   * de una línea sin tarifa vuelve a ser `final_price`.
   *
   * Existe porque el LISTADO no publica `available_sale_units` y el carrito
   * invitado necesita cotizar una línea sin presentación sin pedir el detalle.
   */
  loose_unit_price?: number | null;
  /**
   * Stock expresado en unidades MÍNIMAS. Se separa porque, con multi-tarifa,
   * `available_stock` pasa a estar en PAQUETES de la presentación por defecto:
   * mezclar ambas escalas en un mismo campo produce agotados fantasma.
   */
  available_stock_units?: number;
}

export interface ProductVariantDetail {
  id: number;
  name: string;
  sku: string;
  price_override: number | null;
  effective_base_price: number;
  final_price: number;
  stock_quantity: number;
  available_stock: number | null;
  is_available: boolean;
  track_inventory_override?: boolean | null;
  effective_track_inventory: boolean;
  attributes: any;
  image_url: string | null;
  is_on_sale: boolean;
  sale_price: number | null;
}

export interface ProductDetail extends EcommerceProduct {
  images: { id: number; image_url: string; is_main: boolean }[];
  variants: ProductVariantDetail[];
  reviews: {
    id: number;
    rating: number;
    comment: string;
    created_at: string;
    user_name: string;
  }[];
  avg_rating: number;
  review_count: number;
  booking_mode?: 'provider_required' | 'free_booking';
  /**
   * Presentaciones de venta ofrecidas en el detalle. `[]` o un solo elemento
   * significa que NO hay nada que elegir y el selector no debe renderizarse
   * (evita añadir una decisión al comprador donde no existe alternativa).
   */
  available_sale_units?: SaleUnitOption[];
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  is_featured?: boolean;
}

export interface Brand {
  id: number;
  name: string;
  slug?: string;
  logo_url: string | null;
  is_featured?: boolean;
}

export interface CatalogQuery {
  search?: string;
  ids?: string;
  category_id?: number;
  category_ids?: string;
  brand_id?: number;
  brand_ids?: string;
  min_price?: number;
  max_price?: number;
  sort_by?:
    | 'name'
    | 'price_asc'
    | 'price_desc'
    | 'newest'
    | 'oldest'
    | 'best_selling';
  page?: number;
  limit?: number;
  created_after?: string;
  has_discount?: boolean;
  is_featured?: boolean;
  fill?: boolean;
  product_type?: 'physical' | 'service';
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

/**
 * Restaurant menus (cartas) public payload. Mirrors backend
 * `CatalogService.getPublicMenus`. Cartas are independent from the general
 * catalog: each level (menu/section/item) carries `is_available_now` +
 * `next_available` so the storefront can either hide off-schedule dishes or
 * show a "Disponible a las HH:mm" badge per the store setting.
 */
export interface MenuAvailabilityWindow {
  id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active_now: boolean;
}

export interface MenuNextAvailable {
  day_of_week: number;
  start_time: string;
}

/**
 * Formats a `MenuNextAvailable` into a short label like "Vie 08:00" (día
 * abreviado + hora), or "pronto" when null. Shared by the product card,
 * product detail, and quick-view so the off-schedule badge reads identically
 * to the menus showcase `formatNext`.
 */
export function formatMenuNextAvailable(next: MenuNextAvailable | null): string {
  if (!next) return 'pronto';
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const day = days[next.day_of_week] ?? '';
  return `${day} ${next.start_time}`.trim();
}

export interface MenuItemProduct {
  id: number;
  name: string;
  slug: string;
  base_price: number;
  sale_price: number | null;
  is_on_sale: boolean;
  is_combo: boolean;
  /** True when the product has sellable variants; the cart rejects a
   * variant product without `product_variant_id`, so the carta must route
   * these to the detail page ("Ver opciones") instead of adding directly. */
  has_variants: boolean;
  variant_count: number;
  image_url: string | null;
}

export interface MenuItem {
  id: number;
  product_id: number;
  sort_order: number;
  is_available_now: boolean;
  /** F1/F2/F3 — Plato "agotado" (visible pero NO comprable). El backend lo
   * deriva de `!products.is_sellable` y lo expone en el payload público de
   * cartas. Cuando es `true`, el card se muestra con estilo off, badge
   * "Agotado" (prioridad sobre el badge de horario) y sin botón quick-add. */
  is_sold_out?: boolean;
  next_available: MenuNextAvailable | null;
  product: MenuItemProduct | null;
}

export interface MenuSection {
  id: number;
  name: string;
  sort_order: number;
  is_available_now: boolean;
  next_available: MenuNextAvailable | null;
  availability_windows: MenuAvailabilityWindow[];
  items: MenuItem[];
}

export interface PublicMenu {
  id: number;
  name: string;
  is_active: boolean;
  is_available_now: boolean;
  next_available: MenuNextAvailable | null;
  availability_windows: MenuAvailabilityWindow[];
  sections: MenuSection[];
}

export interface PublicMenusResponse {
  store_timezone: string;
  now: { day_of_week: number; minutes: number };
  menus: PublicMenu[];
}

@Injectable({
  providedIn: 'root',
})
export class CatalogService {
  private api_url = `${environment.apiUrl}/ecommerce/catalog`;
  private promotions_api_url = `${environment.apiUrl}/ecommerce/promotions`;

  constructor(
    private http: HttpClient,
    private domain_service: TenantFacade,
  ) {}

  private getHeaders(): HttpHeaders {
    const domainConfig = this.domain_service.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  getProducts(
    query: CatalogQuery = {},
  ): Observable<PaginatedResponse<EcommerceProduct>> {
    let params = new HttpParams();

    if (query.search) params = params.set('search', query.search);
    if (query.ids) params = params.set('ids', query.ids);
    if (query.category_id)
      params = params.set('category_id', query.category_id.toString());
    if (query.category_ids)
      params = params.set('category_ids', query.category_ids);
    if (query.brand_id)
      params = params.set('brand_id', query.brand_id.toString());
    if (query.brand_ids) params = params.set('brand_ids', query.brand_ids);
    if (query.min_price)
      params = params.set('min_price', query.min_price.toString());
    if (query.max_price)
      params = params.set('max_price', query.max_price.toString());
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.created_after)
      params = params.set('created_after', query.created_after);
    if (query.has_discount !== undefined)
      params = params.set('has_discount', query.has_discount.toString());
    if (query.is_featured !== undefined)
      params = params.set('is_featured', query.is_featured.toString());
    if (query.fill !== undefined) {
      params = params.set('fill', query.fill.toString());
    }
    if (query.product_type)
      params = params.set('product_type', query.product_type);

    return this.http.get<PaginatedResponse<EcommerceProduct>>(this.api_url, {
      headers: this.getHeaders(),
      params,
    });
  }

  getProductBySlug(
    slug: string,
  ): Observable<{ success: boolean; data: ProductDetail }> {
    return this.http.get<{ success: boolean; data: ProductDetail }>(
      `${this.api_url}/${slug}`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  getCategories(): Observable<{ success: boolean; data: Category[] }> {
    return this.http.get<{ success: boolean; data: Category[] }>(
      `${this.api_url}/categories`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  getBrands(): Observable<{ success: boolean; data: Brand[] }> {
    return this.http.get<{ success: boolean; data: Brand[] }>(
      `${this.api_url}/brands`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  getPublicConfig(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.api_url}/config/public`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  /**
   * Store-wide active auto promotions for the public storefront. Isolated by
   * the resolved public domain (tenant) via `x-store-id`. Returns an empty
   * list when there are no active automatic promotions; the home only renders
   * the "Promociones activas" section when its `home_sections.promotions`
   * toggle is enabled AND the list is non-empty.
   */
  getActivePromotions(): Observable<{
    success: boolean;
    data: ActiveStorePromotion[];
  }> {
    return this.http.get<{ success: boolean; data: ActiveStorePromotion[] }>(
      `${this.promotions_api_url}/active`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  /**
   * Restaurant menus (cartas) with per-level availability. Returns empty
   * `menus` when the store is not a restaurant; the storefront only renders
   * the section when the `home_sections.menus` toggle is enabled.
   */
  getMenus(): Observable<{ success: boolean; data: PublicMenusResponse }> {
    return this.http.get<{ success: boolean; data: PublicMenusResponse }>(
      `${this.api_url}/menus`,
      {
        headers: this.getHeaders(),
      },
    );
  }
}
