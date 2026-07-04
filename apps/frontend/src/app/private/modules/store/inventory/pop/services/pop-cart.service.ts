import {Injectable, signal, DestroyRef, inject} from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import {toObservable, takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {
  map,
  tap,
  catchError,
  debounceTime,
  distinctUntilChanged,
  switchMap,
} from 'rxjs/operators';
import {
  LotInfo,
  PreBulkData,
  PopProduct,
  PopProductVariant,
  PopSupplier,
  PopLocation,
  ShippingMethod,
  PaymentTermPreset,
  PopCartItem,
  PopCartSummary,
  PopCartState,
  AddToPopCartRequest,
  UpdatePopCartItemRequest,
} from '../interfaces/pop-cart.interface';
import { PurchaseOrder } from '../../interfaces';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { WithholdingPreviewResult } from '../../../withholding-tax/interfaces/withholding.interface';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

/**
 * Lot/Batch information for purchase order items (extended for service use)
 */
export interface PopCartItemLotInfo {
  batch_number?: string;
  manufacturing_date?: Date;
  expiration_date?: Date;
}

/**
 * IVA cycle (F1): default tax rate (%) seeded on NEW cart lines. Standard
 * Colombian IVA is 19%. Fully editable per line (0 for exempt). Named so the
 * default is trivial to change / wire to a store setting later.
 */
const DEFAULT_PURCHASE_TAX_RATE = 19;

const INITIAL_STATE: PopCartState = {
  items: [],
  summary: {
    subtotal: 0,
    tax_amount: 0,
    shipping_cost: 0,
    total: 0,
    itemCount: 0,
    totalItems: 0,
  },
  // IVA cycle (F1): default dominant mode. `false` = tax is ADDED on top of
  // net prices (the common Colombian B2B purchase-invoice layout). The header
  // toggle flips this to `true` for IVA-included prices.
  prices_include_tax: false,
  supplierId: null,
  locationId: null,
  orderDate: new Date(),
  expectedDate: undefined,
  shippingMethod: undefined,
  shippingCost: 0,
  paymentTerms: undefined,
  notes: '',
  internalNotes: '',
  status: 'draft',
  createdAt: new Date(),
  updatedAt: new Date(),
};

@Injectable({
  providedIn: 'root',
})
export class PopCartService {
  private destroyRef = inject(DestroyRef);
  private withholdingService = inject(WithholdingTaxService);
  private authFacade = inject(AuthFacade);
  private _cartState = signal<PopCartState>(INITIAL_STATE);
  private _loading = signal<boolean>(false);
  public cartState$ = toObservable(this._cartState);
  public loading$ = toObservable(this._loading);

  constructor() {
    this.initWithholdingPreview();
  }

  /**
   * Reactive withholding preview (role='practiced' — the tenant withholds the
   * SUPPLIER on a purchase). Fires the backend preview ONLY when the inputs
   * change (supplier, base subtotal, IVA), with debounce + switchMap to avoid
   * spamming and to cancel stale requests. Backend is the single source of
   * truth; we only store the resolved `total_withholding`. Never throws — a
   * failed preview leaves the total untouched (withholding 0).
   */
  private initWithholdingPreview(): void {
    this.cartState$
      .pipe(
        map((state) => {
          const supplierId = Number(state.supplierId ?? 0) || 0;
          const base = Number(state.summary.subtotal ?? 0) || 0;
          const ivaAmount = Number(state.summary.tax_amount ?? 0) || 0;
          return { supplierId, base, ivaAmount };
        }),
        distinctUntilChanged(
          (a, b) =>
            a.supplierId === b.supplierId &&
            a.base === b.base &&
            a.ivaAmount === b.ivaAmount,
        ),
        debounceTime(300),
        switchMap(({ supplierId, base, ivaAmount }) => {
          // Fiscal gate: retefuente is an `accounting` subfeature. Skip the
          // preview entirely when the tenant's accounting area is not ACTIVE/
          // LOCKED. `activeFiscalAreas()` already resolves store-vs-org by
          // `fiscal_scope`, and its initialValue [] keeps the default safe
          // (no fiscal call while the fiscal status is still unknown).
          const fiscalActive = this.authFacade
            .activeFiscalAreas()
            .includes('accounting');
          // No fiscal ops, no counterparty, or no base → no call, reset to 0.
          if (!fiscalActive || supplierId <= 0 || base <= 0) {
            return of({ lines: [], total_withholding: 0 });
          }
          return this.withholdingService.previewWithholding({
            role: 'practiced',
            supplier_id: supplierId,
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
    const current = this.currentState;
    const amount = Number(result?.total_withholding ?? 0) || 0;
    const lines = result?.lines ?? [];
    if (
      (current.summary.withholding_amount ?? 0) === amount &&
      (current.summary.withholding_lines?.length ?? 0) === lines.length
    ) {
      return; // No-op: avoids a redundant signal write / re-render loop.
    }
    this._cartState.set({
      ...current,
      summary: {
        ...current.summary,
        withholding_amount: amount,
        withholding_lines: lines,
      },
    });
  }

  get currentState(): PopCartState {
    return this._cartState();
  }

  // Observable getters for convenience
  get items$(): Observable<PopCartItem[]> {
    return this.cartState$.pipe(map((state) => state.items));
  }

  get summary$(): Observable<PopCartSummary> {
    return this.cartState$.pipe(map((state) => state.summary));
  }

  get isEmpty$(): Observable<boolean> {
    return this.cartState$.pipe(map((state) => state.items.length === 0));
  }

  /**
   * Add product to cart
   */
  addToCart(request: AddToPopCartRequest): Observable<PopCartState> {
    this._loading.set(true);

    return of(request).pipe(
      map((req) => this.processAddToCart(req)),
      tap((newState) => {
        this._cartState.set(newState);
        this._loading.set(false);
      }),
      catchError((error) => {
        this._loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Update cart item
   */
  updateCartItem(request: UpdatePopCartItemRequest): Observable<PopCartState> {
    this._loading.set(true);

    return of(request).pipe(
      map((req) => this.processUpdateCartItem(req)),
      tap((newState) => {
        this._cartState.set(newState);
        this._loading.set(false);
      }),
      catchError((error) => {
        this._loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Remove item from cart by ID
   */
  removeFromCart(itemId: string): Observable<PopCartState> {
    this._loading.set(true);

    return of(itemId).pipe(
      map((id) => this.processRemoveFromCart(id)),
      tap((newState) => {
        this._cartState.set(newState);
        this._loading.set(false);
      }),
      catchError((error) => {
        this._loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Remove item from cart by index
   */
  removeItem(index: number) {
    const currentItems = [...this.currentState.items];
    currentItems.splice(index, 1);
    this.updateState({ items: currentItems });
  }

  /**
   * Clear entire cart
   */
  clearCart(): Observable<PopCartState> {
    this._loading.set(true);

    return of(null).pipe(
      map(() => ({
        ...INITIAL_STATE,
        orderDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      tap((newState) => {
        this._cartState.set(newState);
        this._loading.set(false);
      }),
    );
  }

  /**
   * Set supplier for order
   */
  setSupplier(supplierId: number | null) {
    this.updateState({ supplierId });
  }

  /**
   * Set location/warehouse for order
   */
  setLocation(locationId: number | null) {
    this.updateState({ locationId });
  }

  /**
   * Set order date
   */
  setOrderDate(date: Date) {
    this.updateState({ orderDate: date });
  }

  /**
   * Set expected delivery date
   */
  setExpectedDate(date: Date | undefined) {
    this.updateState({ expectedDate: date });
  }

  /**
   * Set shipping method
   */
  setShippingMethod(method: ShippingMethod | undefined) {
    this.updateState({ shippingMethod: method });
  }

  /**
   * Set shipping cost
   */
  setShippingCost(cost: number) {
    this.updateState({ shippingCost: cost });
  }

  /**
   * Set payment terms
   */
  setPaymentTerms(terms: string | undefined) {
    this.updateState({ paymentTerms: terms });
  }

  /**
   * Update order notes
   */
  setNotes(notes: string) {
    this.updateState({ notes: notes.trim() });
  }

  /**
   * Update internal notes
   */
  setInternalNotes(notes: string) {
    this.updateState({ internalNotes: notes.trim() });
  }

  /**
   * Add item (legacy method for compatibility)
   */
  addItem(product: any, quantity: number = 1) {
    this.addToCart({
      product,
      quantity,
      unit_cost: product.cost || 0,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  /**
   * Update item quantity (legacy method for compatibility)
   */
  updateItemQuantity(index: number, quantity: number) {
    const currentItems = [...this.currentState.items];
    if (currentItems[index]) {
      this.updateCartItem({
        itemId: currentItems[index].id,
        quantity,
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
  }

  /**
   * Update item cost (legacy method for compatibility)
   */
  updateItemCost(index: number, cost: number) {
    const currentItems = [...this.currentState.items];
    if (currentItems[index]) {
      this.updateCartItem({
        itemId: currentItems[index].id,
        unit_cost: cost,
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
  }

  /**
   * Update item batch info (legacy method for compatibility)
   */
  updateItemBatchInfo(
    index: number,
    batchInfo: { batch_number: string; expiry_date?: string },
  ) {
    const currentItems = [...this.currentState.items];
    if (currentItems[index]) {
      const lotInfo: PopCartItemLotInfo = {
        batch_number: batchInfo.batch_number,
        expiration_date: batchInfo.expiry_date
          ? new Date(batchInfo.expiry_date)
          : undefined,
      };
      this.updateCartItem({
        itemId: currentItems[index].id,
        lot_info: lotInfo,
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
  }

  /**
   * Update lot information for an item by ID
   */
  updateItemLotInfo(
    itemId: string,
    lotInfo: PopCartItemLotInfo | undefined,
  ): Observable<PopCartState> {
    return of({ itemId, lotInfo }).pipe(
      map(({ itemId, lotInfo }) => {
        const currentState = this.currentState;
        const itemIndex = currentState.items.findIndex(
          (item) => item.id === itemId,
        );

        if (itemIndex === -1) {
          throw new Error('Item not found in cart');
        }

        const updatedItems = [...currentState.items];
        updatedItems[itemIndex] = {
          ...updatedItems[itemIndex],
          lot_info: lotInfo,
        };

        return {
          ...currentState,
          items: updatedItems,
          updatedAt: new Date(),
        };
      }),
      tap((newState) => this._cartState.set(newState)),
    );
  }

  /**
   * Get item by ID
   */
  getItemById(itemId: string): PopCartItem | null {
    return this.currentState.items.find((item) => item.id === itemId) || null;
  }

  /**
   * Check if product is in cart
   */
  isProductInCart(productId: number): boolean {
    return this.currentState.items.some(
      (item) => item.product.id === productId && !item.is_prebulk,
    );
  }

  /**
   * Get item quantity for product
   */
  getProductQuantity(productId: number): number {
    const item = this.currentState.items.find(
      (item) => item.product.id === productId && !item.is_prebulk,
    );
    return item ? item.quantity : 0;
  }

  /**
   * Process add to cart
   */
  private processAddToCart(request: AddToPopCartRequest): PopCartState {
    const currentState = this.currentState;

    // For pre-bulk items, always add as new (no duplicate check)
    if (request.is_prebulk) {
      const newItem: PopCartItem = {
        id: this.generateItemId(),
        product: request.product,
        quantity: request.quantity,
        unit_cost: request.unit_cost,
        discount: 0,
        // IVA cycle (F1): seed the standard IVA rate + type. `prices_include_tax`
        // stays undefined so the line inherits the header mode.
        tax_rate: DEFAULT_PURCHASE_TAX_RATE,
        tax_type: 'iva',
        prices_include_tax: undefined,
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        lot_info: request.lot_info,
        notes: request.notes,
        is_prebulk: true,
        prebulk_data: request.prebulk_data,
        // Fase 4: UoM preseleccionadas (scanner uom_hint) — sugerencia.
        purchase_uom_id: request.purchase_uom_id ?? null,
        stock_uom_id: request.stock_uom_id ?? null,
        addedAt: new Date(),
      };
      this.recalculateItemTotals(newItem, currentState.prices_include_tax);
      const updatedItems = [newItem, ...currentState.items];
      return {
        ...currentState,
        items: updatedItems,
        summary: this.calculateSummary(updatedItems),
        updatedAt: new Date(),
      };
    }

    // For regular products, check if already in cart (same product + same variant)
    const existingItemIndex = currentState.items.findIndex(
      (item) =>
        item.product.id === request.product.id &&
        !item.is_prebulk &&
        (item.variant?.id ?? null) === (request.variant?.id ?? null),
    );

    let updatedItems: PopCartItem[];

    if (existingItemIndex >= 0) {
      // Update existing item
      const existingItem = currentState.items[existingItemIndex];
      const newQuantity = existingItem.quantity + request.quantity;

      updatedItems = [...currentState.items];
      updatedItems[existingItemIndex] = {
        ...existingItem,
        quantity: newQuantity,
        lot_info: request.lot_info || existingItem.lot_info,
        notes: request.notes || existingItem.notes,
      };
      this.recalculateItemTotals(
        updatedItems[existingItemIndex],
        currentState.prices_include_tax,
      );
    } else {
      // Add new item
      const newItem: PopCartItem = {
        id: this.generateItemId(),
        product: request.product,
        variant: request.variant,
        quantity: request.quantity,
        unit_cost: request.unit_cost,
        discount: 0,
        // IVA cycle (F1): seed the standard IVA rate + type; inherit header mode.
        tax_rate: DEFAULT_PURCHASE_TAX_RATE,
        tax_type: 'iva',
        prices_include_tax: undefined,
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        lot_info: request.lot_info,
        notes: request.notes,
        is_prebulk: false,
        // Fase 4: UoM preseleccionadas (scanner uom_hint) — sugerencia.
        purchase_uom_id: request.purchase_uom_id ?? null,
        stock_uom_id: request.stock_uom_id ?? null,
        addedAt: new Date(),
      };
      this.recalculateItemTotals(newItem, currentState.prices_include_tax);
      updatedItems = [newItem, ...currentState.items];
    }

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(updatedItems),
      updatedAt: new Date(),
    };
  }

  /**
   * Process update cart item
   */
  private processUpdateCartItem(request: UpdatePopCartItemRequest): PopCartState {
    const currentState = this.currentState;
    const itemIndex = currentState.items.findIndex(
      (item) => item.id === request.itemId,
    );

    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }

    const item = currentState.items[itemIndex];

    if (request.quantity !== undefined && request.quantity <= 0) {
      return this.processRemoveFromCart(request.itemId);
    }

    const updatedItems = [...currentState.items];
    const updatedItem = {
      ...item,
      quantity: request.quantity ?? item.quantity,
      unit_cost: request.unit_cost ?? item.unit_cost,
      lot_info: request.lot_info ?? item.lot_info,
      notes: request.notes ?? item.notes,
    };

    // Update variant if provided
    if (request.variant !== undefined) {
      updatedItem.variant = request.variant === null ? undefined : request.variant;
    }

    // Update pricing_type if provided
    if (request.pricing_type) {
      updatedItem.product = { ...updatedItem.product, pricing_type: request.pricing_type };
    }

    updatedItems[itemIndex] = updatedItem;
    this.recalculateItemTotals(
      updatedItems[itemIndex],
      currentState.prices_include_tax,
    );

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(updatedItems),
      updatedAt: new Date(),
    };
  }

  /**
   * Process remove from cart
   */
  private processRemoveFromCart(itemId: string): PopCartState {
    const currentState = this.currentState;
    const updatedItems = currentState.items.filter(
      (item) => item.id !== itemId,
    );

    return {
      ...currentState,
      items: updatedItems,
      summary: this.calculateSummary(updatedItems),
      updatedAt: new Date(),
    };
  }

  /**
   * IVA cycle (F1): recalculate a line's NET subtotal / IVA / total using the
   * pinned derivation formula. The backend remains the single source of truth
   * for the persisted split; this is a client-side PREVIEW only.
   *
   * effective_include = item.prices_include_tax ?? header.prices_include_tax
   * r = tax_rate / 100
   *  - included:  unit_price_net = unit_price / (1 + r);
   *               line_tax = (unit_price - unit_price_net) * quantity
   *  - added:     unit_price_net = unit_price;
   *               line_tax = unit_price * r * quantity
   *
   * A per-line discount (%) is applied to the gross unit price BEFORE the
   * include/added branch, so a discounted line stays consistent (discount is
   * 0 for the common path where no discount UI is exposed).
   */
  private recalculateItemTotals(
    item: PopCartItem,
    headerPricesIncludeTax: boolean,
  ): void {
    const quantity = Number(item.quantity) || 0;
    const unitCost = Number(item.unit_cost) || 0;
    const discountPct = Number(item.discount) || 0;
    const taxRate = Number(item.tax_rate) || 0;
    const r = taxRate / 100;

    // Discount applies to the gross unit price first.
    const grossUnit = unitCost * (1 - discountPct / 100);

    // Per-line override wins over the header mode (mixed invoices).
    const effectiveInclude = item.prices_include_tax ?? headerPricesIncludeTax;

    let unitNet: number;
    let lineTax: number;
    if (effectiveInclude) {
      unitNet = r > 0 ? grossUnit / (1 + r) : grossUnit;
      lineTax = (grossUnit - unitNet) * quantity;
    } else {
      unitNet = grossUnit;
      lineTax = grossUnit * r * quantity;
    }

    item.subtotal = unitNet * quantity; // NET line subtotal
    item.tax_amount = lineTax; // IVA for the line
    item.total = item.subtotal + item.tax_amount;
  }

  /**
   * IVA cycle (F1): set the header-level dominant mode (whether captured
   * prices include tax). Recomputes every line that inherits the header
   * (lines with an explicit per-line override keep their own mode).
   */
  setPricesIncludeTax(value: boolean): void {
    const current = this.currentState;
    const items = current.items.map((item) => {
      const clone = { ...item };
      this.recalculateItemTotals(clone, value);
      return clone;
    });
    this.updateState({ prices_include_tax: value, items });
  }

  /**
   * IVA cycle (F1): set a line's tax rate (%). Clamps to a non-negative
   * finite number and recomputes the line against the current header mode.
   */
  setItemTaxRate(itemId: string, rate: number): void {
    const safe = Number.isFinite(Number(rate)) && Number(rate) >= 0 ? Number(rate) : 0;
    this.mutateItem(itemId, (item) => {
      item.tax_rate = safe;
    });
  }

  /** IVA cycle (F1): set a line's tax classification (defaults to 'iva'). */
  setItemTaxType(itemId: string, taxType: string): void {
    this.mutateItem(itemId, (item) => {
      item.tax_type = taxType || 'iva';
    });
  }

  /**
   * IVA cycle (F1): set a line's per-line override of the header mode.
   * Pass `undefined` to CLEAR the override (line follows the header again).
   */
  setItemPricesIncludeTax(itemId: string, value: boolean | undefined): void {
    this.mutateItem(itemId, (item) => {
      item.prices_include_tax = value;
    });
  }

  /**
   * IVA cycle (F1): immutably patch a single line, recompute its totals
   * against the current header mode, and refresh the summary.
   */
  private mutateItem(
    itemId: string,
    mutator: (item: PopCartItem) => void,
  ): void {
    const current = this.currentState;
    const index = current.items.findIndex((i) => i.id === itemId);
    if (index === -1) return;
    const items = [...current.items];
    const updated = { ...items[index] };
    mutator(updated);
    this.recalculateItemTotals(updated, current.prices_include_tax);
    items[index] = updated;
    this.updateState({ items });
  }

  /**
   * Calculate summary from items
   */
  private calculateSummary(items: PopCartItem[]): PopCartSummary {
    // Preserve the last backend-resolved withholding so the line does not flash
    // to 0 between an item change and the debounced preview recompute. The
    // reactive preview re-fires whenever subtotal/IVA/supplier change.
    const previousSummary = this.currentState.summary;

    return items.reduce(
      (acc, item) => {
        acc.subtotal += item.subtotal;
        acc.tax_amount += item.tax_amount;
        acc.total += item.total;
        acc.itemCount += item.quantity;
        return acc;
      },
      {
        subtotal: 0,
        tax_amount: 0,
        shipping_cost: this.currentState.shippingCost,
        total: this.currentState.shippingCost,
        itemCount: 0,
        totalItems: 0,
        withholding_amount: previousSummary?.withholding_amount ?? 0,
        withholding_lines: previousSummary?.withholding_lines,
      },
    );
  }

  /**
   * Update state with recalculations
   */
  private updateState(partialState: Partial<PopCartState>) {
    const currentState = this.currentState;
    const newState = { ...currentState, ...partialState, updatedAt: new Date() };

    // Always recalculate summary if items changed
    if (partialState.items || partialState.shippingCost !== undefined) {
      newState.summary = this.calculateSummary(newState.items);
    }

    this._cartState.set(newState);
  }


  /**
   * Load an existing purchase order into the cart
   */
  loadOrder(order: PurchaseOrder): void {
    // IVA cycle (F1): restore the header dominant mode from the order (falls
    // back to the safe default when the order predates the IVA cycle).
    const headerInclude: boolean =
      (order as any).prices_include_tax ?? INITIAL_STATE.prices_include_tax;
    const rawItems = order.purchase_order_items || order.items || [];
    const items: PopCartItem[] = rawItems.map(item => {
      const product = item.products || item.product;
      const popProduct: PopProduct = {
        id: product?.id || item.product_id,
        name: product?.name || 'Unknown Product',
        code: product?.sku || '',
        cost: item.unit_cost || item.unit_price,
        price: 0,
        stock: 0,
        is_active: true
      };

      // Restore variant info from purchase order item
      const variantData = item.product_variants;
      let variant: PopProductVariant | undefined;
      if (item.product_variant_id && variantData) {
        variant = {
          id: variantData.id || item.product_variant_id,
          name: variantData.name,
          sku: variantData.sku || '',
          cost_price: variantData.cost_price,
          stock_quantity: variantData.stock_quantity,
          attributes: variantData.attributes,
        };
      }

      // Restore lot/batch info from purchase order item
      let lotInfo: LotInfo | undefined;
      if (item.batch_number || item.manufacturing_date || item.expiration_date) {
        lotInfo = {
          batch_number: item.batch_number,
          manufacturing_date: item.manufacturing_date ? new Date(item.manufacturing_date) : undefined,
          expiration_date: item.expiration_date ? new Date(item.expiration_date) : undefined,
        };
      }

      const cartItem: PopCartItem = {
        id: this.generateItemId(),
        product: popProduct,
        variant,
        quantity: item.quantity_ordered || item.quantity,
        unit_cost: item.unit_cost || item.unit_price,
        discount: item.discount_percentage || 0,
        tax_rate: item.tax_rate || 0,
        // IVA cycle (F1): restore tax classification and per-line override.
        tax_type: (item as any).tax_type ?? 'iva',
        prices_include_tax: (item as any).prices_include_tax ?? undefined,
        subtotal: ((item.quantity_ordered || item.quantity) * (item.unit_cost || item.unit_price)),
        tax_amount: 0,
        total: 0,
        lot_info: lotInfo,
        notes: item.notes,
        is_prebulk: false,
        addedAt: new Date()
      };

      this.recalculateItemTotals(cartItem, headerInclude);
      return cartItem;
    });

    const newState: PopCartState = {
      ...INITIAL_STATE,
      orderId: order.id,
      prices_include_tax: headerInclude,
      items: items,
      supplierId: order.supplier_id,
      locationId: order.location_id,
      orderDate: order.order_date ? new Date(order.order_date) : new Date(),
      expectedDate: order.expected_date ? new Date(order.expected_date) : undefined,
      shippingMethod: order.shipping_method as any || undefined,
      shippingCost: order.shipping_cost || 0,
      paymentTerms: order.payment_terms,
      notes: order.notes || '',
      internalNotes: '',
      status: order.status === 'draft' ? 'draft' : 'submitted',
      updatedAt: new Date()
    };

    this.updateState(newState);
  }

  /**
   * Generate unique item ID
   */
  private generateItemId(): string {
    return 'POP_ITEM_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }
}

// Export types for use in components
export type { ShippingMethod, PaymentTermPreset, LotInfo, PreBulkData, PopSupplier, PopLocation, PopProduct, PopProductVariant };
export type { PopCartItem, PopCartSummary, PopCartState, AddToPopCartRequest, UpdatePopCartItemRequest };
