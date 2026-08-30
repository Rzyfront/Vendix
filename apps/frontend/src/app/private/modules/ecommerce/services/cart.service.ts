import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import {
  CatalogService,
  EcommerceProduct,
  SaleUnitOption,
} from './catalog.service';
import { cartLineKey } from '../utils/cart-line-key.util';
import { TableContextService } from './table-context.service';
import { environment } from '../../../../../environments/environment';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { PriceResolverService } from '../../../../shared/services/pricing';
import { StoreAvailabilityService } from '../../../../core/services/store-availability.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../core/utils/parse-api-error';

export interface CartItem {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  /**
   * Identidad de la línea: `producto:variante:tarifa` (ver `cartLineKey`).
   *
   * Es lo que la UI debe usar en `@for (... ; track ...)` y para marcar qué
   * línea está ocupada. `id` NO sirve: en el carrito invitado vale
   * `product_id`, así que dos presentaciones del mismo producto colisionan y
   * Angular lanza NG0955 ("duplicate keys") además de repintar la fila
   * equivocada.
   *
   * Opcional en el tipo por compatibilidad con cualquier payload construido
   * fuera del servicio; `CartService` SIEMPRE lo rellena vía `normalizeCart`.
   */
  line_key?: string;
  // Bug 8: presentación comercial (Caja 12und, Bulto 50kg). Presente
  // cuando el producto tiene has_multiple_price_tiers y el cliente eligió
  // una tier de tipo 'sale_unit'. El render del cart muestra label +
  // cantidad incluida + precio de la presentación, no "1 × precio base".
  price_tier?: {
    id: number;
    label: string;
    units_per_package: number;
    presentation_price: number;
  } | null;
  product: {
    name: string;
    slug: string;
    sku: string;
    image_url: string | null;
    final_price: number;
    weight?: number;
    product_type?: 'physical' | 'service';
    requires_booking?: boolean;
    service_duration_minutes?: number;
    booking_mode?: 'provider_required' | 'free_booking';
  };
  variant: {
    name: string;
    sku: string;
    attributes: any;
  } | null;
}

export interface AppliedPromotion {
  promotion_id: number;
  name: string;
  discount_amount: number;
  /**
   * Discount type of the applied promotion. Optional because the current cart
   * summary endpoint only surfaces `{ promotion_id, name, discount_amount }`.
   * When the backend forwards it, the UI shows a precise type badge; otherwise
   * it falls back to a generic "Promoción" badge.
   */
  type?: 'percentage' | 'fixed_amount';
  scope?: 'order' | 'product' | 'category';
  /**
   * Backend-defined promotion priority that determined this promo as the
   * winner. With the winner-takes-all engine, an order has at most one
   * applied promotion; this field is for the operator audit trail.
   */
  priority?: number;
  /**
   * `product_id`s that actually unlocked the discount under
   * `quantity_grouping='per_product'`. Empty array for `cart_total` (legacy)
   * promos — the frontend uses this to render "en: Producto X, Producto Y"
   * next to the applied promotion name and avoid mixing references when
   * the cart has multiple SKUs sharing the same promo.
   *
   * Optional for back-compat with older backend versions that predate the
   * Phase 2d per_product grouping rollout.
   */
  target_product_ids?: number[];
  /**
   * Etiquetas de los productos o categorías a los que se aplicó el descuento.
   * Vacío para `scope: 'order'` (todo el carrito). El backend lo calcula desde
   * `applicable_item_ids` del engine.
   *
   * QUI-515: se CONSERVA junto a `target_product_ids`, no lo reemplaza. Los dos
   * responden preguntas distintas: `target_product_ids` dice qué SKU desbloqueó
   * una promo `per_product`, y este campo dice a qué líneas se aplicó el
   * descuento. Para una promo `cart_total` de scope producto/categoría el
   * primero viene vacío y este es el único que puede decirle al cliente sobre
   * qué se le aplicó el descuento.
   */
  applicable_descriptions?: Array<{
    label: string;
    kind: 'product' | 'category';
  }>;
}

/**
 * Progress toward the next tier of a `quantity_tiered` promotion, surfaced by
 * `POST /ecommerce/cart/summary`. `benefit_value` is RAW (unformatted); the
 * presentational component (`app-cart-promotions`) formats it. Mirrors the POS
 * tier-progress nudge for POS↔ecommerce parity.
 */
export interface CartTierProgress {
  promotion_id: number;
  name: string;
  remaining_quantity: number;
  benefit_type: 'percentage' | 'fixed_amount';
  benefit_value: number;
  /**
   * `product_id` of the cart line(s) closest to qualifying for the next
   * tier. Populated when the promotion uses `quantity_grouping='per_product'`
   * (so the customer knows exactly which SKU needs more units); null for
   * `cart_total` (the scope crosses products — the banner says "Agrega N
   * und más" without naming a single SKU).
   *
   * Optional for back-compat with older backend versions.
   */
  target_product_id?: number | null;
}

/**
 * Promotional payload returned by the stateless `POST /ecommerce/cart/summary`
 * endpoint (used for both guest and authenticated carts).
 */
export interface CartSummaryData {
  promotion_discount?: number;
  promotional_subtotal?: number;
  applied_promotions?: AppliedPromotion[];
  tier_progress?: CartTierProgress[];
  per_product_tier_ladder?: Array<{
    promotion_id: number;
    target_product_id: number;
    tiers: Array<{
      min_quantity: number;
      max_quantity: number | null;
      type: 'percentage' | 'fixed_amount';
      value: number;
      sort_order: number;
    }>;
    current_tier_index: number | null;
  }>;
  /**
   * CP-ECOM-PROMO-UX-001 convergence-R5: same degraded-state signal as
   * `Cart.promotions_load_state`. Surfaced here so the cart enrichment
   * path can propagate it without re-deriving the failure shape.
   */
  promotions_load_state?: 'ok' | 'degraded';
}

