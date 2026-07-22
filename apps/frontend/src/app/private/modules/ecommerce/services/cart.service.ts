import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CatalogService, EcommerceProduct } from './catalog.service';
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
}

interface LocalCartItem {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  // Cached variant info for display
  variant_name?: string;
  variant_sku?: string;
  variant_price?: number;
}

interface StoredLocalCart {
  items: LocalCartItem[];
  updated_at: string;
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
              const cartItems: CartItem[] = items
                .map((localItem) => {
                  const product = products.find(
                    (p) => p.id === localItem.product_id,
                  );
                  if (!product) return null;

                  const price = localItem.variant_price
                    ? Number(localItem.variant_price)
                    : Number(product.final_price || product.base_price);

                  return {
                    id: localItem.product_id,
                    product_id: product.id,
                    product_variant_id: localItem.product_variant_id || null,
                    quantity: localItem.quantity,
                    unit_price: price,
                    total_price: price * localItem.quantity,
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
              this.cart.set(cart);
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

  private saveLocalCart(items: LocalCartItem[]): void {
    const payload: StoredLocalCart = {
      items,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(this.local_storage_key, JSON.stringify(payload));
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
  ): void {
    const items = this.getLocalCart();
    const existing = items.find(
      (i) =>
        i.product_id === product_id &&
        i.product_variant_id === product_variant_id,
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
  ): void {
    const items = this.getLocalCart();
    const item = items.find(
      (i) =>
        i.product_id === product_id &&
        i.product_variant_id === product_variant_id,
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
  removeFromLocalCart(product_id: number, product_variant_id?: number): void {
    let items = this.getLocalCart();
    items = items.filter(
      (i) =>
        !(
          i.product_id === product_id &&
          i.product_variant_id === product_variant_id
        ),
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
            this.cart.set(response.data);
            this.enrichCartWithSummary();
          }
        }),
      );
  }

  addItem(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
  ): Observable<any> {
    return this.http
      .post(
        `${this.api_url}/items`,
        { product_id, quantity, product_variant_id },
        { headers: this.getHeaders() },
      )
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(response.data);
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
            this.cart.set(response.data);
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
            this.cart.set(response.data);
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
    const items = this.getLocalCart();
    return this.http
      .post(`${this.api_url}/sync`, { items }, { headers: this.getHeaders() })
      .pipe(
        tap((response: any) => {
          if (response.success) {
            this.cart.set(response.data);
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

    const summaryItems = items.map((i) => ({
      product_id: i.product_id,
      product_variant_id: i.product_variant_id ?? null,
      quantity: i.quantity,
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
          this.cart.set({
            ...now,
            promotion_discount: Number(data.promotion_discount) || 0,
            promotional_subtotal:
              data.promotional_subtotal != null
                ? Number(data.promotional_subtotal)
                : now.subtotal,
            applied_promotions: data.applied_promotions ?? [],
            tier_progress: data.tier_progress ?? [],
          });
        },
        // On failure keep the cart as-is (no promo lines shown).
        error: () => {},
      });
  }

  // ========== UNIFIED PUBLIC METHODS ==========
  // These methods automatically detect authentication state and use the appropriate storage

  /**
   * Agrega un producto al carrito.
   * Detecta automáticamente si usar API (autenticado) o localStorage (guest).
   */
  addToCart(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
    variantInfo?: { name: string; sku: string; price: number },
  ): Observable<any> | void {
    // Store closed: re-show the branded banner. The backend still hard-blocks
    // checkout; this reinforces the UX at the earliest customer action.
    if (this.store_availability.unavailable()) {
      this.store_availability.reopen();
    }

    if (this.is_authenticated) {
      return this.addItem(product_id, quantity, product_variant_id);
    } else {
      this.addToLocalCart(
        product_id,
        quantity,
        product_variant_id,
        variantInfo,
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
   */
  addProduct(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
    variantInfo?: { name: string; sku: string; price: number },
  ): Observable<any> | void {
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
            product_variant_id,
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
    return this.addToCart(
      product_id,
      quantity,
      product_variant_id,
      variantInfo,
    );
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
  }): Observable<any> | void {
    if (this.is_authenticated && identifier.item_id) {
      return this.removeItem(identifier.item_id);
    } else if (!this.is_authenticated && identifier.product_id !== undefined) {
      this.removeFromLocalCart(
        identifier.product_id,
        identifier.product_variant_id,
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
