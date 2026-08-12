import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { Observable, of, throwError, forkJoin } from 'rxjs';
import {
  catchError,
  delay,
  map,
  tap,
  debounceTime,
  distinctUntilChanged,
  switchMap,
} from 'rxjs/operators';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CartItem,
  CartSummary,
  CartState,
  CartDiscount,
  AddToCartRequest,
  AddCustomItemRequest,
  UpdateCartItemRequest,
  UpdateCartItemPriceRequest,
  ApplyDiscountRequest,
  CartValidationError,
  PendingBooking,
} from '../models/cart.model';

// Re-export types for component usage
export type {
  AddToCartRequest,
  AddCustomItemRequest,
  CartItem,
  CartState,
  PendingBooking,
  UpdateCartItemPriceRequest,
} from '../models/cart.model';
import { PosCustomer } from '../models/customer.model';
import { PosProductService, Product, PosProductVariant } from './pos-product.service';
import { PriceResolverService } from '../../../../../shared/services/pricing';
import {
  PriceTier,
  ProductPriceTierOverride,
} from '../../price-tiers/interfaces';
import { PriceTierCacheService } from '../../price-tiers/services/price-tier-cache.service';
import { PosSaleUnitService } from './pos-sale-unit.service';
import { resolveLineUnits } from '../utils/line-units.util';
import { WithholdingTaxService } from '../../withholding-tax/services/withholding-tax.service';
import { WithholdingPreviewResult } from '../../withholding-tax/interfaces/withholding.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { PosUvtThreshold } from '../../invoicing/interfaces/invoice.interface';

/**
 * Presentational "faltan N und para el siguiente tramo" hint for an auto-apply
 * quantity_tiered promotion. Derived from cart state + active promotions;
 * carries no money/discount calculation.
 */
export interface PromotionTierProgress {
  promotion_id: number;
  name: string;
  /** Units still needed to reach the next tier for the promo's scope. */
  remaining_quantity: number;
  /** Benefit of the next tier ("-X%" / "-$Y"). */
  next_benefit_label: string;
}

@Injectable({
  providedIn: 'root',
})
export class PosCartService {
  readonly cartState = signal<CartState>(this.getInitialState());
  readonly loading = signal<boolean>(false);

  private destroyRef = inject(DestroyRef);
  private withholdingService = inject(WithholdingTaxService);
  private currencyFormat = inject(CurrencyFormatService);
  private invoicingService = inject(InvoicingService);
  private saleUnitService = inject(PosSaleUnitService);
  private priceTierCache = inject(PriceTierCacheService);

  /**
   * Techo de 5 UVT para el documento equivalente POS (Art. 616-1 ET / Res.
   * 000165 de 2023). `null` mientras no se resuelve o cuando no aplica.
   *
   * Se carga UNA vez: el valor solo cambia cuando la DIAN publica una UVT nueva
   * (anual) o cuando el comercio activa facturación electrónica.
   */
  readonly uvtThreshold = signal<PosUvtThreshold | null>(null);

  /**
   * `true` cuando la venta actual, tal como está, ya no cabe en un tiquete POS:
   * supera el tope y no hay comprador identificado.
   *
   * Es SOLO un aviso de UI. El bloqueo real vive en la transacción de venta del
   * backend, contra el total que el servidor recalcula — este cálculo usa el
   * total del carrito, que aún puede cambiar con promociones resueltas server-side.
   */
  readonly invoiceRequiredByUvt = computed(() => {
    const threshold = this.uvtThreshold();
    if (!threshold?.enforced || threshold.limit_cop === null) return false;
    const state = this.cartState();
    if (state.customer?.id) return false;
    return Number(state.summary.total ?? 0) > threshold.limit_cop;
  });

  constructor(
    private productService: PosProductService,
    private priceResolver: PriceResolverService,
  ) {
    this.initWithholdingPreview();
    this.loadUvtThreshold();
  }