export interface Cart {
  id: number;
  currency: string;
  subtotal: number;
  item_count: number;
  items: CartItem[];
  /** Total promotional discount applied to the cart (0 when none). */
  promotion_discount?: number;
  /** Subtotal after applying promotional discounts. */
  promotional_subtotal?: number;
  /** Per-promotion breakdown of the applied discounts. */
  applied_promotions?: AppliedPromotion[];
  /**
   * Progress toward the next tier of active `quantity_tiered` promotions.
   * Powers the "next tier" nudge shown in cart dropdown / page / checkout.
   */
  tier_progress?: CartTierProgress[];
  /**
   * Per-product tier ladder for `quantity_tiered` promotions that target a
   * specific product (`quantity_grouping='per_product'`). Surfaces the full
   * tier breakdown so the UI can render progress and next-tier nudges that
   * name the SKU the customer needs to add. Optional for back-compat with
   * older backend versions that predate the Phase A.2 ladder payload.
   */
  per_product_tier_ladder?: Array<{
    promotion_id: number;
    target_product_id: number;
    tiers: Array<{
      min_quantity: number;
      max_quantity: number | null;
      type: 'percentage' | 'fixed_amount';
      value: number;
      sort_order: number;
    }>;
    current_tier_index: number | null;
  }>;
  /**
   * CP-ECOM-PROMO-UX-001 convergence-R5: visibility of the promotions load.
   * `ok` (default) means the backend built the summary successfully;
   * `degraded` means every retry exhausted and the customer is looking at
   * the cart without the automatic promo discount. Surfaced as a yellow
   * banner by `<app-cart-promotions>` so the failure is no longer silent.
   */
  promotions_load_state?: 'ok' | 'degraded';
}

/**
 * Línea del carrito invitado en localStorage — **esquema v2**.
 *
 * Los campos de presentación de venta (multitarifa) se añaden TODOS como
 * opcionales a propósito: así un registro v1 escrito por una pestaña vieja
 * ES un v2 válido, y no hace falta ni versionar la clave de storage ni
 * escribir un migrador. Un migrador que "limpiara" lo desconocido vaciaría
 * carritos vivos de compradores reales por un cambio puramente aditivo, que
 * es exactamente el riesgo que este diseño elimina.
 *
 * REGLA DE DINERO: `sale_unit_price` es el precio del PAQUETE ENTERO
 * (impuesto incluido, resuelto por el backend) y `quantity` cuenta PAQUETES.
 * `sale_unit_units_per_package` NUNCA multiplica dinero: sólo sirve para el
 * texto informativo "= 100 u.", el stock y el peso de envío.
 */
interface LocalCartItem {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  // Cached variant info for display
  variant_name?: string;
  variant_sku?: string;
  variant_price?: number;
  // ── v2: presentación de venta elegida (price_tiers.kind='sale_unit') ──
  /** `price_tiers.id` de la presentación elegida. */
  price_tier_id?: number;
  /** Etiqueta de la presentación ("Rollo 20 m"), para pintar sin re-consultar. */
  sale_unit_name?: string;
  /** packSize efectivo. Sólo informativo/stock — jamás multiplica dinero. */
  sale_unit_units_per_package?: number;
  /** Precio del PAQUETE ENTERO. */
  sale_unit_price?: number;
}

interface StoredLocalCart {
  items: LocalCartItem[];
  updated_at: string;
}

/**
 * Opciones de `addProduct` / `addToCart`.
 *
 * Existe porque la firma posicional original (`id, qty, variantId,
 * variantInfo`) no tenía hueco para la tarifa, y un quinto posicional
 * (`addProduct(id, q, undefined, undefined, tier)`) es ilegible en el punto
 * de llamada. Las sobrecargas mantienen la forma posicional viva, así que
 * NINGÚN call site existente necesitó cambiar.
 */
