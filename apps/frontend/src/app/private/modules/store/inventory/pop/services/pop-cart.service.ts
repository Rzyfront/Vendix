import { Injectable, signal, DestroyRef, inject, effect } from '@angular/core';
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
import {
  deriveLineTax,
  derivePurchaseTotals,
} from '../utils/purchase-line-tax.util';
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
    discount_amount: 0,
    shipping_cost: 0,
    total: 0,
    itemCount: 0,
    totalItems: 0,
  },
  // IVA cycle (F1): default dominant mode. `false` = tax is ADDED on top of
  // net prices (the common Colombian B2B purchase-invoice layout). The header
  // toggle flips this to `true` for IVA-included prices.
  prices_include_tax: false,
  // IVA cycle — maestro "¿Esta compra tiene IVA?". Apagado por defecto: cero
  // IVA hasta que el usuario lo encienda (o el escáner detecte IVA).
  has_vat: false,
  supplierId: null,
  locationId: null,
  orderDate: new Date(),
  // F3 defaults: fecha de entrega = hoy y método de envío = recolección (pickup).
  expectedDate: new Date(),
  shippingMethod: 'pickup',
  shippingCost: 0,
  // C.5 — sin flete no hay modo que declarar. El backend rechaza `prorate`
  // sin flete tanto como un flete sin modo, así que el default es "ausente".
  shippingCostAllocation: undefined,
  discountAmount: 0,
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
  private static readonly STORAGE_PREFIX = 'vendix_pop_cart_';
  private static readonly TTL_MS = 4 * 60 * 60 * 1000; // 4 horas

  private destroyRef = inject(DestroyRef);
  private withholdingService = inject(WithholdingTaxService);
  private authFacade = inject(AuthFacade);
  private _cartState = signal<PopCartState>(INITIAL_STATE);
  private _loading = signal<boolean>(false);
  public cartState$ = toObservable(this._cartState);
  public loading$ = toObservable(this._loading);

  constructor() {
    this.initWithholdingPreview();
    this.initPersistence();
  }

  private initPersistence(): void {
    // Hidratar cuando la tienda activa esté lista
    effect(() => {
      const store = this.authFacade.userStore();
      if (store?.id && this._cartState().items.length === 0) {
        const saved = this.loadFromStorage();
        if (saved && saved.items && saved.items.length > 0) {
          this._cartState.set(saved);
        }
      }
    });

    // Guardar automáticamente cambios en el carrito
    this.cartState$
      .pipe(
        debounceTime(250),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => {
        this.saveToStorage(state);
      });
  }

  private getStorageKey(): string | null {
    const storeId = this.authFacade.userStore()?.id;
    if (!storeId) return null;
    return `${PopCartService.STORAGE_PREFIX}${storeId}`;
  }

  private saveToStorage(state: PopCartState): void {
    if (typeof localStorage === 'undefined') return;
    const key = this.getStorageKey();
    if (!key) return;

    if (!state.items || state.items.length === 0) {
      localStorage.removeItem(key);
      return;
    }

    try {
      const payload = {
        state,
        savedAt: Date.now(),
        storeId: this.authFacade.userStore()?.id,
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignorar fallos de cuota o deserialización
    }
  }

  private loadFromStorage(): PopCartState | null {
    if (typeof localStorage === 'undefined') return null;
    const key = this.getStorageKey();
    if (!key) return null;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.state || !parsed.savedAt) return null;

      // Validar TTL de expiración
      if (Date.now() - parsed.savedAt > PopCartService.TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }

      // Validar coincidencia de tienda
      const currentStoreId = this.authFacade.userStore()?.id;
      if (currentStoreId && parsed.storeId && parsed.storeId !== currentStoreId) {
        return null;
      }

      return {
        ...parsed.state,
        orderDate: parsed.state.orderDate ? new Date(parsed.state.orderDate) : new Date(),
        expectedDate: parsed.state.expectedDate ? new Date(parsed.state.expectedDate) : new Date(),
        createdAt: parsed.state.createdAt ? new Date(parsed.state.createdAt) : new Date(),
        updatedAt: parsed.state.updatedAt ? new Date(parsed.state.updatedAt) : new Date(),
      };
    } catch {
      return null;
    }
  }

  public clearStorage(): void {
    if (typeof localStorage === 'undefined') return;
    const key = this.getStorageKey();
    if (key) {
      localStorage.removeItem(key);
    }
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
        this.clearStorage();
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
   * Set shipping method.
   *
   * C.5 — cambiar a un método que NO es flete limpia el costo y su modo. Sin
   * esto quedaba un "flete fantasma" en el estado: el campo desaparecía de la
   * pantalla y el monto seguía viajando al preview, al payload de creación y
   * al costo sellado. La pantalla y el carrito tienen que contar la misma
   * historia en todo momento.
   */
  setShippingMethod(method: ShippingMethod | undefined) {
    if (method === 'freight') {
      this.updateState({ shippingMethod: method });
      return;
    }
    this.updateState({
      shippingMethod: method,
      shippingCost: 0,
      shippingCostAllocation: undefined,
    });
  }

  /**
   * Set shipping cost.
   *
   * Se recorta a un no-negativo finito con 2 decimales: la columna que lo
   * recibe es `Decimal(12,2)` y el DTO rechaza un tercer decimal con 400.
   * Un flete en cero deja el estado sin modo, porque el validador cruzado del
   * backend rechaza `prorate` sin flete.
   */
  setShippingCost(cost: number) {
    const raw = Number(cost);
    const safe = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
    if (safe === 0) {
      this.updateState({ shippingCost: 0, shippingCostAllocation: undefined });
      return;
    }
    const current = this.currentState;
    this.updateState({
      shippingCost: safe,
      // El modo es OBLIGATORIO en cuanto hay flete (HTTP 400 sin él). Se
      // siembra en `prorate` —la imputación contable correcta por defecto: el
      // flete es parte de lo que costó poner el producto en bodega— y el
      // operador puede cambiarlo en el conmutador del paso Configuración.
      shippingCostAllocation: current.shippingCostAllocation ?? 'prorate',
    });
  }

  /**
   * C.5 — cómo se imputa el flete. Sólo tiene sentido con flete > 0; con flete
   * en cero no hay modo que declarar, porque el backend rechaza un modo sin
   * monto.
   *
   * CP-PURCHASE-TRANSPARENCY (T2/D.1) — DEVUELVE si el modo se aplicó.
   *
   * Antes retornaba `void` y descartaba la petición EN SILENCIO. El conmutador
   * de `app-toggle` ya se había pintado solo al hacer clic (es un componente
   * que se autopinta; ver el censo en el informe de T2), el carrito rechazaba
   * el cambio sin avisar y nadie revertía la pintura: la pantalla afirmaba una
   * imputación que el carrito no tenía. Quien llama TIENE que poder saber que
   * su petición no se cumplió para decírselo al operador — que es exactamente
   * lo que este plan persigue: si el sistema no va a hacer lo que le pidieron,
   * lo dice.
   *
   * @returns `true` si el modo quedó escrito; `false` si se rechazó por no
   *          haber flete que imputar.
   */
  setShippingCostAllocation(mode: 'prorate' | 'expense'): boolean {
    if (!(Number(this.currentState.shippingCost) > 0)) return false;
    this.updateState({ shippingCostAllocation: mode });
    return true;
  }

  /**
   * QUI-661 — set the GENERAL commercial discount for the invoice, in money.
   *
   * It is clamped at 0: a negative "discount" is a surcharge and would have to
   * travel as freight, not as a rebate that lowers the taxable base.
   */
  setDiscountAmount(amount: number) {
    this.updateState({ discountAmount: Math.max(0, Number(amount) || 0) });
  }

  /**
   * CP-ORC-POP-MODAL-DISCOUNT-001 — normalize a discount percentage to a safe
   * integer in 0..100. Rejects `null`/`undefined`/`NaN`/`±Infinity` by
   * returning 0; otherwise rounds and clamps the value.
   *
   * Used both at the cart-write seam (`setItemDiscount`) and at the entry
   * seam (`processAddToCart`) so a single helper owns the contract — no
   * divergence between the modal that edits an existing line and the
   * scanner that adds a new one with a discount already in the payload.
   */
  private normalizeDiscount(value: number | null | undefined): number {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(Number(value))
    ) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round(Number(value))));
  }

  /**
   * QUI-661 — set the per-line commercial discount, as a percentage.
   *
   * Clamped to 0..100 so a typo can never drive a line's cost negative and
   * poison the FIFO layer it will later create. Non-finite inputs
   * (`NaN`/`±Infinity`) and `null`/`undefined` are rejected outright so
   * the line's stored discount is never silently wiped to 0 by an
   * upstream typo — the state stays exactly as it was.
   *
   * Teclear un porcentaje LIMPIA `discount_amount`. Sin eso, el monto heredado
   * del escaneo gana por precedencia (`deriveLineTax`: monto > 0 vence al
   * porcentaje) y la edición manual no tiene ningún efecto visible: el
   * operador teclea, el número cambia en el input y la cifra no se mueve — un
   * CTA mudo. Los dos campos nunca coexisten con valor.
   */
  setItemDiscount(
    itemId: string,
    discountPercentage: number | null | undefined,
  ) {
    if (
      discountPercentage === null ||
      discountPercentage === undefined ||
      !Number.isFinite(Number(discountPercentage))
    ) {
      return;
    }
    const pct = this.normalizeDiscount(discountPercentage);
    const items = this.currentState.items.map((item) =>
      item.id === itemId
        ? { ...item, discount: pct, discount_amount: undefined }
        : item,
    );
    for (const item of items) {
      this.recalculateItemTotals(
        item,
        this.currentState.prices_include_tax,
        this.currentState.has_vat,
      );
    }
    this.updateState({ items, summary: this.calculateSummary(items) });
  }

  /**
   * Paridad escáner de facturas — fija el descuento comercial de la línea en
   * DINERO (base neta). Es la contraparte de `setItemDiscount`: la factura del
   * proveedor imprime pesos, y esa cifra es la que el backend persiste y la que
   * la contabilidad lee, así que se guarda tal cual en vez de derivarla de un
   * porcentaje que el redondeo degradaría.
   *
   * Mismo criterio defensivo que `setItemDiscount`: `null`/`undefined`/no
   * finito se rechazan SIN tocar el estado, para que un payload corrupto no
   * borre en silencio el descuento que la línea ya tenía. Se clampa a `>= 0`
   * porque un "descuento" negativo es un recargo y tendría que viajar como
   * flete, no como rebaja que baja la base gravable.
   *
   * Fija `discount = 0` en la misma línea: dos cifras compitiendo por el mismo
   * dinero dejan al operador sin saber cuál se aplicó, y el porcentaje ya no
   * describe nada porque el monto gana por precedencia.
   */
  setItemDiscountAmount(itemId: string, amount: number | null | undefined) {
    if (
      amount === null ||
      amount === undefined ||
      !Number.isFinite(Number(amount))
    ) {
      return;
    }
    const money = Math.max(0, Number(amount));
    this.mutateItem(itemId, (item) => {
      item.discount_amount = money;
      item.discount = 0;
    });
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
        // CP-ORC-POP-MODAL-DISCOUNT-001: el escáner de facturas llega con
        // descuento; el alta manual sigue en 0. La normalización
        // (entero 0..100, NaN/Infinity ⇒ 0) vive en `normalizeDiscount`.
        discount: this.normalizeDiscount(request.discount),
        // Paridad escáner: el MONTO viaja crudo. No pasa por
        // `normalizeDiscount` porque ese helper es el contrato del PORCENTAJE
        // entero 0-100; aplicarlo a pesos truncaría la cifra de la factura.
        discount_amount: request.discount_amount,
        // IVA cycle (F1/F3): defaults sembrados salvo override del request
        // (escáner de facturas). `prices_include_tax` undefined ⇒ hereda header.
        tax_rate: request.tax_rate ?? DEFAULT_PURCHASE_TAX_RATE,
        tax_type: request.tax_type ?? 'iva',
        prices_include_tax: request.prices_include_tax,
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
      this.recalculateItemTotals(
        newItem,
        currentState.prices_include_tax,
        currentState.has_vat,
      );
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

      // QUI-661 + escáner de facturas (Fase 4): un re-escaneo, o una factura que
      // repite el mismo producto en dos renglones, TRAE discount / unit_cost /
      // tax_rate / tax_type / prices_include_tax en el request. Si los ignoramos
      // se acumulan cantidad sin reescribir el descuento ni la tasa — la línea
      // termina sin el descuento comercial que la factura aplicó, y el IVA se
      // calcula contra la tasa equivocada.
      //
      // Criterio: el ÚLTIMO escaneo gana. Es lo que el operador acaba de
      // revisar y aprobar en el modal, y es coherente con el comportamiento del
      // POS cuando un mismo producto pasa dos veces por la caja: el precio más
      // reciente pisa al anterior. Si una factura trae dos renglones con
      // precios distintos, este criterio acepta la última lectura como verdad.
      updatedItems = [...currentState.items];
      updatedItems[existingItemIndex] = {
        ...existingItem,
        quantity: newQuantity,
        unit_cost: request.unit_cost ?? existingItem.unit_cost,
        // CP-ORC-POP-MODAL-DISCOUNT-001: el ÚLTIMO escaneo gana, pero pasa
        // por el normalizador para que un payload con NaN/Infinity no
        // pise el descuento de la línea con un 0 silencioso.
        discount:
          request.discount !== undefined
            ? this.normalizeDiscount(request.discount)
            : existingItem.discount,
        // Paridad escáner: el descuento en DINERO sigue exactamente el mismo
        // patrón que `discount` / `unit_cost` / `tax_rate`. Sin esta línea el
        // `...existingItem` de arriba conservaba el monto del escaneo ANTERIOR
        // mientras la cantidad sí se actualizaba — la línea quedaba con el
        // descuento de un renglón y la cantidad de dos.
        discount_amount:
          request.discount_amount !== undefined
            ? request.discount_amount
            : existingItem.discount_amount,
        tax_rate: request.tax_rate ?? existingItem.tax_rate,
        tax_type: request.tax_type ?? existingItem.tax_type,
        prices_include_tax:
          request.prices_include_tax !== undefined
            ? request.prices_include_tax
            : existingItem.prices_include_tax,
        lot_info: request.lot_info || existingItem.lot_info,
        notes: request.notes || existingItem.notes,
        contentPerPackage:
          request.contentPerPackage ?? existingItem.contentPerPackage,
      };
      this.recalculateItemTotals(
        updatedItems[existingItemIndex],
        currentState.prices_include_tax,
        currentState.has_vat,
      );
    } else {
      // Add new item
      const newItem: PopCartItem = {
        id: this.generateItemId(),
        product: request.product,
        variant: request.variant,
        quantity: request.quantity,
        unit_cost: request.unit_cost,
        // CP-ORC-POP-MODAL-DISCOUNT-001: el escáner de facturas llega con
        // descuento; el alta manual sigue en 0. La normalización
        // (entero 0..100, NaN/Infinity ⇒ 0) vive en `normalizeDiscount`.
        discount: this.normalizeDiscount(request.discount),
        // Paridad escáner: el MONTO en pesos viaja crudo (ver rama prebulk).
        discount_amount: request.discount_amount,
        // IVA cycle (F1/F3): defaults salvo override del request (escáner).
        tax_rate: request.tax_rate ?? DEFAULT_PURCHASE_TAX_RATE,
        tax_type: request.tax_type ?? 'iva',
        prices_include_tax: request.prices_include_tax,
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        lot_info: request.lot_info,
        notes: request.notes,
        is_prebulk: false,
        // Fase 4: UoM preseleccionadas (scanner uom_hint) — sugerencia.
        purchase_uom_id: request.purchase_uom_id ?? null,
        stock_uom_id: request.stock_uom_id ?? null,
        // Contenido por envase (factor manual count→masa/volumen) — flujo configure.
        contentPerPackage: request.contentPerPackage,
        addedAt: new Date(),
      };
      this.recalculateItemTotals(
        newItem,
        currentState.prices_include_tax,
        currentState.has_vat,
      );
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
      currentState.has_vat,
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
   * util espejo del backend (`deriveLineTax`). El backend es la única autoridad
   * sobre lo que se persiste; aquí solo es preview.
   *
   * Maestro "¿Esta compra tiene IVA?" apagado ⇒ pasamos `tax_rate: 0` al util
   * para que la línea salga sin impuesto (independiente del modo include/added)
   * — comportamiento que antes vivía aquí y que el util respeta con sólo
   * entregarle una tasa 0 (la rama `r > 0` cortocircuita a neto puro).
   *
   * El prorrateo del descuento de cabecera se hace en `calculateSummary`, no
   * aquí: por línea el util recibe `proratedHeaderDiscount = 0` porque la línea
   * no sabe cuánto le toca del descuento general.
   */
  private recalculateItemTotals(
    item: PopCartItem,
    headerPricesIncludeTax: boolean,
    hasVat: boolean,
  ): void {
    const safeTaxRate = hasVat ? Number(item.tax_rate) || 0 : 0;
    const result = deriveLineTax(
      {
        unit_cost: item.unit_cost,
        quantity: item.quantity,
        // Se entregan LOS DOS y el util resuelve la precedencia (monto > 0
        // gana), exactamente como lo hace `deriveLineTax` en el backend. Pasar
        // sólo el porcentaje era lo que degradaba el descuento del escáner: la
        // cifra en pesos de la factura no tenía por dónde entrar al preview.
        discount_percentage: item.discount,
        discount_amount: item.discount_amount,
        tax_rate: safeTaxRate,
        prices_include_tax: item.prices_include_tax ?? undefined,
      },
      { prices_include_tax: headerPricesIncludeTax },
      0, // prorrateo del descuento de cabecera: vive en calculateSummary
    );

    item.subtotal = result.net_line; // NET line subtotal
    item.tax_amount = result.tax_amount; // IVA for the line
    item.total = result.total_line;
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
      this.recalculateItemTotals(clone, value, current.has_vat);
      return clone;
    });
    this.updateState({ prices_include_tax: value, items });
  }

  /**
   * IVA cycle — maestro "¿Esta compra tiene IVA?". Enciende/apaga el IVA de
   * toda la orden y recomputa cada línea con el valor nuevo (apagado ⇒ IVA 0,
   * neto = precio). El escáner de facturas lo enciende al detectar IVA.
   */
  setHasVat(value: boolean): void {
    const current = this.currentState;
    if (current.has_vat === value) return;
    const items = current.items.map((item) => {
      const clone = { ...item };
      this.recalculateItemTotals(clone, current.prices_include_tax, value);
      return clone;
    });
    this.updateState({ has_vat: value, items });
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
    this.recalculateItemTotals(updated, current.prices_include_tax, current.has_vat);
    items[index] = updated;
    this.updateState({ items });
  }

  /**
   * Calculate summary from items
   */
  /**
   * @param state the state the summary belongs to. It is an ARGUMENT, not a
   *   read of `this.currentState`, because `updateState` calls this while the
   *   transition is still in flight: reading the service's signal there returns
   *   the PREVIOUS state, which left shipping (and now the discount) one update
   *   behind — the total showed the value before the last keystroke.
   *
   * El cálculo delega en `derivePurchaseTotals` (util espejo del backend): el
   * descuento de cabecera se prorratea por línea, el IVA se deriva DESPUÉS de
   * restar el descuento, y los redondedos se aplican por línea con residuo en
   * la última. Esto reemplaza el factor proporcional anterior — que operaba
   * sobre el subtotal NETO, no sobre el bruto, y por eso divergía del total
   * que el backend persiste.
   */
  private calculateSummary(
    items: PopCartItem[],
    state: Pick<
      PopCartState,
      | 'shippingCost'
      | 'discountAmount'
      | 'summary'
      | 'prices_include_tax'
      | 'has_vat'
    > = this.currentState,
  ): PopCartSummary {
    // Preserve the last backend-resolved withholding so the line does not flash
    // to 0 between an item change and the debounced preview recompute. The
    // reactive preview re-fires whenever subtotal/IVA/supplier change.
    const previousSummary = state.summary;

    const itemCount = items.reduce(
      (acc, item) => acc + (Number(item.quantity) || 0),
      0,
    );

    const totals = derivePurchaseTotals(
      items.map((item) => ({
        unit_cost: item.unit_cost,
        quantity: item.quantity,
        // `discount` es porcentaje en el carrito; el util lo lee como
        // `discount_percentage` (10 = 10%). `discount_amount` (pesos) viaja al
        // lado y GANA cuando es > 0 — misma precedencia que el backend, para
        // que el pie del carrito no contradiga a sus propias filas.
        discount_percentage: item.discount,
        discount_amount: item.discount_amount,
        // IVA efectivo por línea. El maestro `has_vat` se aplica AQUÍ, no en la
        // línea: `recalculateItemTotals` calcula su tasa efectiva en una
        // variable local y nunca la escribe en `item.tax_rate`, así que la línea
        // sigue guardando su 19 aunque el maestro esté apagado. Leerla cruda
        // hacía que el pie cobrara IVA mientras cada fila mostraba cero — y el
        // total del carrito dejaba de ser el que el operador estaba aprobando.
        tax_rate: state.has_vat ? item.tax_rate : 0,
        prices_include_tax: item.prices_include_tax ?? undefined,
      })),
      { prices_include_tax: state.prices_include_tax },
      Number(state.discountAmount) || 0,
      Number(state.shippingCost) || 0,
    );

    return {
      subtotal: totals.subtotal,
      tax_amount: totals.tax_amount,
      discount_amount: totals.discount_amount,
      shipping_cost: totals.shipping_cost,
      total: totals.total,
      itemCount,
      totalItems: 0,
      withholding_amount: previousSummary?.withholding_amount ?? 0,
      withholding_lines: previousSummary?.withholding_lines,
    };
  }

  /**
   * Update state with recalculations
   */
  private updateState(partialState: Partial<PopCartState>) {
    const currentState = this.currentState;
    const newState = { ...currentState, ...partialState, updatedAt: new Date() };

    // Recalculate whenever anything the summary depends on moved. The summary
    // is passed `newState`, not read off the service, so it never lags one
    // update behind (QUI-661).
    if (
      partialState.items ||
      partialState.shippingCost !== undefined ||
      partialState.discountAmount !== undefined
    ) {
      newState.summary = this.calculateSummary(newState.items, newState);
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
    // Maestro IVA: la orden tiene IVA si viene marcada, o (compat con órdenes
    // previas al maestro) si el header la incluía o alguna línea trae tasa /
    // monto de impuesto > 0.
    const hasVat: boolean =
      (order as any).has_vat ??
      (headerInclude ||
        rawItems.some(
          (it: any) => Number(it.tax_rate) > 0 || Number(it.tax_amount) > 0,
        ));
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
        // Toda lectura de `discount_percentage` desde DB pasa por
        // `normalizeDiscount` para garantizar el contrato entero 0-100
        // (regression: loadOrder bypass — antes leía `item.discount_percentage
        // || 0` directo, propagando la fracción al backend que la interpretaba
        // como 0.X% en vez del 20% que el operador creía haber tipeado).
        //
        // Nota de fidelidad: una PO pre-fix con `discount_percentage = 0.20`
        // se trunca a 0 (el helper redondea, no detecta sesgo histórico).
        // Esto es aceptable porque la persistencia pre-fix era incorrecta:
        // 0.20 != 20%, así que NO estamos perdiendo valor real, sólo
        // bloqueando que el bug se propague. Si el operador quiere mantener
        // el descuento, lo retipea explícito en el modal y se persiste como 20.
        discount: this.normalizeDiscount(Number(item.discount_percentage)),
        // Paridad escáner: la OC persistida guarda el descuento de línea en
        // DINERO (`purchase_order_items.discount_amount`) y es la cifra que el
        // backend prefiere al recalcular. Hidratarla es lo que hace que una OC
        // recargada reproduzca EXACTAMENTE las mismas cifras que produjo; sin
        // esto el carrito la recomponía desde el porcentaje redondeado y el
        // total al reabrir no era el que se aprobó.
        discount_amount:
          Number((item as any).discount_amount) > 0
            ? Number((item as any).discount_amount)
            : undefined,
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

      this.recalculateItemTotals(cartItem, headerInclude, hasVat);
      return cartItem;
    });

    const newState: PopCartState = {
      ...INITIAL_STATE,
      orderId: order.id,
      prices_include_tax: headerInclude,
      has_vat: hasVat,
      items: items,
      supplierId: order.supplier_id,
      locationId: order.location_id,
      orderDate: order.order_date ? new Date(order.order_date) : new Date(),
      expectedDate: order.expected_date ? new Date(order.expected_date) : undefined,
      shippingMethod: order.shipping_method as any || undefined,
      shippingCost: order.shipping_cost || 0,
      // C.5 — una orden con flete SIEMPRE tiene modo (el backend lo exige al
      // crearla). Las órdenes anteriores a C.1 no lo tienen persistido: se
      // asume `prorate`, que es lo que su costeo hizo de hecho.
      shippingCostAllocation: Number(order.shipping_cost) > 0
        ? (((order as any).shipping_cost_allocation as
            | 'prorate'
            | 'expense'
            | undefined) ?? 'prorate')
        : undefined,
      discountAmount: order.discount_amount || 0,
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
