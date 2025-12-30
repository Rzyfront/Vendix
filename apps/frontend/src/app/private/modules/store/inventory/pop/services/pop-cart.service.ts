import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { map, tap, catchError, delay } from 'rxjs/operators';
import {
  LotInfo,
  PreBulkData,
  PopProduct,
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

/**
 * Lot/Batch information for purchase order items (extended for service use)
 */
export interface PopCartItemLotInfo {
  batch_number?: string;
  manufacturing_date?: Date;
  expiration_date?: Date;
}

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
  private _cartState = new BehaviorSubject<PopCartState>(INITIAL_STATE);
  private _loading = new BehaviorSubject<boolean>(false);
  public cartState$ = this._cartState.asObservable();
  public loading$ = this._loading.asObservable();

  constructor() { }

  get currentState(): PopCartState {
    return this._cartState.getValue();
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
    this._loading.next(true);

    return of(request).pipe(
      delay(200),
      map((req) => this.processAddToCart(req)),
      tap((newState) => {
        this._cartState.next(newState);
        this._loading.next(false);
      }),
      catchError((error) => {
        this._loading.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Update cart item
   */
  updateCartItem(request: UpdatePopCartItemRequest): Observable<PopCartState> {
    this._loading.next(true);

    return of(request).pipe(
      delay(150),
      map((req) => this.processUpdateCartItem(req)),
      tap((newState) => {
        this._cartState.next(newState);
        this._loading.next(false);
      }),
      catchError((error) => {
        this._loading.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Remove item from cart by ID
   */
  removeFromCart(itemId: string): Observable<PopCartState> {
    this._loading.next(true);

    return of(itemId).pipe(
      delay(100),
      map((id) => this.processRemoveFromCart(id)),
      tap((newState) => {
        this._cartState.next(newState);
        this._loading.next(false);
      }),
      catchError((error) => {
        this._loading.next(false);
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
    this._loading.next(true);

    return of(null).pipe(
      delay(100),
      map(() => ({
        ...INITIAL_STATE,
        orderDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      tap((newState) => {
        this._cartState.next(newState);
        this._loading.next(false);
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
    }).subscribe();
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
      }).subscribe();
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
      }).subscribe();
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
      }).subscribe();
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
      delay(100),
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
      tap((newState) => this._cartState.next(newState)),
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
        tax_rate: 0,
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        lot_info: request.lot_info,
        notes: request.notes,
        is_prebulk: true,
        prebulk_data: request.prebulk_data,
        addedAt: new Date(),
      };
      this.recalculateItemTotals(newItem);
      const updatedItems = [newItem, ...currentState.items];
      return {
        ...currentState,
        items: updatedItems,
        summary: this.calculateSummary(updatedItems),
        updatedAt: new Date(),
      };
    }

    // For regular products, check if already in cart
    const existingItemIndex = currentState.items.findIndex(
      (item) => item.product.id === request.product.id && !item.is_prebulk,
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
      this.recalculateItemTotals(updatedItems[existingItemIndex]);
    } else {
      // Add new item
      const newItem: PopCartItem = {
        id: this.generateItemId(),
        product: request.product,
        quantity: request.quantity,
        unit_cost: request.unit_cost,
        discount: 0,
        tax_rate: 0,
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        lot_info: request.lot_info,
        notes: request.notes,
        is_prebulk: false,
        addedAt: new Date(),
      };
      this.recalculateItemTotals(newItem);
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
    updatedItems[itemIndex] = {
      ...item,
      quantity: request.quantity ?? item.quantity,
      unit_cost: request.unit_cost ?? item.unit_cost,
      lot_info: request.lot_info ?? item.lot_info,
      notes: request.notes ?? item.notes,
    };
    this.recalculateItemTotals(updatedItems[itemIndex]);

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
   * Recalculate item totals
   */
  private recalculateItemTotals(item: PopCartItem) {
    const baseTotal = item.quantity * item.unit_cost;
    const discountAmount = (baseTotal * item.discount) / 100;
    const taxableAmount = baseTotal - discountAmount;
    const taxAmount = (taxableAmount * item.tax_rate) / 100;

    item.subtotal = baseTotal;
    item.tax_amount = taxAmount;
    item.total = taxableAmount + taxAmount;
  }

  /**
   * Calculate summary from items
   */
  private calculateSummary(items: PopCartItem[]): PopCartSummary {
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

    this._cartState.next(newState);
  }


  /**
   * Load an existing purchase order into the cart
   */
  loadOrder(order: PurchaseOrder): void {
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

      const cartItem: PopCartItem = {
        id: this.generateItemId(),
        product: popProduct,
        quantity: item.quantity_ordered || item.quantity,
        unit_cost: item.unit_cost || item.unit_price,
        discount: item.discount_percentage || 0,
        tax_rate: item.tax_rate || 0,
        subtotal: ((item.quantity_ordered || item.quantity) * (item.unit_cost || item.unit_price)),
        tax_amount: 0,
        total: 0,
        lot_info: undefined,
        notes: item.notes,
        is_prebulk: false,
        addedAt: new Date()
      };

      this.recalculateItemTotals(cartItem);
      return cartItem;
    });

    const newState: PopCartState = {
      ...INITIAL_STATE,
      orderId: order.id,
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
export type { ShippingMethod, PaymentTermPreset, LotInfo, PreBulkData, PopSupplier, PopLocation, PopProduct };
export type { PopCartItem, PopCartSummary, PopCartState, AddToPopCartRequest, UpdatePopCartItemRequest };