export interface AddProductOptions {
  /** Variante elegida (`product_variants.id`). */
  variantId?: number;
  /** Snapshot de la variante para pintar el carrito invitado. */
  variantInfo?: { name: string; sku: string; price: number };
  /** Presentación de venta elegida (`price_tiers.id`). */
  priceTierId?: number;
  /**
   * Snapshot de la presentación para el carrito invitado. `price` es el
   * precio del PAQUETE ENTERO (ver regla de dinero en `LocalCartItem`).
   */
  saleUnitInfo?: {
    name: string;
    units_per_package: number | null;
    price: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class CartService {
  private api_url = `${environment.apiUrl}/ecommerce/cart`;
  private local_storage_key = 'vendix_cart';

  // Estado del carrito como signal (zoneless-friendly).
  readonly cart = signal<Cart | null>(null);
  // Adaptador observable para consumidores legacy (cart$).
  readonly cart$ = toObservable(this.cart);

  // Evento pub/sub de "item agregado" — Subject legitimo (skill: event bus local).
  private readonly item_added_subject = new Subject<void>();
  readonly itemAdded$ = this.item_added_subject.asObservable();

  private is_authenticated = false;
  private readonly destroy_ref = inject(DestroyRef);
  // Public storefront availability — used to re-surface the "store unavailable"
  // banner when a customer tries to add to cart while the store is closed.
  private readonly store_availability = inject(StoreAvailabilityService);
  // QR dine-in (D1/D3): single source of truth for mesa state. Injected here so
  // `addProduct` can route the call to `addOrder` (table tab) instead of the
  // ecommerce cart when the diner is in an `open_tab` session.
  private readonly tableContext = inject(TableContextService);
  // Shared toast service — used by `addProduct` for mesa success/error and for
  // the "Sal de la mesa" warning in reserved `isActive && !isOpenTab` modes.
  private readonly toastService = inject(ToastService);
  /**
   * Monotonic token guaranteeing last-response-wins for the central
   * promotional enrichment: a slow summary from a superseded cart state can
   * never clobber a newer one (dedupe requirement).
   */
  private summary_seq = 0;

  constructor(
    private http: HttpClient,
    private domain_service: TenantFacade,
    private catalog_service: CatalogService,
    private auth_facade: AuthFacade,
    private currencyFormatService: CurrencyFormatService,
    private priceResolver: PriceResolverService,
  ) {
    this.initializeCart();
  }

  private initializeCart() {
    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((isAuthenticated) => {
        this.is_authenticated = isAuthenticated;

        if (isAuthenticated) {
          const localItems = this.getLocalCart();
          if (localItems.length > 0) {
            this.syncFromLocalStorage().subscribe();
          } else {
            this.getCart().subscribe();
          }
        } else {
          this.loadLocalCart();
        }
      });
  }

  private getHeaders(): HttpHeaders {
    const domainConfig = this.domain_service.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  // Local storage methods for guest cart
  private loadLocalCart(): void {
    const items = this.getLocalCart();
    if (items.length > 0) {
      try {
        if (items.length === 0) {
          this.emitEmptyCart();
          return;
        }

        const productIds = [...new Set(items.map((i) => i.product_id))];
        this.catalog_service
          .getProducts({ ids: productIds.join(','), limit: 100 })
          .subscribe({
            next: (response) => {
              const products: EcommerceProduct[] = response.data;

              // Auto-sanación: una tarifa guardada puede haber desaparecido o
              // haberse marcado no disponible mientras el carrito dormía en
              // localStorage. Se repara ANTES de construir las líneas, y sólo
              // con evidencia positiva (ver `healLocalTier`).
              const healed: string[] = [];
              const items_v2 = items.map((localItem) => {
                const product = products.find(
                  (p) => p.id === localItem.product_id,
                );
                if (!product) return localItem;
                const outcome = this.healLocalTier(localItem, product);
                if (outcome.healedTo) {
                  healed.push(`${product.name} → ${outcome.healedTo}`);
                }
                return outcome.item;
              });

              if (healed.length > 0) {
                // Se persiste SIN recargar (writeLocalCart, no saveLocalCart)
                // para no reentrar en este mismo método.
                this.writeLocalCart(items_v2);
                this.toastService.warning(
                  healed.length === 1
                    ? `La presentación elegida ya no está disponible. Ajustamos: ${healed[0]}`
                    : `Algunas presentaciones ya no están disponibles. Ajustamos: ${healed.join('; ')}`,
                );
              }

              const cartItems: CartItem[] = items_v2
                .map((localItem) => {
                  const product = products.find(
                    (p) => p.id === localItem.product_id,
                  );
                  if (!product) return null;

                  // Precio de la LÍNEA. `sale_unit_price` ya es el precio del
                  // PAQUETE ENTERO, así que manda sobre variante y producto y
                  // el total sigue siendo `price * quantity` (paquetes).
                  // NUNCA se multiplica por units_per_package.
                  //
                  // La línea SIN tarifa es la UNIDAD SUELTA, y su precio es
                  // `loose_unit_price`, no `final_price`: con el selector
                  // encendido `final_price` es el de la presentación marcada
                  // por defecto, así que usarlo cobraba el bulto por la
                  // botella. `loose_unit_price` sólo llega cuando el producto
                  // ofrece la unidad; si no, se cae a la cascada histórica.
                  const looseUnitPrice = product.loose_unit_price;
                  const price =
                    localItem.sale_unit_price != null
                      ? Number(localItem.sale_unit_price)
                      : localItem.variant_price
                        ? Number(localItem.variant_price)
                        : looseUnitPrice != null
                          ? Number(looseUnitPrice)
                          : Number(product.final_price || product.base_price);

                  return {
                    id: localItem.product_id,
                    line_key: cartLineKey(
                      product.id,
                      localItem.product_variant_id,
                      localItem.price_tier_id,
                    ),
                    product_id: product.id,
                    product_variant_id: localItem.product_variant_id || null,
                    quantity: localItem.quantity,
                    unit_price: price,
                    total_price: price * localItem.quantity,
                    price_tier: localItem.price_tier_id
                      ? {
                          id: localItem.price_tier_id,
                          label:
                            localItem.sale_unit_name ??
                            product.sale_unit?.name ??
                            'Presentación',
                          units_per_package:
                            localItem.sale_unit_units_per_package ?? 1,
                          presentation_price: price,
                        }
                      : null,
                    product: {
                      name: product.name,
                      slug: product.slug,
                      sku: product.sku || '',
                      image_url: product.image_url,
                      weight: product.weight || 0,
                      product_type: product.product_type,
                      requires_booking: product.requires_booking,
                      service_duration_minutes:
                        product.service_duration_minutes ?? undefined,
                    },
                    variant: localItem.product_variant_id
                      ? {
                          name: localItem.variant_name || null,
                          sku: localItem.variant_sku || null,
                          attributes: null,
                        }
                      : null,
                  };
                })
                .filter((i) => i !== null) as CartItem[];

              const cart: Cart = {
                id: 0,
                currency: this.currencyFormatService.currencyCode() || 'USD',
                subtotal: cartItems.reduce((sum, i) => sum + i.total_price, 0),
                item_count: cartItems.reduce((sum, i) => sum + i.quantity, 0),
                items: cartItems,
              };
              this.cart.set(this.normalizeCart(cart));
              // Centrally enrich the cart signal with promotional discounts +
              // tier progress from the stateless summary endpoint (localStorage
              // carts are not persisted server-side).
              this.enrichCartWithSummary();
            },
            error: () => this.emitEmptyCart(),
          });
      } catch {
        localStorage.removeItem(this.local_storage_key);
        this.emitEmptyCart();
      }
    } else {
      this.emitEmptyCart();
    }
  }

  /**
   * Rellena `line_key` en todas las líneas del carrito.
   *
   * Se aplica en CADA `cart.set(...)` (API y localStorage) para que la UI
   * tenga siempre una identidad estable por línea, incluso en las respuestas
   * del backend, donde la tarifa llega en `price_tier.id`.
   */
  private normalizeCart(cart: Cart): Cart {
    if (!cart?.items?.length) return cart;
    return {
      ...cart,
      items: cart.items.map((item) => ({
        ...item,
        line_key: cartLineKey(
          item.product_id,
          item.product_variant_id,
          item.price_tier?.id ?? null,
        ),
      })),
    };
  }

  /**
   * Repara la presentación guardada de una línea invitada cuando la tarifa
   * dejó de existir o dejó de estar disponible.
   *
   * Reglas duras:
   *  - Sólo se sana con EVIDENCIA POSITIVA (el catálogo devolvió la lista de
   *    presentaciones y la guardada no está en ella o está agotada). Sin esa
   *    lista no se toca nada: sanar a ciegas rompería carritos sanos cuando el
   *    backend todavía no publica el campo.
   *  - Si NINGUNA presentación es usable (todo agotado), se deja la línea tal
   *    cual. Nunca se elimina ni se vacía el carrito en silencio: el backend
   *    rechazará el checkout con un mensaje concreto, que es mejor que perder
   *    la compra.
   */
  private healLocalTier(
    localItem: LocalCartItem,
    product: EcommerceProduct,
  ): { item: LocalCartItem; healedTo: string | null } {
    const tierId = localItem.price_tier_id;
    if (!tierId) return { item: localItem, healedTo: null };

    // `available_sale_units` está declarado en `ProductDetail`; el endpoint de
    // listado puede publicarlo o no. Se lee de forma tolerante.
    const units = (
      product as EcommerceProduct & {
        available_sale_units?: SaleUnitOption[];
      }
    ).available_sale_units;
    if (!Array.isArray(units) || units.length === 0) {
      return { item: localItem, healedTo: null };
    }

    // `available_packages === null` significa "no rastrea inventario", que NO
    // es agotado — comparación estricta contra 0.
    const usable = (u: SaleUnitOption) =>
      u.is_available !== false && u.available_packages !== 0;

    const stored = units.find((u) => u.price_tier_id === tierId);
    if (stored && usable(stored)) return { item: localItem, healedTo: null };

    const fallback =
      units.find((u) => u.is_default && usable(u)) ?? units.find(usable);
    if (!fallback) return { item: localItem, healedTo: null };

    // La UNIDAD SUELTA (`price_tier_id: null`) es un destino legítimo de la
    // reparación, y sanar hacia ella significa que la línea deja de tener
    // presentación: hay que BORRAR la etiqueta y el packSize cacheados, no solo
    // el id. Conservarlos dejaría una línea sin tarifa mostrando "Bulto 50kg
    // (50 und)" y calculando el peso de envío por 50 unidades que ya no compra.
    if (fallback.price_tier_id === null) {
      return {
        item: {
          ...localItem,
          price_tier_id: undefined,
          sale_unit_name: undefined,
          sale_unit_units_per_package: undefined,
          sale_unit_price: undefined,
        },
        healedTo: fallback.name,
      };
    }

    return {
      item: {
        ...localItem,
        price_tier_id: fallback.price_tier_id,
        sale_unit_name: fallback.name,
        sale_unit_units_per_package: fallback.units_per_package ?? undefined,
        sale_unit_price: fallback.price,
      },
      healedTo: fallback.name,
    };
  }

  private emitEmptyCart() {
    const cart: Cart = {
      id: 0,
      currency: this.currencyFormatService.currencyCode() || 'USD',
      subtotal: 0,
      item_count: 0,
      items: [],
    };
    this.cart.set(cart);
  }

  private getLocalCart(): LocalCartItem[] {
    const stored = localStorage.getItem(this.local_storage_key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as LocalCartItem[] | StoredLocalCart;
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (this.isStoredCartExpired(parsed)) {
          localStorage.removeItem(this.local_storage_key);
          return [];
        }
        return parsed.items || [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Escribe el carrito invitado SIN recargarlo. Lo usa la auto-sanación, que
   * corre DENTRO de `loadLocalCart` y volvería a entrar en él si llamara a
   * `saveLocalCart`.
   */
  private writeLocalCart(items: LocalCartItem[]): void {
    const payload: StoredLocalCart = {
      items,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(this.local_storage_key, JSON.stringify(payload));
  }

  private saveLocalCart(items: LocalCartItem[]): void {
    this.writeLocalCart(items);
    this.loadLocalCart();
  }

  private isStoredCartExpired(cart: StoredLocalCart): boolean {
    const expirationHours = this.getCartExpirationHours();
    if (!expirationHours || !cart.updated_at) return false;

    const expiresAt =
      new Date(cart.updated_at).getTime() + expirationHours * 60 * 60 * 1000;
    return Date.now() > expiresAt;
  }

  getCartExpirationHours(): number | null {
    const value =
      this.domain_service.getCurrentDomainConfig()?.customConfig?.ecommerce
        ?.cart?.cart_expiration_hours;
    const hours = Number(value || 0);
    return hours > 0 ? hours : null;
  }

  getMaxQuantityPerItem(): number | null {
    const value =
      this.domain_service.getCurrentDomainConfig()?.customConfig?.ecommerce
        ?.cart?.max_quantity_per_item;
    const max = Number(value || 0);
    return max > 0 ? max : null;
  }

  /**
   * @deprecated Use addToCart() instead which automatically handles authentication state
   */
  addToLocalCart(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
    variantInfo?: { name: string; sku: string; price: number },
    options?: Pick<AddProductOptions, 'priceTierId' | 'saleUnitInfo'>,
  ): void {
    const items = this.getLocalCart();
    // La identidad de línea incluye la TARIFA: sin ella, "Rollo 20 m" y
    // "Metro" del mismo producto se fusionarían en una sola línea, perdiendo
    // la elección del comprador y mezclando dos escalas de precio.
    const target = cartLineKey(
      product_id,
      product_variant_id,
      options?.priceTierId,
    );
    const existing = items.find(
      (i) =>
        cartLineKey(i.product_id, i.product_variant_id, i.price_tier_id) ===
        target,
    );

    if (existing) {
      const nextQuantity = existing.quantity + quantity;
      const maxQuantity = this.getMaxQuantityPerItem();
      existing.quantity = maxQuantity
        ? Math.min(nextQuantity, maxQuantity)
        : nextQuantity;
    } else {
      items.push({
        product_id,
        product_variant_id,
        quantity: this.getMaxQuantityPerItem()
          ? Math.min(quantity, this.getMaxQuantityPerItem()!)
          : quantity,
        variant_name: variantInfo?.name,
        variant_sku: variantInfo?.sku,
        variant_price: variantInfo?.price,
        price_tier_id: options?.priceTierId,
        sale_unit_name: options?.saleUnitInfo?.name,
        sale_unit_units_per_package:
          options?.saleUnitInfo?.units_per_package ?? undefined,
        sale_unit_price: options?.saleUnitInfo?.price,
      });
    }

    this.saveLocalCart(items);
    this.item_added_subject.next();
  }

  /**
   * @deprecated Use updateCartItem() instead which automatically handles authentication state
   */
  updateLocalCartItem(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
    price_tier_id?: number,
  ): void {
    const items = this.getLocalCart();
    const target = cartLineKey(product_id, product_variant_id, price_tier_id);
    const item = items.find(
      (i) =>
        cartLineKey(i.product_id, i.product_variant_id, i.price_tier_id) ===
        target,
    );

    if (item) {
      const maxQuantity = this.getMaxQuantityPerItem();
      item.quantity = maxQuantity ? Math.min(quantity, maxQuantity) : quantity;
      this.saveLocalCart(items);
    }
  }

  /**
   * @deprecated Use removeCartItem() instead which automatically handles authentication state
   */
  removeFromLocalCart(
    product_id: number,
    product_variant_id?: number,
    price_tier_id?: number,
  ): void {
    let items = this.getLocalCart();
    const target = cartLineKey(product_id, product_variant_id, price_tier_id);
    items = items.filter(
      (i) =>
        cartLineKey(i.product_id, i.product_variant_id, i.price_tier_id) !==
        target,
    );
    this.saveLocalCart(items);
  }

  /**
   * @deprecated Use clearAllCart() instead which automatically handles authentication state
   */
  clearLocalCart(): void {
    localStorage.removeItem(this.local_storage_key);
    this.emitEmptyCart();
  }

  // API methods for authenticated users
  getCart(): Observable<any> {
    return this.http
      .get(`${this.api_url}`, { headers: this.getHeaders() })
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(this.normalizeCart(response.data));
            this.enrichCartWithSummary();
          }
        }),
      );
  }

  addItem(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
    price_tier_id?: number,
  ): Observable<any> {
    return this.http
      .post(
        `${this.api_url}/items`,
        {
          product_id,
          quantity,
          product_variant_id,
          // Sólo se envía la clave cuando hay tarifa elegida: un
          // `price_tier_id: undefined` desaparece al serializar, pero
          // mantenerlo condicional deja explícito que la ruta sin
          // presentaciones sigue mandando exactamente el mismo body de antes.
          ...(price_tier_id ? { price_tier_id } : {}),
        },
        { headers: this.getHeaders() },
      )
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(this.normalizeCart(response.data));
            this.enrichCartWithSummary();
            this.item_added_subject.next();
          }
        }),
      );
  }

  updateItem(item_id: number, quantity: number): Observable<any> {
    return this.http
      .put(
        `${this.api_url}/items/${item_id}`,
        { quantity },
        { headers: this.getHeaders() },
      )
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(this.normalizeCart(response.data));
            this.enrichCartWithSummary();
          }
        }),
      );
  }

  removeItem(item_id: number): Observable<any> {
    return this.http
      .delete(`${this.api_url}/items/${item_id}`, {
        headers: this.getHeaders(),
      })
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(this.normalizeCart(response.data));
            this.enrichCartWithSummary();
          }
        }),
      );
  }

  clearCart(): Observable<any> {
    return this.http.delete(this.api_url, { headers: this.getHeaders() }).pipe(
      tap((response: any) => {
        if (response.success) {
          this.emitEmptyCart();
        }
      }),
    );
  }

  syncFromLocalStorage(): Observable<any> {
    // Se mapea explícitamente en vez de mandar el registro v2 crudo: los
    // campos de presentación son un CACHÉ DE PINTADO local (`sale_unit_name`,
    // `sale_unit_price`, ...) y el backend no debe recibirlos ni confiar en
    // ellos — sólo necesita saber QUÉ tarifa eligió el comprador para volver
    // a resolver el precio él mismo.
    const items = this.getLocalCart().map((i) => ({
      product_id: i.product_id,
      product_variant_id: i.product_variant_id,
      quantity: i.quantity,
      variant_name: i.variant_name,
      variant_sku: i.variant_sku,
      variant_price: i.variant_price,
      ...(i.price_tier_id ? { price_tier_id: i.price_tier_id } : {}),
    }));
    return this.http
      .post(`${this.api_url}/sync`, { items }, { headers: this.getHeaders() })
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(this.normalizeCart(response.data));
            this.enrichCartWithSummary();
            // Limpiar localStorage INMEDIATAMENTE después de sincronizar
            localStorage.removeItem(this.local_storage_key);
          }
        }),
      );
  }

  /**
   * Stateless promotional summary. Sends the raw items and lets the backend
   * compute `promotion_discount`, `promotional_subtotal`, the applied-promotion
   * breakdown and `tier_progress`. Used for BOTH guest (localStorage, not
   * persisted server-side) and authenticated carts by `enrichCartWithSummary`.
   */
  getCartSummary(
    items: {
      product_id: number;
      product_variant_id?: number | null;
      quantity: number;
      price_tier_id?: number;
    }[],
  ): Observable<CartSummaryData & { success?: boolean; data?: CartSummaryData }> {
    return this.http.post<
      CartSummaryData & { success?: boolean; data?: CartSummaryData }
    >(`${this.api_url}/summary`, { items }, { headers: this.getHeaders() });
  }

  /**
   * CENTRAL promotional enrichment for the shared `cart` signal.
   *
   * Reads the CURRENT cart items — this works uniformly for guest
   * (localStorage) and authenticated carts because both populate
   * `cart().items` — asks the stateless `POST /ecommerce/cart/summary`
   * endpoint for the promotional breakdown, and merges ONLY the promo fields
   * (`promotion_discount`, `promotional_subtotal`, `applied_promotions`,
   * `tier_progress`) into the signal. Item lines are never mutated.
   *
   * This is the SINGLE place that enriches the cart, so every consumer of the
   * `cart` signal (page, layout dropdown, checkout) sees promotions + tier
   * progress WITHOUT hitting the summary endpoint themselves. It is invoked
   * after every load/mutation: getCart, addItem, updateItem, removeItem,
   * syncFromLocalStorage and loadLocalCart.
   *
   * Concurrency: the `summary_seq` token guarantees last-response-wins so a
   * slow summary from a superseded cart state can never clobber a newer one.
   */
  private enrichCartWithSummary(): void {
    const current = this.cart();
    if (!current) return;

    const items = current.items ?? [];
    if (items.length === 0) {
      // Empty cart: clear any stale promo fields so consumers don't render
      // discounts/nudges over an empty cart.
      const hasPromo =
        !!current.promotion_discount ||
        (current.applied_promotions?.length ?? 0) > 0 ||
        (current.tier_progress?.length ?? 0) > 0;
      if (hasPromo) {
        this.cart.set({
          ...current,
          promotion_discount: 0,
          promotional_subtotal: current.subtotal,
          applied_promotions: [],
          tier_progress: [],
        });
      }
      return;
    }

    // La presentación elegida DEBE viajar: sin ella el backend resuelve la
    // presentación por defecto y cotiza la promoción sobre el precio unitario
    // (1 Rollo de $95.000 se descontaba como $5.000 → -$500 en vez de -$9.500).
    const summaryItems = items.map((i) => ({
      product_id: i.product_id,
      product_variant_id: i.product_variant_id ?? null,
      quantity: i.quantity,
      price_tier_id: i.price_tier?.id ?? undefined,
    }));

    const seq = ++this.summary_seq;
    this.getCartSummary(summaryItems)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          // Drop stale responses: a newer mutation already fired.
          if (seq !== this.summary_seq) return;
          const data = response?.data ?? response;
          const now = this.cart();
          if (!now || !data) return;

          // SAFETY NET: si la API retorna `applied_promotions` con
          // `discount_amount` populados pero el `promotion_discount` y/o
          // `promotional_subtotal` están en 0/igual-al-subtotal, calculamos
          // los totales localmente desde el array. Esto evita el bug donde el
          // cart muestra los expanded cards (prueba, test) pero el Total
          // queda = Subtotal porque el backend no propagó los montos.
          const appliedPromos = data.applied_promotions ?? [];
          const localDiscountTotal = appliedPromos.reduce(
            (sum, p) => sum + (Number(p.discount_amount) || 0),
            0,
          );
          const apiDiscount = Number(data.promotion_discount) || 0;
          // Si la API devolvió discount=0 pero los applied_promotions SÍ
          // tienen discount_amount, usamos el cálculo local.
          const effectiveDiscount =
            apiDiscount > 0 ? apiDiscount : localDiscountTotal;
          const effectivePromoSubtotal =
            effectiveDiscount > 0
              ? Math.max(0, (now.subtotal ?? 0) - effectiveDiscount)
              : now.subtotal;

          this.cart.set({
            ...now,
            promotion_discount: effectiveDiscount,
            promotional_subtotal:
              data.promotional_subtotal != null
                ? Math.min(
                    Number(data.promotional_subtotal),
                    effectivePromoSubtotal,
                  )
                : effectivePromoSubtotal,
            applied_promotions: appliedPromos,
            tier_progress: data.tier_progress ?? [],
            per_product_tier_ladder: data.per_product_tier_ladder,
            // CP-ECOM-PROMO-UX-001 convergence-R5: propagate the backend's
            // load-state. The summary endpoint uses the same retry/degraded
            // machinery as `GET /cart`, so a sustained failure here ALSO flips
            // the banner to 'degraded' instead of letting the cart look
            // healthy.
            promotions_load_state:
              data.promotions_load_state === 'degraded' ? 'degraded' : 'ok',
          });
        },
        // CP-ECOM-PROMO-UX-001 R3-M8: surface summary failures instead of
        // silently swallowing them. A silent failure here means the cart
        // shows no discounts/nudges and the operator never knows why. We
        // log a structured warning and pop a non-blocking toast so the
        // customer can still complete checkout (promo fields stay empty,
        // cart is left untouched) but the failure is observable.
        // The cart signal is NOT mutated on error — promo lines stay empty
        // until the next successful enrichment, which is the previous
        // behaviour and is the correct conservative default.
        error: (err) => {
          const parsed = parseApiError(err);
          // eslint-disable-next-line no-console
          console.warn(
            `[cart] summary failed: ${parsed.errorCode ?? 'unknown'}`,
            parsed.devMessage ?? parsed.userMessage,
          );
          this.toastService.warning('No se pudieron actualizar las promociones');
        },
      });
  }

  // ========== UNIFIED PUBLIC METHODS ==========
  // These methods automatically detect authentication state and use the appropriate storage

  /**
   * Normaliza las dos formas de llamada (posicional legacy vs objeto de
   * opciones) a un único `AddProductOptions`.
   *
   * La discriminación es `typeof arg3 === 'number'`: el tercer posicional
   * histórico es siempre un `product_variant_id` numérico, así que un objeto
   * en esa posición sólo puede ser el nuevo contrato. Un `undefined` (call
   * sites que saltan la variante para pasar `variantInfo`) cae al último
   * `return` y conserva el comportamiento de antes.
   */
  private toAddOptions(
    variantOrOptions?: number | AddProductOptions,
    variantInfo?: { name: string; sku: string; price: number },
  ): AddProductOptions {
    if (typeof variantOrOptions === 'number') {
      return { variantId: variantOrOptions, variantInfo };
    }
    if (variantOrOptions && typeof variantOrOptions === 'object') {
      return variantOrOptions;
    }
    return { variantInfo };
  }

  /**
   * Agrega un producto al carrito.
   * Detecta automáticamente si usar API (autenticado) o localStorage (guest).
   */
  addToCart(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
    variantInfo?: { name: string; sku: string; price: number },
  ): Observable<any> | void;
  addToCart(
    product_id: number,
    quantity: number,
    options: AddProductOptions,
  ): Observable<any> | void;
  addToCart(
    product_id: number,
    quantity: number,
    variantOrOptions?: number | AddProductOptions,
    variantInfo?: { name: string; sku: string; price: number },
  ): Observable<any> | void {
    const options = this.toAddOptions(variantOrOptions, variantInfo);

    // Store closed: re-show the branded banner. The backend still hard-blocks
    // checkout; this reinforces the UX at the earliest customer action.
    if (this.store_availability.unavailable()) {
      this.store_availability.reopen();
    }

    if (this.is_authenticated) {
      return this.addItem(
        product_id,
        quantity,
        options.variantId,
        options.priceTierId,
      );
    } else {
      this.addToLocalCart(
        product_id,
        quantity,
        options.variantId,
        options.variantInfo,
        {
          priceTierId: options.priceTierId,
          saleUnitInfo: options.saleUnitInfo,
        },
      );
    }
  }

  /**
   * Chokepoint for ALL "agregar producto" entry points (D3). Routes the call
   * to the correct sink so no other component has to re-implement the
   * mesa-vs-cart branch:
   *
   *   1. `isOpenTab()`  → `tableContext.addOrder([...])` (mesa tab) — returns
   *                       the underlying Observable so callers can chain their
   *                       own post-processing (e.g. reset local qty stepper).
   *   2. `isActive() && !isOpenTab()` → reserved enum values (`menu_only`,
   *                       `mark_occupied`) without a UI driver today; surface a
   *                       toast so the diner doesn't see a silent no-op and
   *                       return early.
   *   3. else           → legacy `addToCart` (auth-aware, dual storage).
   *
   * Signature mirrors `addToCart` so the 12 call sites migrate with a single
   * token rename. The mesa success/error toast is centralised here (was
   * previously duplicated in product-card / menus-showcase / menus-page via
   * the D5 ad-hoc branches).
   *
   * MULTITARIFA: la presentación de venta entra por la SOBRECARGA de objeto
   * (`addProduct(id, qty, { priceTierId, saleUnitInfo })`). La forma
   * posicional histórica sigue viva sin cambios, así que los ~13 call sites
   * existentes compilan intactos. No se añadió un 5º posicional porque
   * `addProduct(id, q, undefined, undefined, tier)` es ilegible.
   */
  addProduct(
    product_id: number,
    quantity?: number,
    product_variant_id?: number,
    variantInfo?: { name: string; sku: string; price: number },
  ): Observable<any> | void;
  addProduct(
    product_id: number,
    quantity: number,
    options: AddProductOptions,
  ): Observable<any> | void;
  addProduct(
    product_id: number,
    quantity: number = 1,
    variantOrOptions?: number | AddProductOptions,
    variantInfo?: { name: string; sku: string; price: number },
  ): Observable<any> | void {
    const options = this.toAddOptions(variantOrOptions, variantInfo);

    // Store closed: re-show the branded banner. The backend still hard-blocks
    // checkout; this reinforces the UX at the earliest customer action.
    if (this.store_availability.unavailable()) {
      this.store_availability.reopen();
    }

    // (1) QR dine-in — open_tab: dish belongs on the table tab, NOT the
    // ecommerce cart. Mirrors the D5 ad-hoc branches in product-card /
    // menus-showcase / menus-page that this method centralises.
    if (this.tableContext.isOpenTab()) {
      return this.tableContext
        .addOrder([
          {
            product_id,
            quantity,
            product_variant_id: options.variantId,
            ...(options.priceTierId
              ? { price_tier_id: options.priceTierId }
              : {}),
          },
        ])
        .pipe(
          tap((res) => {
            if (res?.success) {
              const msg = this.tableContext.autoFire()
                ? `Agregado a la mesa ${this.tableContext.tableName()} — enviado a cocina`
                : `Agregado a la mesa ${this.tableContext.tableName()}`;
              this.toastService.success(msg);
            }
          }),
          catchError((err) => {
            const { userMessage, devMessage } = parseApiError(err);
            this.toastService.error(userMessage);
            if (devMessage) console.error('[table addOrder]', devMessage);
            // Return a null sentinel so the caller's `result.subscribe(cb)`
            // still fires its next handler (e.g. qty stepper reset) without
            // rethrowing — keeps the chokepoint signature compatible.
            return of(null);
          }),
        );
    }

    // (2) QR dine-in — table active but NOT in open_tab mode.
    // (Step 7) The purchase CTAs are now hidden at the surface level via
    // `tableContext.hideDineInPurchase()`, so this branch is unreachable
    // from the UI in `menu_only` / pre-session `mark_occupied` /
    // pre-session `require_staff`. Defensive guard retained: if a
    // programmatic caller reaches here (e.g. test, future surface that
    // forgets to gate), silently no-op rather than spilling the dish
    // into the regular cart while the diner is "occupying" the mesa.
    if (this.tableContext.isActive()) {
      return;
    }

    // (3) Standard ecommerce path — auth-aware (API vs localStorage).
    return this.addToCart(product_id, quantity, options);
  }

  /**
   * Actualiza la cantidad de un item en el carrito.
   * Para usuarios autenticados, requiere item_id de la DB.
   * Para guests, requiere product_id y product_variant_id.
   */
  updateCartItem(
    identifier: {
      item_id?: number;
      product_id?: number;
      product_variant_id?: number;
      /**
       * Tarifa de la línea. Sin ella el carrito invitado edita la PRIMERA
       * línea del producto, que con multitarifa puede ser otra presentación.
       */
      price_tier_id?: number;
    },
    quantity: number,
  ): Observable<any> | void {
    if (this.is_authenticated && identifier.item_id) {
      return this.updateItem(identifier.item_id, quantity);
    } else if (!this.is_authenticated && identifier.product_id !== undefined) {
      this.updateLocalCartItem(
        identifier.product_id,
        quantity,
        identifier.product_variant_id,
        identifier.price_tier_id,
      );
    }
  }

  /**
   * Remueve un item del carrito.
   */
  removeCartItem(identifier: {
    item_id?: number;
    product_id?: number;
    product_variant_id?: number;
    /** Ver `updateCartItem`: identifica la línea, no sólo el producto. */
    price_tier_id?: number;
  }): Observable<any> | void {
    if (this.is_authenticated && identifier.item_id) {
      return this.removeItem(identifier.item_id);
    } else if (!this.is_authenticated && identifier.product_id !== undefined) {
      this.removeFromLocalCart(
        identifier.product_id,
        identifier.product_variant_id,
        identifier.price_tier_id,
      );
    }
  }

  /**
   * Limpia todo el carrito.
   */
  clearAllCart(): Observable<any> | void {
    if (this.is_authenticated) {
      return this.clearCart();
    }
    this.clearLocalCart();
  }

  // ========== CART TYPE HELPERS ==========

  /** Returns true if the cart contains at least one physical product */
  hasPhysicalItems(): boolean {
    const cart = this.cart();
    if (!cart) return false;
    return cart.items.some((item) => item.product.product_type !== 'service');
  }

  /** Returns true if the cart contains only service items */
  hasOnlyServices(): boolean {
    const cart = this.cart();
    if (!cart || cart.items.length === 0) return false;
    return cart.items.every((item) => item.product.product_type === 'service');
  }

  /** Returns true if the cart contains at least one service item */
  hasServiceItems(): boolean {
    const cart = this.cart();
    if (!cart) return false;
    return cart.items.some((item) => item.product.product_type === 'service');
  }

  /** Returns true if the cart contains at least one item that requires booking */
  hasBookableServices(): boolean {
    const cart = this.cart();
    if (!cart?.items) return false;
    return cart.items.some(
      (item: CartItem) => item.product?.requires_booking === true,
    );
  }

  /** Returns the cart items that require booking */
  getBookableItems(): CartItem[] {
    const cart = this.cart();
    if (!cart?.items) return [];
    return cart.items.filter(
      (item: CartItem) => item.product?.requires_booking === true,
    );
  }

  // ========== SHIPPING ==========
  getShippingEstimates(address: {
    country_code: string;
    state_province?: string;
    city?: string;
    postal_code?: string;
  }): Observable<any[]> {
    const cart = this.cart();
    if (!cart || cart.items.length === 0) {
      return new Observable((observer) => {
        observer.next([]);
        observer.complete();
      });
    }

    const items = cart.items.map((item: CartItem) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      weight: (item.product.weight || 0) * item.quantity,
      price: item.total_price,
    }));

    const payload = {
      address: address,
      items: items,
    };

    const domainConfig = this.domain_service.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;

    let params: any = {};
    if (storeId !== undefined && storeId !== null) {
      params.store_id = storeId.toString();
    }

    // Use standard http call.
    // Note: The controller is @Public().
    // If we have an interceptor that adds token, it's fine.
    // We pass store_id as query param as implemented in controller.
    return this.http.post<any[]>(
      `${environment.apiUrl}/shipping/calculate`,
      payload,
      {
        headers: this.getHeaders(), // Keeps store-id in header too, just in case
        params: params,
      },
    );
  }
}