  /**
   * Carga el techo de 5 UVT. Degrada a "sin tope" ante cualquier fallo: el aviso
   * es una ayuda, y una llamada caída no debe teñir el carrito de una advertencia
   * que no se puede sustentar (ni ocultar el error real de la venta, que llega
   * tipado desde el backend).
   */
  private loadUvtThreshold(): void {
    this.invoicingService
      .getPosUvtThreshold()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.uvtThreshold.set(response?.data ?? null),
        error: () => this.uvtThreshold.set(null),
      });
  }

  /**
   * Reactive withholding preview (role='suffered' — the CUSTOMER retains us on
   * a sale). Listens to the cart and fires the backend preview ONLY when the
   * withholding inputs actually change (customer, base subtotal, IVA), with a
   * debounce + switchMap to avoid spamming the endpoint and to cancel stale
   * in-flight requests. The backend is the single source of truth; we just
   * store the resolved `total_withholding` on the summary. Never throws — a
   * failed preview leaves the cart total untouched (withholding 0).
   */
  private initWithholdingPreview(): void {
    toObservable(this.cartState)
      .pipe(
        map((state) => {
          const customerId = Number(state.customer?.id ?? 0) || 0;
          const base = Number(state.summary.subtotal ?? 0) || 0;
          const ivaAmount = Number(state.summary.taxAmount ?? 0) || 0;
          return { customerId, base, ivaAmount };
        }),
        distinctUntilChanged(
          (a, b) =>
            a.customerId === b.customerId &&
            a.base === b.base &&
            a.ivaAmount === b.ivaAmount,
        ),
        debounceTime(300),
        switchMap(({ customerId, base, ivaAmount }) => {
          // No counterparty or no base → no call, reset to 0.
          if (customerId <= 0 || base <= 0) {
            return of({ lines: [], total_withholding: 0 });
          }
          return this.withholdingService.previewWithholding({
            role: 'suffered',
            customer_id: customerId,
            base,
            ivaAmount,
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.applyWithholdingToSummary(result));
  }

  /** Patch the current summary with the backend-resolved withholding. */
  private applyWithholdingToSummary(result: WithholdingPreviewResult): void {
    const current = this.cartState();
    const amount = Number(result?.total_withholding ?? 0) || 0;
    const lines = result?.lines ?? [];
    if (
      (current.summary.withholdingAmount ?? 0) === amount &&
      (current.summary.withholdingLines?.length ?? 0) === lines.length
    ) {
      return; // No-op: avoids a redundant signal write / re-render loop.
    }
    this.cartState.set({
      ...current,
      summary: {
        ...current.summary,
        withholdingAmount: amount,
        withholdingLines: lines,
      },
    });
  }

  // Observable getters
  get cartState$(): Observable<CartState> {
    return toObservable(this.cartState);
  }

  get items(): Observable<CartItem[]> {
    return toObservable(this.cartState).pipe(map((state) => state.items));
  }

  get customer(): Observable<PosCustomer | null> {
    return toObservable(this.cartState).pipe(map((state) => state.customer));
  }

  get summary(): Observable<CartSummary> {
    return toObservable(this.cartState).pipe(map((state) => state.summary));
  }

  get loading$(): Observable<boolean> {
    return toObservable(this.loading);
  }

  get isEmpty(): Observable<boolean> {
    return toObservable(this.cartState)
      .pipe(map((state) => state.items.length === 0));
  }

  /**
   * Add product to cart
   */
  addToCart(request: AddToCartRequest): Observable<CartState> {
    // Validate request
    const validationErrors = this.validateAddToCartRequest(request);
    if (validationErrors.length > 0) {
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    return of(request).pipe(
      map((req) => this.processAddToCart(req)),
      tap((newState) => this.cartState.set(newState)),
      switchMap((newState) =>
        request.scannedPriceTierId != null
          ? this.applyScannedPresentation(newState, request)
          : of(newState),
      ),
    );
  }

  /**
   * QUI-648 — el código pistoleado pertenece a una presentación del producto,
   * así que la línea entra con esa presentación ya puesta. El cajero no la
   * elige: el código de barras vino justo a resolver en qué unidad se vende.
   *
   * Si la tarifa no se puede resolver (catálogo caído, tarifa desactivada), la
   * línea queda con la tarifa por defecto en vez de romper la venta: pistolear
   * nunca puede terminar en un carrito vacío.
   */
  private applyScannedPresentation(
    state: CartState,
    request: AddToCartRequest,
  ): Observable<CartState> {
    const tierId = Number(request.scannedPriceTierId);
    const productId = Number(request.product.id);
    const target = state.items.find(
      (item) =>
        String(item.product.id) === String(request.product.id) &&
        item.applied_price_tier_id == null,
    );
    if (!Number.isFinite(tierId) || !Number.isFinite(productId) || !target) {
      return of(state);
    }

    return forkJoin({
      tiers: this.priceTierCache.getActiveTiers(),
      overrides: this.priceTierCache.getProductOverrides(productId),
    }).pipe(
      switchMap(({ tiers, overrides }) => {
        const tier = tiers.find((candidate) => candidate.id === tierId) ?? null;
        if (!tier) return of(this.cartState());
        return this.applyTierToCartItem(
          target.id,
          tier,
          (overrides ?? []).filter(
            (override) => override.price_tier_id === tierId,
          ),
        );
      }),
      catchError(() => of(this.cartState())),
    );
  }

  /**
   * Add a billable custom item to the cart.
   */
  addCustomItem(request: AddCustomItemRequest): Observable<CartState> {
    return of(request).pipe(
      map((req) => this.processAddCustomItem(req)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Update cart item quantity
   */
  updateCartItem(request: UpdateCartItemRequest): Observable<CartState> {
    return of(request).pipe(
      map((req) => this.processUpdateCartItem(req)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Apply (or clear, with `tier === null`) a price tier on a specific cart
   * item. Recomputes `unitPrice`, `finalPrice`, `totalPrice` and tax via
   * `PriceResolverService.resolveWithTier`.
   *
   * @param itemId         Cart item id.
   * @param tier           Selected tier, or null to revert to default cascade.
   * @param tierOverrides  Override rows for the product that match `tier.id`
   *                       (caller pre-filters; pass [] if none).
   */
  applyTierToCartItem(
    itemId: string,
    tier: PriceTier | null,
    tierOverrides: ProductPriceTierOverride[] = [],
  ): Observable<CartState> {
    return of({ itemId, tier, tierOverrides }).pipe(
      map((args) => this.processApplyTierToCartItem(args)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  updateCartItemPrice(
    request: UpdateCartItemPriceRequest,
  ): Observable<CartState> {
    return of(request).pipe(
      map((req) => this.processUpdateCartItemPrice(req)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Remove item from cart
   */
  removeFromCart(itemId: string): Observable<CartState> {
    return of(itemId).pipe(
      map((id) => this.processRemoveFromCart(id)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Clear entire cart
   */
  clearCart(): Observable<CartState> {
    return of(null).pipe(
      map(() => this.getInitialState()),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Set customer for cart
   */
  setCustomer(customer: PosCustomer | null): Observable<CartState> {
    return of(customer).pipe(
      map((cust) => {
        const currentState = this.cartState();
        return {
          ...currentState,
          customer: cust,
          updatedAt: new Date(),
        };
      }),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Update cart notes
   */
  updateNotes(notes: string): Observable<CartState> {
    return of(notes).pipe(
      map((note) => {
        const currentState = this.cartState();
        return {
          ...currentState,
          notes: note.trim(),
          updatedAt: new Date(),
        };
      }),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Apply discount to cart
   */
  applyDiscount(request: ApplyDiscountRequest): Observable<CartState> {
    // Validate discount
    const validationErrors = this.validateDiscountRequest(request);
    if (validationErrors.length > 0) {
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    return of(request).pipe(
      map((req) => this.processApplyDiscount(req)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Remove discount from cart
   */
  removeDiscount(discountId: string): Observable<CartState> {
    return of(discountId).pipe(
      map((id) => this.processRemoveDiscount(id)),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Load items from an existing order into the cart for editing
   */
  loadFromOrder(order: any): Observable<CartState> {
    if (!order?.order_items || order.order_items.length === 0) {
      return of(this.getInitialState());
    }

    // Fetch full product data for each order item
    const productRequests: Observable<{ item: any; product: Product | null }>[] = order.order_items.map((item: any) =>
      item.product_id
        ? this.productService.getProductById(item.product_id.toString()).pipe(
            map((product: Product | null) => ({ item, product })),
            catchError(() => of({ item, product: null as Product | null })),
          )
        : of({ item, product: null as Product | null }),
    );

    return forkJoin(productRequests).pipe(
      map((results) => {
        const cartItems: CartItem[] = results.map((result: any) => {
          const { item, product } = result;

          // If product was found from API, use it; otherwise create a stub
          const cartProduct: Product = product || {
            id: item.product_id?.toString() || this.generateCustomProductId(),
            name: item.product_name,
            sku: item.variant_sku || '',
            price: Number(item.unit_price),
            final_price: Number(item.final_unit_price || item.unit_price),
            category: '',
            stock: 9999,
            track_inventory: false,
            minStock: 0,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            has_variants: false,
            product_variants: [],
          };

          const unitPrice = Number(item.unit_price);
          const quantity = Number(item.quantity);
          const totalPrice = Number(item.total_price);
          const taxAmount = Number(item.tax_amount_item || 0) * quantity;

          return {
            id: this.generateItemId(),
            product: cartProduct,
            quantity,
            unitPrice,
            finalPrice: Number(item.final_unit_price || totalPrice / quantity),
            totalPrice: Number(item.final_unit_price || totalPrice / quantity) * quantity,
            taxAmount,
            addedAt: new Date(),
            itemType: item.item_type === 'custom' || !item.product_id ? 'custom' : 'product',
            description: item.description || undefined,
            originalFinalPrice: Number(item.catalog_final_price || item.final_unit_price || totalPrice / quantity),
            isPriceOverridden: item.is_price_overridden === true,
            priceOverrideReason: item.price_override_reason || undefined,
          } as CartItem;
        });

        const newState: CartState = {
          items: cartItems,
          customer: order.users ? {
            id: order.users.id,
            name: `${order.users.first_name} ${order.users.last_name}`,
            first_name: order.users.first_name,
            last_name: order.users.last_name,
            email: order.users.email,
            phone: order.users.phone || '',
          } as PosCustomer : null,
          notes: '',
          appliedDiscounts: [],
          pendingBookings: [],
          summary: this.calculateSummary(cartItems, []),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return newState;
      }),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Update weight for a weight-based cart item
   */
  updateCartItemWeight(itemId: string, newWeight: number): Observable<CartState> {
    const currentState = this.cartState();
    const itemIndex = currentState.items.findIndex(item => item.id === itemId);

    if (itemIndex === -1) {
      return throwError(() => new Error('Item not found in cart'));
    }

    const item = currentState.items[itemIndex];
    if (!item.is_weight_product) {
      return throwError(() => new Error('Item is not a weight product'));
    }

    const updatedItems = [...currentState.items];
    const totalPrice = item.finalPrice * newWeight;
    const taxMultiplier = newWeight;

    updatedItems[itemIndex] = {
      ...item,
      weight: newWeight,
      totalPrice,
      taxAmount: this.calculateItemTaxWithBase(item.product, item.unitPrice, taxMultiplier),
    };

    const newState: CartState = {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(updatedItems, currentState.appliedDiscounts),
      updatedAt: new Date(),
    };

    this.cartState.set(newState);
    return of(newState);
  }

  /**
   * Apply eligible promotions to the cart.
   *
   * Phase 3b / Section 6: when a promotion has
   * `rule_type === 'quantity_tiered'`, a SINGLE tier is resolved from the
   * AGGREGATED scope quantity (`scopedQty` = sum of `line.quantity` across
   * every in-scope item) and then applied to each line. Tier selection order
   * matches the backend engine byte-for-byte (see
   * `computeTierDiscountForResolvedTier` in
   * `apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.ts`):
   *
   *   1. Sort tiers by `(min_quantity ASC, sort_order ASC, id ASC)`.
   *   2. Pick the first tier where `min_quantity <= scopedQty` and
   *      (`max_quantity` is null OR `>= scopedQty`) — resolved ONCE, not per line.
   *   3. `percentage`: per line `lineTotal * tier.value / 100` (summed).
   *      `fixed_amount`: a FLAT `tier.value` applied ONCE over the scope
   *      subtotal (`applicableTotal`), never `tier.value × units`.
   *   4. Cap each line discount at its line total (never-negative line).
   *   5. Sum across lines, cap by `max_discount_amount`, then by
   *      `applicableTotal` (scoped total ceiling).
   *   6. Scale per-line discounts proportionally so their sum equals the
   *      final aggregate (persisted snapshot must match per-item breakdown).
   *
   * Flat-rule behaviour remains untouched: same flat branch as before.
   */
  applyPromotions(activePromotions: any[]): Observable<CartState> {
    return of(activePromotions).pipe(
      map((promotions) => {
        const currentState = this.cartState();

        // Remove previously auto-applied promotion discounts
        const manualDiscounts = currentState.appliedDiscounts.filter(d => !d.is_auto_applied);

        // Calculate cart total for order-level eligibility
        const subtotal = this.calculateSubtotal(currentState.items);

        // Discounts evaluated this pass — only the single winner (highest
        // priority, lowest id on ties) ends up in `promoDiscounts`. All
        // other candidates are discarded. See the comment block below.
        const promoDiscounts: CartDiscount[] = [];

        // ---------------------------------------------------------------
        // WINNER-TAKES-ALL: an order has at most ONE active promotion.
        // Mirrors the backend engine rule (PromotionEngineService.
        // quoteDiscounts): the highest-priority candidate wins, ties broken
        // by lowest promotion_id. All other candidates are discarded even
        // if they apply to non-overlapping products. See skills/vendix-
        // date-timezone and the engine fix in commit ac12eda13 for the
        // canonical algorithm.
        //
        // The preview math (per-line shares, tier resolution, cap, etc.) is
        // unchanged — only the selection step changes. The "winner" is
        // recomputed in the backend at charge time; this just makes the
        // cashier preview match the authoritative backend value.
        // ---------------------------------------------------------------
        let winner: {
          discount: CartDiscount;
          priority: number;
          id: number;
        } | null = null;

        for (const promo of promotions) {
          if (!promo.is_auto_apply) continue;

          // Check min purchase
          if (promo.min_purchase_amount && subtotal < Number(promo.min_purchase_amount)) continue;

          const applicableTotal = this.calculatePromotionApplicableTotal(
            promo,
            currentState.items,
          );
          if (applicableTotal <= 0) continue;

          // -----------------------------------------------------------------
          // quantity_tiered branch — mirror backend engine math above.
          // -----------------------------------------------------------------
          if (promo.rule_type === 'quantity_tiered') {
            const sortedTiers = (promo.promotion_quantity_tiers ?? [])
              .slice()
              .sort((a: any, b: any) => {
                if (a.min_quantity !== b.min_quantity)
                  return a.min_quantity - b.min_quantity;
                if (a.sort_order !== b.sort_order)
                  return a.sort_order - b.sort_order;
                return Number(a.id) - Number(b.id);
              });

            if (sortedTiers.length === 0) continue;

            const applicableItems = this.getPromotionApplicableItems(
              promo,
              currentState.items,
            );

            // Tier is resolved ONCE from the AGGREGATED scope quantity, then
            // fixed for every line in scope — mirror of the backend engine.
            const scopedQty = applicableItems.reduce(
              (sum, item) => sum + Number(item.quantity),
              0,
            );
            const matchedTier = sortedTiers.find(
              (t: any) =>
                t.min_quantity <= scopedQty &&
                (t.max_quantity === null ||
                  t.max_quantity === undefined ||
                  t.max_quantity >= scopedQty),
            );
            if (!matchedTier) continue;

            // Discount priced with the SINGLE resolved tier.
            //  - percentage: per line (lineTotal × tier.value / 100), summed.
            //  - fixed_amount: a FLAT tier.value applied ONCE over the scope
            //    subtotal (applicableTotal), NOT tier.value × units. This
            //    mirrors the authoritative backend semantics so the cashier
            //    preview equals the amount actually charged at payment.
            const perLineDiscount: Array<{ item: CartItem; discount: number }> =
              [];
            let rawTotal = 0;
            if (matchedTier.type === 'percentage') {
              for (const item of applicableItems) {
                const lineDiscount = this.computeTierDiscountForResolvedTier(
                  Number(item.finalPrice),
                  Number(item.quantity),
                  matchedTier,
                );
                perLineDiscount.push({ item, discount: lineDiscount });
                rawTotal = this.roundMoney(rawTotal + lineDiscount);
              }
            } else {
              const tierValue = Number(matchedTier.value);
              rawTotal =
                Number.isFinite(tierValue) && tierValue > 0
                  ? this.roundMoney(Math.min(tierValue, applicableTotal))
                  : 0;
            }

            if (rawTotal <= 0) continue;

            // Apply the global `max_discount_amount` cap on top of the summed
            // line discounts; never exceed the applicable scoped total either.
            let discountAmount = rawTotal;
            const maxDiscountAmount = this.toOptionalNumber(promo.max_discount_amount);
            if (maxDiscountAmount !== null && maxDiscountAmount > 0) {
              discountAmount = Math.min(discountAmount, maxDiscountAmount);
            }
            discountAmount = Math.min(discountAmount, applicableTotal);
            discountAmount = this.roundMoney(discountAmount);
            if (discountAmount <= 0) continue;

            // Proportionally scale per-line discounts to match the capped
            // total so the persisted snapshot matches the per-item breakdown.
            // We only feed the AGGREGATE `discount_amount` into
            // `CartDiscount.amount` — that's what `calculateSummary` reads
            // to subtract from the cart total. Per-line persistence is the
            // backend's job; we mirror math, not state.
            //
            // The iteration is kept (instead of just `discountAmount`) so the
            // rounding-and-last-share remainder logic stays in lockstep with
            // the engine — any future drift here would silently mis-preview.
            const scale = rawTotal > 0 ? discountAmount / rawTotal : 0;
            let assigned = 0;
            perLineDiscount.forEach(({ item: _item }, i) => {
              const isLast = i === perLineDiscount.length - 1;
              const rawShare = perLineDiscount[i].discount;
              const proportionalShare = this.roundMoney(rawShare * scale);
              const share = isLast
                ? this.roundMoney(discountAmount - assigned)
                : proportionalShare;
              assigned = this.roundMoney(assigned + share);
              // `share` is bounded above by `discountAmount`, which itself
              // was capped at `applicableTotal` and `max_discount_amount`;
              // so it cannot exceed a single line total here. No mutation.
            });

            const candidateDiscount: CartDiscount = {
              id: 'PROMO_' + promo.id,
              type: promo.type === 'percentage' ? 'percentage' : 'fixed',
              value: Number(promo.value),
              description: promo.name,
              amount: discountAmount,
              promotion_id: promo.id,
              is_auto_applied: true,
              // Presentation-only tier label (mirrors backend "Desde N und: -X%").
              badge_label: this.buildTierBadgeLabel(matchedTier),
              // Affected products for tiered promos that scope to a subset of
              // the cart (e.g. `quantity_tiered` on a specific product). For
              // `scope: 'order'` this is empty and the UI hides the suffix.
              affected_products: this.collectAffectedProducts(
                promo,
                applicableItems,
              ),
            };
            if (
              winner === null ||
              Number(promo.priority ?? 0) < winner.priority ||
              (Number(promo.priority ?? 0) === winner.priority &&
                Number(promo.id) < winner.id)
            ) {
              winner = {
                discount: candidateDiscount,
                priority: Number(promo.priority ?? 0),
                id: Number(promo.id),
              };
            }
            continue;
          }

          // Flat branch (untouched) — preserved bit-for-bit with prior logic.
          // Calculate discount
          let discountAmount = 0;
          if (promo.type === 'percentage') {
            discountAmount = applicableTotal * (Number(promo.value) / 100);
          } else {
            discountAmount = Math.min(Number(promo.value), applicableTotal);
          }

          const maxDiscountAmount = this.toOptionalNumber(promo.max_discount_amount);
          if (maxDiscountAmount !== null && maxDiscountAmount > 0) {
            discountAmount = Math.min(discountAmount, maxDiscountAmount);
          }

          // Un candidato que no descuenta nada NO compite. Sin esta guarda,
          // una promo flat con `value = 0` entra a la comparación de abajo y,
          // si su prioridad es más alta, GANA — y como el modelo es
          // winner-takes-all, suprime al descuento real que sí aplicaba.
          //
          // El motor del backend ya descarta estos candidatos
          // (`promotion-engine.service.ts`: `if (discountAmount <= 0) continue`)
          // y la rama tiered de acá también. La flat era la única sin la
          // guarda, así que el mismo carrito daba un precio en el POS y otro
          // en el carrito online — y el POS persiste su propio
          // `discount_amount` (`pos-order.service.ts`), el backend no
          // recalcula. `value = 0` es guardable porque el DTO es `@Min(0)`.
          if (discountAmount <= 0) continue;

          // For scope: 'order' the affected list is empty (whole order). The
          // POS UI hides the suffix in that case so the operator sees a clean
          // discount line for order-wide promos.
          const flatApplicableItems = this.getPromotionApplicableItems(
            promo,
            currentState.items,
          );
          const candidateDiscount: CartDiscount = {
            id: 'PROMO_' + promo.id,
            type: promo.type === 'percentage' ? 'percentage' : 'fixed',
            value: Number(promo.value),
            description: promo.name,
            amount: Math.round(discountAmount * 100) / 100,
            promotion_id: promo.id,
            is_auto_applied: true,
            affected_products: this.collectAffectedProducts(
              promo,
              flatApplicableItems,
            ),
          };
          if (
            winner === null ||
            Number(promo.priority ?? 0) < winner.priority ||
            (Number(promo.priority ?? 0) === winner.priority &&
              Number(promo.id) < winner.id)
          ) {
            winner = {
              discount: candidateDiscount,
              priority: Number(promo.priority ?? 0),
              id: Number(promo.id),
            };
          }
        }

        // Push ONLY the winner to the final discounts list. All other
        // evaluated candidates are discarded by the "highest priority wins"
        // rule. If no candidate passed the guards, `winner` is null and
        // `promoDiscounts` remains empty.
        if (winner) {
          promoDiscounts.push(winner.discount);
        }

        const updatedDiscounts = [...manualDiscounts, ...promoDiscounts];

        return {
          ...currentState,
          appliedDiscounts: updatedDiscounts,
          summary: this.calculateSummary(currentState.items, updatedDiscounts),
          updatedAt: new Date(),
        } as CartState;
      }),
      tap((newState) => this.cartState.set(newState)),
    );
  }

  /**
   * Pick the items that fall inside the promotion's scope (product, category,
   * or order-wide). Used by the quantity_tiered branch — pure mirror of the
   * existing `calculatePromotionApplicableTotal` filter, but returns the
   * items themselves instead of summing them. Scope semantics are NOT
   * changed; this is just a non-mutating read.
   */
  private getPromotionApplicableItems(promo: any, items: CartItem[]): CartItem[] {
    if (promo.scope === 'product') {
      const promoProductIds = (promo.promotion_products || [])
        .map((pp: any) => Number(pp.product_id))
        .filter((id: number) => Number.isFinite(id));
      return items.filter((item) =>
        promoProductIds.includes(Number(item.product.id)),
      );
    }

    if (promo.scope === 'category') {
      const promoCategoryIds = (promo.promotion_categories || [])
        .map((pc: any) => Number(pc.category_id))
        .filter((id: number) => Number.isFinite(id));
      return items.filter((item) =>
        this.getItemCategoryIds(item).some((categoryId) =>
          promoCategoryIds.includes(categoryId),
        ),
      );
    }

    return items;
  }

  /**
   * Build a deduplicated list of product names affected by the promotion.
   * Returns `undefined` (not an empty array) when the promo is order-wide so
   * the template can use a single `@if (disc.affected_products?.length)` to
   * distinguish "no scope restriction" from "restriction with zero matches".
   *
   * Mirrors the ecommerce `applicable_descriptions` array but the POS only
   * renders product names (categories are a softer signal that the operator
   * can derive from the line items below).
   */
  private collectAffectedProducts(
    promo: any,
    applicableItems: CartItem[],
  ): string[] | undefined {
    if (promo.scope === 'order') return undefined;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of applicableItems) {
      const name = item.product?.name?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  /**
   * Compute per-line discount for a `quantity_tiered` promotion once the winning
   * tier is ALREADY resolved from the aggregated scope quantity (scopedQty) by
   * the caller. The tier is fixed for every line in scope, so this helper never
   * does a `find`. MIRROR of `computeTierDiscountForResolvedTier` in the backend
   * engine — KEEP percentage math byte-identical.
   *  - percentage: lineTotal × tier.value / 100
   *  - fixed_amount: NOT priced here — it is a FLAT amount resolved ONCE over
   *    the scope subtotal by the caller; this defensive fallback only caps the
   *    flat value to the line total and never multiplies by quantity.
   */
  private computeTierDiscountForResolvedTier(
    unitPrice: number,
    quantity: number,
    tier: any,
  ): number {
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    if (!Number.isFinite(price) || price <= 0) return 0;

    const tierValue = Number(tier.value);
    if (!Number.isFinite(tierValue) || tierValue <= 0) return 0;

    const lineTotal = price * qty;
    let discount = 0;
    if (tier.type === 'percentage') {
      discount = (lineTotal * tierValue) / 100;
    } else {
      // fixed_amount is a FLAT amount (resolved once over the scope subtotal by
      // the caller); never tier.value × units. Defensive per-line cap only.
      discount = Math.min(tierValue, lineTotal);
    }

    discount = Math.max(0, Math.min(discount, lineTotal));
    return this.roundMoney(discount);
  }

  /**
   * Format only the BENEFIT of a tier ("-X%" for percentage, "-$Y" for
   * fixed_amount). Returns `undefined` when the value is missing/invalid.
   * Presentation only — no discount math.
   */
  private formatTierBenefit(tier: {
    type?: string | null;
    value?: number | string | null;
  }): string | undefined {
    const value = Number(tier?.value ?? 0);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return tier?.type === 'percentage'
      ? `-${value}%`
      : `-${this.currencyFormat.format(value)}`;
  }

  /**
   * Build a human tier/benefit label for a matched `quantity_tiered` tier,
   * mirroring the backend enrichment ("Desde N und: -X%" for percentage,
   * "Desde N und: -$Y" for fixed_amount). Presentation only — the discount
   * amount is resolved by the caller. Returns `undefined` when the tier data
   * is incomplete so the UI can simply skip the tramo badge.
   */
  private buildTierBadgeLabel(tier: {
    min_quantity?: number | string | null;
    type?: string | null;
    value?: number | string | null;
  }): string | undefined {
    const min = Number(tier?.min_quantity ?? 0);
    if (!Number.isFinite(min) || min <= 0) return undefined;
    const benefit = this.formatTierBenefit(tier);
    if (!benefit) return undefined;
    return `Desde ${min} und: ${benefit}`;
  }

  /**
   * Best-effort "faltan N und para el siguiente tramo" hint for auto-apply
   * `quantity_tiered` promotions. Pure READ over the current cart plus the
   * active promotions the caller already fetched: reuses the same scope
   * resolution (`getPromotionApplicableItems`) and tier ordering as
   * `applyPromotions`, and performs NO money/discount calculation. Returns one
   * entry per promo that already has items in scope AND a next tier reachable
   * above the current scoped quantity; empty otherwise.
   */
  getPromotionTierProgress(
    activePromotions: any[],
  ): PromotionTierProgress[] {
    const items = this.cartState().items;
    const progress: PromotionTierProgress[] = [];

    for (const promo of activePromotions ?? []) {
      if (!promo?.is_auto_apply) continue;
      if (promo.rule_type !== 'quantity_tiered') continue;

      const sortedTiers = (promo.promotion_quantity_tiers ?? [])
        .slice()
        .sort((a: any, b: any) => {
          if (a.min_quantity !== b.min_quantity)
            return a.min_quantity - b.min_quantity;
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return Number(a.id) - Number(b.id);
        });
      if (sortedTiers.length === 0) continue;

      const applicableItems = this.getPromotionApplicableItems(promo, items);
      const scopedQty = applicableItems.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      );
      // Only nudge when the customer already has in-scope items in the cart.
      if (scopedQty <= 0) continue;

      // Next tier = first tier whose threshold is still ABOVE the current qty.
      const nextTier = sortedTiers.find(
        (t: any) => Number(t.min_quantity) > scopedQty,
      );
      if (!nextTier) continue;

      const remaining = Number(nextTier.min_quantity) - scopedQty;
      if (!Number.isFinite(remaining) || remaining <= 0) continue;

      const benefit = this.formatTierBenefit(nextTier);
      if (!benefit) continue;

      progress.push({
        promotion_id: Number(promo.id),
        name: String(promo.name ?? ''),
        remaining_quantity: remaining,
        next_benefit_label: benefit,
      });
    }

    return progress;
  }

  /**
   * Apply a coupon code as a discount (new coupon system)
   */
  applyCouponDiscount(couponValidation: any): Observable<CartState> {
    const currentState = this.cartState();

    // Remove any previously applied coupon
    const withoutCoupon = currentState.appliedDiscounts.filter(d => !d.coupon_id);

    const newDiscount: CartDiscount = {
      id: 'COUPON_' + couponValidation.coupon_id,
      type: couponValidation.discount_type === 'PERCENTAGE' ? 'percentage' : 'fixed',
      value: Number(couponValidation.discount_value),
      description: `Cupón ${couponValidation.coupon_code}`,
      amount: Number(couponValidation.discount_amount),
      coupon_id: couponValidation.coupon_id,
      coupon_code: couponValidation.coupon_code,
    };

    const updatedDiscounts = [...withoutCoupon, newDiscount];

    const newState: CartState = {
      ...currentState,
      appliedDiscounts: updatedDiscounts,
      appliedCoupon: {
        id: couponValidation.coupon_id,
        code: couponValidation.coupon_code,
        discount_type: couponValidation.discount_type,
        discount_value: Number(couponValidation.discount_value),
      },
      summary: this.calculateSummary(currentState.items, updatedDiscounts),
      updatedAt: new Date(),
    };

    this.cartState.set(newState);
    return of(newState);
  }

  /**
   * Remove the applied coupon
   */
  removeCoupon(): Observable<CartState> {
    const currentState = this.cartState();
    const withoutCoupon = currentState.appliedDiscounts.filter(d => !d.coupon_id);

    const newState: CartState = {
      ...currentState,
      appliedDiscounts: withoutCoupon,
      appliedCoupon: undefined,
      summary: this.calculateSummary(currentState.items, withoutCoupon),
      updatedAt: new Date(),
    };

    this.cartState.set(newState);
    return of(newState);
  }

  /**
   * Get promotion IDs from applied discounts (for sending to backend)
   */
  getAppliedPromotionIds(): number[] {
    return this.cartState().appliedDiscounts
      .filter(d => d.promotion_id && !d.coupon_id)
      .map(d => d.promotion_id!);
  }

  /**
   * Get the applied coupon data (for sending to backend)
   */
  getAppliedCoupon(): { coupon_id: number; coupon_code: string } | null {
    const state = this.cartState();
    return state.appliedCoupon
      ? { coupon_id: state.appliedCoupon.id, coupon_code: state.appliedCoupon.code }
      : null;
  }

  addPendingBooking(booking: PendingBooking): Observable<CartState> {
    const current = this.cartState();
    const exists = current.pendingBookings.some(b => b.id === booking.id);
    if (exists) return of(current);

    const newState: CartState = {
      ...current,
      pendingBookings: [...current.pendingBookings, booking],
      updatedAt: new Date(),
    };
    this.cartState.set(newState);
    return of(newState);
  }

  removePendingBooking(bookingId: number): Observable<CartState> {
    const current = this.cartState();
    const newState: CartState = {
      ...current,
      pendingBookings: current.pendingBookings.filter(b => b.id !== bookingId),
      updatedAt: new Date(),
    };
    this.cartState.set(newState);
    return of(newState);
  }

  getPendingBookingIds(): number[] {
    return this.cartState().pendingBookings.map(b => b.id);
  }

  /**
   * Get current cart state value
   */
  getCurrentState(): CartState {
    return this.cartState();
  }

  /**
   * Get item by ID
   */
  getItemById(itemId: string): CartItem | null {
    return (
      this.cartState().items.find((item) => item.id === itemId) || null
    );
  }

  /**
   * Check if product is in cart
   */
  isProductInCart(productId: string): boolean {
    return this.cartState().items.some(
      (item) => item.product.id === productId,
    );
  }

  /**
   * Get item quantity for product
   */
  getProductQuantity(productId: string): number {
    const item = this.cartState().items.find(
      (item) => item.product.id === productId,
    );
    return item ? item.quantity : 0;
  }

  private processAddCustomItem(request: AddCustomItemRequest): CartState {
    const currentState = this.cartState();
    const quantity = Number(request.quantity || 1);
    const finalPrice = Number(request.finalPrice || 0);

    if (!request.name?.trim()) {
      throw new Error('El ítem personalizado requiere una descripción.');
    }
    if (quantity <= 0) {
      throw new Error('La cantidad debe ser mayor a 0.');
    }
    if (finalPrice < 0) {
      throw new Error('El precio no puede ser negativo.');
    }

    const taxRate = this.calculateTaxCategoryRate(request.taxCategory);
    const unitPrice = taxRate > 0 ? finalPrice / (1 + taxRate) : finalPrice;
    const taxAmount = (finalPrice - unitPrice) * quantity;
    const customProduct: Product = {
      id: this.generateCustomProductId(),
      name: request.name.trim(),
      sku: '',
      price: unitPrice,
      final_price: finalPrice,
      cost: 0,
      category: 'Personalizado',
      stock: 999999,
      track_inventory: false,
      minStock: 0,
      image: '',
      image_url: '',
      description: request.description || '',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      tax_assignments: request.taxCategory
        ? [
            {
              product_id: 0,
              tax_category_id: request.taxCategory.id,
              tax_categories: request.taxCategory as any,
            },
          ]
        : [],
      has_variants: false,
      product_variants: [],
      pricing_type: 'unit',
    };

    const customItem: CartItem = {
      id: this.generateItemId(),
      itemType: 'custom',
      product: customProduct,
      quantity,
      unitPrice: this.roundMoney(unitPrice),
      finalPrice: this.roundMoney(finalPrice),
      totalPrice: this.roundMoney(finalPrice * quantity),
      taxAmount: this.roundMoney(taxAmount),
      taxCategoryId: request.taxCategory?.id ?? null,
      taxRate,
      description: request.description?.trim() || undefined,
      addedAt: new Date(),
    };

    const updatedItems = [customItem, ...currentState.items];
    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(
        updatedItems,
        currentState.appliedDiscounts,
      ),
      updatedAt: new Date(),
    };
  }

  private processApplyTierToCartItem(args: {
    itemId: string;
    tier: PriceTier | null;
    tierOverrides: ProductPriceTierOverride[];
  }): CartState {
    const { itemId, tier, tierOverrides } = args;
    const currentState = this.cartState();
    const itemIndex = currentState.items.findIndex(
      (item) => item.id === itemId,
    );
    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }

    const item = currentState.items[itemIndex];
    if (item.itemType === 'custom') {
      // Custom items never resolve via tier — they carry a free-form price.
      return currentState;
    }

    const product = item.product;
    const variant = product.product_variants?.find(
      (v) => v.id === item.variant_id,
    );
    if (tier && !this.isTierEnabledForProduct(product, tier.id)) {
      throw new Error('Esta tarifa no está habilitada para el producto');
    }

    const taxRate = this.calculateRateSum(product);
    const resolution = this.priceResolver.resolveWithTier(
      {
        id: product.id,
        base_price: product.price,
        is_on_sale: product.is_on_sale ?? false,
        sale_price: product.sale_price ?? null,
        track_inventory: product.track_inventory ?? true,
        // Packaging is tier-owned now; the product only carries the flag.
        has_multiple_price_tiers: product.has_multiple_price_tiers === true,
      },
      variant
        ? {
            id: variant.id.toString(),
            price_override: variant.price_override ?? null,
            is_on_sale: variant.is_on_sale ?? false,
            sale_price: variant.sale_price ?? null,
            track_inventory_override: variant.track_inventory_override ?? null,
          }
        : undefined,
      tier
        ? {
            id: tier.id,
            name: tier.name,
            discount_percentage: tier.discount_percentage ?? 0,
            is_package_unit: !!tier.is_package_unit,
            // Packaging cascade source — pack size lives on the tier.
            units_per_package: tier.units_per_package ?? null,
          }
        : null,
      tierOverrides
        .filter((o) => !tier || o.price_tier_id === tier.id)
        .map((o) => ({
          variant_id: o.variant_id ?? null,
          override_price:
            o.override_price != null ? Number(o.override_price) : null,
          // Per-product/per-variant packaging override (cascade).
          override_units_per_package: o.override_units_per_package ?? null,
        })),
      taxRate,
    );

    const unitPrice = this.roundMoney(resolution.unitPrice);
    const finalUnitPrice = this.roundMoney(resolution.unitPriceWithTax);
    const maxQuantity = this.getMaxSellableQuantity(
      product,
      variant,
      !!resolution.isPackageUnit,
      resolution.unitsPerPackage ?? null,
    );
    // QUI-648. Con PRESENTACIÓN aplicada, `quantity` cuenta PAQUETES y el
    // precio es el del paquete completo: la escala del producto sale de la
    // ecuación (el backend excluye estas líneas por la misma razón). Al quitar
    // la presentación, la línea vuelve a su escala y a su unidad de venta.
    //
    // Una TARIFA DE CLIENTE ("Mayorista") no es una presentación: cambia el
    // número del precio, que sigue expresado por unidad de precio. La línea
    // conserva su escala y su unidad de venta, igual que sin tarifa. Por eso
    // todo lo de abajo decide por el EMPAQUE y no por `appliedTierId != null`
    // — ver el encabezado de `line-units.util.ts`.
    const appliedTierId = resolution.appliedPriceTierId ?? null;
    const saleUnit = this.saleUnitService.configFor(product);

    // Una línea capturada en unidad de venta guarda milímetros o gramos, no
    // paquetes: al ponerle una presentación hay que convertir la magnitud, o
    // "3 m" se convertirían en "3 rollos". La conversión se limita a esas
    // líneas —las que estrena esta feature— para no cambiarle la cantidad a
    // ninguna línea del catálogo por pieza que ya funciona así.
    const capturedInSaleUnit = Number(item.stock_units_per_sale_unit ?? 1) > 1;
    const nextPackSize = resolution.isPackageUnit
      ? Number(resolution.unitsPerPackage ?? 1) || 1
      : 1;
    /** La tarifa que se está aplicando es una presentación (empaque > 1). */
    const appliesPresentation = nextPackSize > 1;
    const previousPackSize = item.is_package_unit
      ? Number(item.units_per_package ?? 1) || 1
      : 1;
    let desiredQuantity = item.quantity;
    if (capturedInSaleUnit && appliesPresentation) {
      // Unidades mínimas → paquetes.
      desiredQuantity = Math.max(1, Math.round(item.quantity / nextPackSize));
    } else if (
      !appliesPresentation &&
      previousPackSize > 1 &&
      saleUnit.unitsPerCapture > 1
    ) {
      // Paquetes → unidades mínimas, al salir de la presentación. Vale tanto al
      // volver a la tarifa por defecto como al pasar a una tarifa de cliente:
      // en los dos casos la línea recupera su escala, y dejar la cantidad en
      // paquetes leería "3 rollos" como "3 mm".
      desiredQuantity = item.quantity * previousPackSize;
    }

    const quantity =
      this.doesLineTrackInventory(product, variant) && !item.is_weight_product
        ? Math.min(desiredQuantity, maxQuantity)
        : desiredQuantity;
    if (!item.is_weight_product && quantity <= 0) {
      throw new Error('Stock insuficiente para aplicar esta tarifa');
    }
    // Solo la presentación borra la escala: con tarifa de cliente el precio
    // sigue publicado "por metro", así que la línea conserva su
    // `price_unit_quantity` y su unidad de venta (el cajero sigue viendo "3 m",
    // no 3.000 mm).
    const nextPriceUnitQuantity = appliesPresentation
      ? null
      : saleUnit.priceUnitQuantity > 1
        ? saleUnit.priceUnitQuantity
        : null;
    const restoresSaleUnit =
      !appliesPresentation &&
      !item.is_weight_product &&
      saleUnit.unitsPerCapture > 1;
    const nextSaleUnitCode = restoresSaleUnit
      ? (saleUnit.captureUnit?.code ?? null)
      : null;
    const nextStockUnitsPerSaleUnit = restoresSaleUnit
      ? saleUnit.unitsPerCapture
      : null;

    // El spread arrastra el empaque ANTERIOR de la línea; el multiplicador tiene
    // que leer el NUEVO, o al pasar de "Rollo 20 m" a "Mayorista" seguiría
    // creyendo que la línea cuenta paquetes.
    const multiplier = resolveLineUnits({
      ...item,
      quantity,
      applied_price_tier_id: appliedTierId,
      is_package_unit: !!resolution.isPackageUnit,
      units_per_package: resolution.unitsPerPackage ?? null,
      price_unit_quantity: nextPriceUnitQuantity,
    });
    const taxAmount = this.roundMoney(
      (finalUnitPrice - unitPrice) * multiplier,
    );

    const updatedItems = [...currentState.items];
    updatedItems[itemIndex] = {
      ...item,
      quantity,
      sale_unit_code: nextSaleUnitCode,
      stock_units_per_sale_unit: nextStockUnitsPerSaleUnit,
      price_unit_quantity: nextPriceUnitQuantity,
      unitPrice,
      finalPrice: finalUnitPrice,
      originalFinalPrice: finalUnitPrice,
      totalPrice: this.roundMoney(finalUnitPrice * multiplier),
      taxAmount,
      taxRate,
      applied_price_tier_id: resolution.appliedPriceTierId ?? null,
      applied_price_tier_name: resolution.appliedPriceTierName ?? null,
      is_package_unit: !!resolution.isPackageUnit,
      units_per_package: resolution.unitsPerPackage ?? null,
      // Clear manual price-override flags — a tier change is system-driven.
      isPriceOverridden: false,
      priceOverrideReason: undefined,
    };

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(updatedItems, currentState.appliedDiscounts),
      updatedAt: new Date(),
    };
  }

  private processUpdateCartItemPrice(
    request: UpdateCartItemPriceRequest,
  ): CartState {
    const currentState = this.cartState();
    const itemIndex = currentState.items.findIndex(
      (item) => item.id === request.itemId,
    );

    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }
    if (request.finalPrice < 0) {
      throw new Error('El precio no puede ser negativo.');
    }

    const item = currentState.items[itemIndex];
    const taxRate = item.taxRate ?? this.calculateRateSum(item.product);
    const finalPrice = this.roundMoney(Number(request.finalPrice || 0));
    const unitPrice = taxRate > 0 ? finalPrice / (1 + taxRate) : finalPrice;
    const multiplier = resolveLineUnits(item);
    const taxAmount = (finalPrice - unitPrice) * multiplier;

    const updatedItems = [...currentState.items];
    updatedItems[itemIndex] = {
      ...item,
      unitPrice: this.roundMoney(unitPrice),
      finalPrice,
      totalPrice: this.roundMoney(finalPrice * multiplier),
      taxAmount: this.roundMoney(taxAmount),
      originalFinalPrice: item.originalFinalPrice ?? item.finalPrice,
      isPriceOverridden:
        item.itemType === 'custom'
          ? false
          : Math.abs(finalPrice - (item.originalFinalPrice ?? item.finalPrice)) >=
            0.01,
      priceOverrideReason: request.reason?.trim() || item.priceOverrideReason,
    };

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(
        updatedItems,
        currentState.appliedDiscounts,
      ),
      updatedAt: new Date(),
    };
  }

  /**
   * Process add to cart
   */
  private processAddToCart(request: AddToCartRequest): CartState {
    const currentState = this.cartState();

    // Check if this is a weight product
    const isWeightProduct = !!request.weight && request.weight > 0;

    // For weight products, we don't combine with existing items (different weights)
    // Identity: product.id + variant_id + weight (for weight products)
    // PLUS the cashier's stock-vs-KDS choice (skipKds). Bug 1 (Fase K):
    // two lines of the same product with different skipKds decisions
    // must NOT collapse into a single cart line, otherwise we lose the
    // decision when filtering `skipKds` for the fire-to-kitchen call.
    // QUI-653: `isTakeaway` tiene la MISMA propiedad y por eso entra en la
    // misma clave. Dos líneas del mismo plato, una para llevar y otra para
    // consumo en la mesa, son líneas distintas: fusionarlas perdería una de las
    // dos decisiones en silencio — exactamente el Bug 1 con otro flag.
    // QUI-431: serialized lines carry per-unit serial selections, so they must
    // NOT collapse into an existing cart line (merging would lose the mapping
    // between units and serials). A request with serials always starts a new line.
    // QUI-648: una línea pesada en balanza tampoco se fusiona. Cada pesada es
    // una pieza distinta (dos bandejas de 2,35 kg y 1,80 kg no son "una línea
    // de 4,15 kg" para el cajero, que necesita poder corregir la que se
    // equivocó volviendo a pesarla).
    const hasSerials =
      (request.serial_ids?.length ?? 0) > 0 ||
      (request.serial_numbers?.length ?? 0) > 0;
    const existingItemIndex =
      isWeightProduct || hasSerials || request.capturedByScale === true
        ? -1 // Don't combine weight items / serialized lines
        : currentState.items.findIndex(
            (item) =>
              item.product.id === request.product.id &&
              (item.variant_id || null) === (request.variant?.id || null) &&
              (item.skipKds ?? false) === (request.skipKds === true) &&
              (item.isTakeaway ?? false) === (request.isTakeaway === true) &&
              !(item.serial_ids?.length || item.serial_numbers?.length),
          );

    // Variant-aware pricing
    const basePrice = this.resolveUnitPrice(request.product, request.variant);
    // QUI-648: cómo se mide el producto. Sin unidad de stock declarada esto es
    // la configuración por pieza y toda la aritmética de abajo colapsa a la
    // histórica (`precio × cantidad`).
    const saleUnit = this.saleUnitService.configFor(request.product);
    const priceUnitQuantity =
      saleUnit.priceUnitQuantity > 1 ? saleUnit.priceUnitQuantity : null;
    let updatedItems: CartItem[];

    if (existingItemIndex >= 0) {
      // Update existing item
      const existingItem = currentState.items[existingItemIndex];
      const newQuantity = existingItem.quantity + request.quantity;
      const finalUnitPrice = this.calculateItemFinalPriceWithBase(request.product, basePrice);
      const mergedUnits = resolveLineUnits({
        ...existingItem,
        quantity: newQuantity,
      });

      updatedItems = [...currentState.items];
      updatedItems[existingItemIndex] = {
        ...existingItem,
        quantity: newQuantity,
        taxAmount: this.calculateItemTaxWithBase(request.product, basePrice, mergedUnits),
        finalPrice: finalUnitPrice,
        totalPrice: mergedUnits * finalUnitPrice,
        notes: request.notes || existingItem.notes,
      };
    } else {
      // Add new item
      const finalUnitPrice = request.variant
        ? this.calculateItemFinalPriceWithBase(request.product, basePrice)
        : (request.product.final_price || this.calculateItemFinalPrice(request.product));

      // Calculate total price for weight products
      const weight = request.weight || 1;
      const quantity = isWeightProduct ? 1 : request.quantity;
      // Multiplicador monetario único: peso capturado (legado), o cantidad
      // dividida por la escala del precio cuando el producto publica "$X por N
      // unidades". Con escala 1 es la cantidad, como siempre.
      //
      // Una línea recién agregada nunca es una presentación: el empaque solo lo
      // resuelve `processApplyTierToCartItem`, que vuelve a correr después
      // cuando el código pistoleado traía una (`applyScannedPresentation`).
      const lineUnits = resolveLineUnits({
        quantity,
        weight,
        is_weight_product: isWeightProduct,
        is_package_unit: false,
        units_per_package: null,
        price_unit_quantity: priceUnitQuantity,
      });
      const itemTotalPrice = finalUnitPrice * lineUnits;

      // For weight products, tax is calculated on the total (price * weight), not just price * quantity
      const taxMultiplier = lineUnits;
      const newItem: CartItem = {
        id: this.generateItemId(),
        itemType: 'product',
        product: request.product,
        quantity: quantity,
        unitPrice: basePrice,
        taxAmount: this.calculateItemTaxWithBase(request.product, basePrice, taxMultiplier),
        finalPrice: finalUnitPrice,
        originalFinalPrice: finalUnitPrice,
        totalPrice: itemTotalPrice,
        addedAt: new Date(),
        notes: request.notes,
        variant_id: request.variant?.id,
        variant_sku: request.variant?.sku ?? undefined,
        variant_attributes: request.variant?.attributes
          ?.map(a => `${a.attribute_name}: ${a.attribute_value}`).join(', '),
        variant_display_name: request.variant?.attributes
          ?.map(a => a.attribute_value).join(' / '),
        // Capture the variant's own image so the cart renders the right
        // thumbnail for colored/sized variants. Falls back to the product
        // image in the template when this is undefined.
        variant_image_url: request.variant?.image_url,
        // Weight product fields
        weight: isWeightProduct ? weight : undefined,
        weight_unit: isWeightProduct ? (request.weight_unit || 'kg') : undefined,
        is_weight_product: isWeightProduct,
        // QUI-648 — la escala en la que el cajero capturó y en la que se muestra
        // la línea. `quantity` sigue viviendo en la unidad mínima. Solo se
        // anota cuando hay conversión real: si la unidad de venta YA es la
        // mínima, la línea se lee como siempre.
        sale_unit_code:
          !isWeightProduct && saleUnit.unitsPerCapture > 1
            ? (saleUnit.captureUnit?.code ?? null)
            : null,
        stock_units_per_sale_unit:
          !isWeightProduct && saleUnit.unitsPerCapture > 1
            ? saleUnit.unitsPerCapture
            : null,
        price_unit_quantity: isWeightProduct ? null : priceUnitQuantity,
        captured_by_scale: request.capturedByScale === true,
        // Restaurant Suite — Fase K Gap 1: persist the cashier's
        // "usar stock" choice on the cart item. Filtered out of the
        // kitchen-fire call by the POS component.
        skipKds: request.skipKds === true,
        // QUI-653 — se persiste en la línea porque viaja a
        // `order_items.is_takeaway`: el ticket de cocina y el tiquete impreso lo
        // necesitan después del cobro, a diferencia de `skipKds`, que es
        // cart-local.
        isTakeaway: request.isTakeaway === true,
        // QUI-431: serials chosen for this serialized line (pool ids +
        // free-text). Threaded onto the order payload at checkout.
        serial_ids: request.serial_ids?.length ? request.serial_ids : undefined,
        serial_numbers: request.serial_numbers?.length
          ? request.serial_numbers
          : undefined,
      };
      updatedItems = [newItem, ...currentState.items];
    }

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(
        updatedItems,
        currentState.appliedDiscounts,
      ),
      updatedAt: new Date(),
    };
  }

  /**
   * Process update cart item
   */
  private processUpdateCartItem(request: UpdateCartItemRequest): CartState {
    const currentState = this.cartState();
    const itemIndex = currentState.items.findIndex(
      (item) => item.id === request.itemId,
    );

    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }

    const item = currentState.items[itemIndex];

    if (request.quantity <= 0) {
      return this.processRemoveFromCart(request.itemId);
    }

    const variant = item.variant_id
      ? item.product.product_variants?.find((v) => v.id === item.variant_id)
      : undefined;
    if (
      !item.is_weight_product &&
      this.doesLineTrackInventory(item.product, variant)
    ) {
      const maxQuantity = this.getMaxSellableQuantity(
        item.product,
        variant,
        !!item.is_package_unit,
        item.units_per_package ?? null,
      );
      if (request.quantity > maxQuantity) {
        const unitsHint =
          item.is_package_unit && item.units_per_package
            ? ` (${item.units_per_package} unidades por empaque)`
            : '';
        throw new Error(
          `Stock insuficiente. Máximo permitido: ${maxQuantity}${unitsHint}`,
        );
      }
    }

    const updatedItems = [...currentState.items];
    const finalUnitPrice = item.finalPrice;

    // Peso legado, presentación o escala de precio: un solo multiplicador.
    const lineUnits = resolveLineUnits({ ...item, quantity: request.quantity });
    const newTotalPrice = lineUnits * finalUnitPrice;
    const taxMultiplier = lineUnits;

    updatedItems[itemIndex] = {
      ...item,
      quantity: request.quantity,
      taxAmount: this.calculateItemTaxWithBase(item.product, item.unitPrice, taxMultiplier),
      finalPrice: finalUnitPrice,
      totalPrice: newTotalPrice,
      notes: request.notes || item.notes,
    };

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(
        updatedItems,
        currentState.appliedDiscounts,
      ),
      updatedAt: new Date(),
    };
  }

  /**
   * Process remove from cart
   */
  private processRemoveFromCart(itemId: string): CartState {
    const currentState = this.cartState();
    const updatedItems = currentState.items.filter(
      (item) => item.id !== itemId,
    );

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(
        updatedItems,
        currentState.appliedDiscounts,
      ),
      updatedAt: new Date(),
    };
  }

  /**
   * Process apply discount
   */
  private processApplyDiscount(request: ApplyDiscountRequest): CartState {
    const currentState = this.cartState();
    // Para descuentos, usamos el subtotal BRUTO (con IVA) tal como está en el carrito
    const subtotal = this.calculateSubtotal(currentState.items);

    let discountAmount = 0;
    if (request.type === 'percentage') {
      discountAmount = subtotal * (request.value / 100);
    } else {
      discountAmount = Math.min(request.value, subtotal);
    }

    const newDiscount: CartDiscount = {
      id: this.generateDiscountId(),
      type: request.type,
      value: request.value,
      description: request.description,
      amount: discountAmount,
      promotion_id: request.promotion_id,
    };

    const updatedDiscounts = [...currentState.appliedDiscounts, newDiscount];

    return {
      ...currentState,
      appliedDiscounts: updatedDiscounts,
      summary: this.calculateSummary(currentState.items, updatedDiscounts),
      updatedAt: new Date(),
    };
  }

  /**
   * Process remove discount
   */
  private processRemoveDiscount(discountId: string): CartState {
    const currentState = this.cartState();
    const updatedDiscounts = currentState.appliedDiscounts.filter(
      (discount) => discount.id !== discountId,
    );

    return {
      ...currentState,
      appliedDiscounts: updatedDiscounts,
      summary: this.calculateSummary(currentState.items, updatedDiscounts),
      updatedAt: new Date(),
    };
  }

  /**
   * Calculate cart summary
   */
  private calculateSummary(
    items: CartItem[],
    discounts: CartDiscount[],
  ): CartSummary {
    const grossTotal = this.calculateSubtotal(items); // Gross Total (with tax)
    const discountAmount = discounts.reduce(
      (total, discount) => total + discount.amount,
      0,
    );
    const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);

    // Subtotal should be Net Amount (without tax) for display
    const subtotal = grossTotal - taxAmount;

    // Total is based on Gross Total minus Discounts
    const total = grossTotal - discountAmount;
    const itemCount = items.length;
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

    // Preserve the last backend-resolved withholding so the line does not flash
    // to 0 between an item change and the debounced preview recompute. The
    // reactive preview re-fires whenever subtotal/IVA/customer change.
    const previousSummary = this.cartState().summary;

    return {
      subtotal,
      taxAmount,
      discountAmount,
      total,
      itemCount,
      totalItems,
      withholdingAmount: previousSummary?.withholdingAmount ?? 0,
      withholdingLines: previousSummary?.withholdingLines,
    };
  }

  /**
   * Calculate subtotal
   */
  private calculateSubtotal(items: CartItem[]): number {
    return items.reduce((sum, item) => sum + item.totalPrice, 0);
  }

  private calculatePromotionApplicableTotal(promo: any, items: CartItem[]): number {
    if (promo.scope === 'product') {
      const promoProductIds = (promo.promotion_products || [])
        .map((pp: any) => Number(pp.product_id))
        .filter((id: number) => Number.isFinite(id));

      return items
        .filter((item) => promoProductIds.includes(Number(item.product.id)))
        .reduce((sum, item) => sum + item.totalPrice, 0);
    }

    if (promo.scope === 'category') {
      const promoCategoryIds = (promo.promotion_categories || [])
        .map((pc: any) => Number(pc.category_id))
        .filter((id: number) => Number.isFinite(id));

      return items
        .filter((item) =>
          this.getItemCategoryIds(item).some((categoryId) =>
            promoCategoryIds.includes(categoryId),
          ),
        )
        .reduce((sum, item) => sum + item.totalPrice, 0);
    }

    return this.calculateSubtotal(items);
  }

  private getItemCategoryIds(item: CartItem): number[] {
    const product = item.product as any;
    const categoryIds = Array.isArray(product.category_ids)
      ? product.category_ids
      : product.category_id
        ? [product.category_id]
        : [];

    return categoryIds
      .map((categoryId: string | number) => Number(categoryId))
      .filter((categoryId: number) => Number.isFinite(categoryId));
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  /**
   * Calculate tax for a single item
   */
  private calculateItemTax(product: any, quantity: number): number {
    const rateSum = this.calculateRateSum(product);
    return product.price * quantity * rateSum;
  }

  /**
   * Calculate final price for a single item (unit)
   */
  private calculateItemFinalPrice(product: any): number {
    if (product.final_price) return product.final_price;
    const rateSum = this.calculateRateSum(product);
    return product.price * (1 + rateSum);
  }

  /**
   * Calculate tax with a specific base price (for variants)
   */
  private calculateItemTaxWithBase(product: any, basePrice: number, quantity: number): number {
    const rateSum = this.calculateRateSum(product);
    return basePrice * quantity * rateSum;
  }

  /**
   * Calculate final price with a specific base price (for variants)
   */
  private calculateItemFinalPriceWithBase(product: any, basePrice: number): number {
    const rateSum = this.calculateRateSum(product);
    return basePrice * (1 + rateSum);
  }

  /**
   * Helper to calculate sum of tax rates.
   * Tax rates are stored as decimals in DB (e.g., 0.19 for 19%) — do NOT divide by 100.
   */
  private calculateRateSum(product: any): number {
    return (
      product.tax_assignments?.reduce((rateSum: number, assignment: any) => {
        const assignmentRate =
          assignment.tax_categories?.tax_rates?.reduce(
            (sum: number, tr: any) => sum + parseFloat(tr.rate || '0'),
            0,
          ) || 0;
        return rateSum + assignmentRate;
      }, 0) || 0
    );
  }

  private calculateTaxCategoryRate(
    taxCategory?: { tax_rates?: Array<{ rate: string | number }> } | null,
  ): number {
    return (
      taxCategory?.tax_rates?.reduce(
        (sum, rate) => sum + Number(rate.rate || 0),
        0,
      ) || 0
    );
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  /**
   * Validate add to cart request
   */
  private validateAddToCartRequest(
    request: AddToCartRequest,
  ): CartValidationError[] {
    const errors: CartValidationError[] = [];

    if (!request.product) {
      errors.push({ field: 'product', message: 'Producto es requerido' });
    }

    if (!request.quantity || request.quantity <= 0) {
      errors.push({
        field: 'quantity',
        message: 'Cantidad debe ser mayor a 0',
      });
    }

    if (request.product && request.product.price <= 0) {
      errors.push({
        field: 'price',
        message: 'El producto debe tener un precio mayor a 0',
      });
    }

    // Only validate stock when the line effectively tracks inventory
    if (this.doesLineTrackInventory(request.product, request.variant)) {
      const availableStock = this.getAvailableStock(
        request.product,
        request.variant,
      );

      // Check current cart quantity for this product+variant combo
      const currentState = this.cartState();
      const existingItem = currentState.items.find(
        (item) =>
          item.product.id === request.product.id &&
          (item.variant_id || null) === (request.variant?.id || null),
      );
      const currentCartQuantity = existingItem ? existingItem.quantity : 0;
      const totalRequestedQuantity = currentCartQuantity + request.quantity;
      const requiredPerUnit = existingItem
        ? this.getRequiredStockPerUnit(
            existingItem.product,
            !!existingItem.is_package_unit,
            existingItem.units_per_package ?? null,
          )
        : 1;
      const totalRequiredStock = totalRequestedQuantity * requiredPerUnit;

      if (request.product && totalRequiredStock > availableStock) {
        const packageHint =
          requiredPerUnit > 1 ? ` (${requiredPerUnit} unidades por empaque)` : '';
        errors.push({
          field: 'quantity',
          message: currentCartQuantity > 0
            ? `Stock insuficiente. Ya tienes ${currentCartQuantity} en el carrito${packageHint}. Disponible: ${availableStock} unidades`
            : `Stock insuficiente. Disponible: ${availableStock} unidades`,
        });
      }
    }

    return errors;
  }

  private doesLineTrackInventory(
    product: Product,
    variant?: PosProductVariant,
  ): boolean {
    return variant?.track_inventory_override ?? product.track_inventory ?? true;
  }

  private isTierEnabledForProduct(product: Product, tierId: number): boolean {
    const enabledIds = product.enabled_price_tier_ids ?? [];
    return enabledIds.map(Number).includes(Number(tierId));
  }

  private getAvailableStock(
    product: Product,
    variant?: PosProductVariant,
  ): number {
    if (variant) return Number(variant.stock ?? 0);
    return Number(product.stock ?? 0);
  }

  /**
   * Stock units consumed per cart line unit. Packaging is now TIER-OWNED:
   * when the applied tier resolves a pack size > 1, each cart `quantity`
   * counts a PACKAGE and consumes `units_per_package` stock units.
   */
  private getRequiredStockPerUnit(
    _product: Product,
    isPackageUnit: boolean,
    unitsPerPackage?: number | null,
  ): number {
    if (!isPackageUnit) {
      return 1;
    }
    const units = Number(unitsPerPackage ?? 1);
    return Number.isFinite(units) && units > 1 ? units : 1;
  }

  private getMaxSellableQuantity(
    product: Product,
    variant: PosProductVariant | undefined,
    isPackageUnit: boolean,
    unitsPerPackage?: number | null,
  ): number {
    if (!this.doesLineTrackInventory(product, variant)) return 999;
    const availableStock = this.getAvailableStock(product, variant);
    const requiredStockPerUnit = this.getRequiredStockPerUnit(
      product,
      isPackageUnit,
      unitsPerPackage,
    );
    return Math.max(0, Math.floor(availableStock / requiredStockPerUnit));
  }

  private resolveUnitPrice(product: Product, variant?: PosProductVariant): number {
    const resolution = this.priceResolver.resolve(
      {
        id: product.id,
        base_price: product.price,
        is_on_sale: product.is_on_sale ?? false,
        sale_price: product.sale_price ?? null,
        track_inventory: product.track_inventory ?? true,
      },
      variant
        ? {
            id: variant.id.toString(),
            price_override: variant.price_override ?? null,
            is_on_sale: variant.is_on_sale ?? false,
            sale_price: variant.sale_price ?? null,
            track_inventory_override: variant.track_inventory_override ?? null,
          }
        : undefined,
    );
    return resolution.unitPrice;
  }

  /**
   * Validate discount request
   */
  private validateDiscountRequest(
    request: ApplyDiscountRequest,
  ): CartValidationError[] {
    const errors: CartValidationError[] = [];
    const currentState = this.cartState();
    const subtotal = this.calculateSubtotal(currentState.items);

    if (subtotal <= 0) {
      errors.push({
        field: 'discount',
        message: 'No se puede aplicar descuento a carrito vacío',
      });
    }

    if (
      request.type === 'percentage' &&
      (request.value <= 0 || request.value > 100)
    ) {
      errors.push({
        field: 'value',
        message: 'Porcentaje debe estar entre 0 y 100',
      });
    }

    if (request.type === 'fixed' && request.value <= 0) {
      errors.push({
        field: 'value',
        message: 'Monto de descuento debe ser mayor a 0',
      });
    }

    if (request.type === 'fixed' && request.value > subtotal) {
      errors.push({
        field: 'value',
        message: 'Descuento no puede ser mayor al subtotal',
      });
    }

    return errors;
  }

  /**
   * Get initial cart state
   */
  private getInitialState(): CartState {
    return {
      items: [],
      customer: null,
      notes: '',
      appliedDiscounts: [],
      pendingBookings: [],
      summary: {
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: 0,
        itemCount: 0,
        totalItems: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Generate unique item ID
   */
  private generateItemId(): string {
    return 'ITEM_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  private generateCustomProductId(): string {
    return (
      'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    );
  }

  /**
   * Generate unique discount ID
   */
  private generateDiscountId(): string {
    return 'DISC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }
}
