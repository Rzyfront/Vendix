import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, delay, map, tap } from 'rxjs/operators';
import {
  CartItem,
  CartSummary,
  CartState,
  CartDiscount,
  AddToCartRequest,
  UpdateCartItemRequest,
  ApplyDiscountRequest,
  CartValidationError,
} from '../models/cart.model';

// Re-export types for component usage
export type {
  AddToCartRequest,
  CartItem,
  CartState,
} from '../models/cart.model';
import { PosCustomer } from '../models/customer.model';

@Injectable({
  providedIn: 'root',
})
export class PosCartService {
  private readonly cartState$ = new BehaviorSubject<CartState>(
    this.getInitialState(),
  );
  private readonly loading$ = new BehaviorSubject<boolean>(false);

  // Tax configuration (can be made configurable)
  private readonly TAX_RATE = 0.21; // 21% IVA

  constructor() { }

  // Observable getters
  get cartState(): Observable<CartState> {
    return this.cartState$.asObservable();
  }

  get items(): Observable<CartItem[]> {
    return this.cartState$.asObservable().pipe(map((state) => state.items));
  }

  get customer(): Observable<PosCustomer | null> {
    return this.cartState$.asObservable().pipe(map((state) => state.customer));
  }

  get summary(): Observable<CartSummary> {
    return this.cartState$.asObservable().pipe(map((state) => state.summary));
  }

  get loading(): Observable<boolean> {
    return this.loading$.asObservable();
  }

  get isEmpty(): Observable<boolean> {
    return this.cartState$
      .asObservable()
      .pipe(map((state) => state.items.length === 0));
  }

  /**
   * Add product to cart
   */
  addToCart(request: AddToCartRequest): Observable<CartState> {
    this.loading$.next(true);

    // Validate request
    const validationErrors = this.validateAddToCartRequest(request);
    if (validationErrors.length > 0) {
      this.loading$.next(false);
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    return of(request).pipe(
      delay(200),
      map((req) => this.processAddToCart(req)),
      tap((newState) => {
        this.cartState$.next(newState);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Update cart item quantity
   */
  updateCartItem(request: UpdateCartItemRequest): Observable<CartState> {
    this.loading$.next(true);

    return of(request).pipe(
      delay(150),
      map((req) => this.processUpdateCartItem(req)),
      tap((newState) => {
        this.cartState$.next(newState);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Remove item from cart
   */
  removeFromCart(itemId: string): Observable<CartState> {
    this.loading$.next(true);

    return of(itemId).pipe(
      delay(100),
      map((id) => this.processRemoveFromCart(id)),
      tap((newState) => {
        this.cartState$.next(newState);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Clear entire cart
   */
  clearCart(): Observable<CartState> {
    this.loading$.next(true);

    return of(null).pipe(
      delay(100),
      map(() => this.getInitialState()),
      tap((newState) => {
        this.cartState$.next(newState);
        this.loading$.next(false);
      }),
    );
  }

  /**
   * Set customer for cart
   */
  setCustomer(customer: PosCustomer | null): Observable<CartState> {
    return of(customer).pipe(
      delay(50),
      map((cust) => {
        const currentState = this.cartState$.value;
        return {
          ...currentState,
          customer: cust,
          updatedAt: new Date(),
        };
      }),
      tap((newState) => this.cartState$.next(newState)),
    );
  }

  /**
   * Update cart notes
   */
  updateNotes(notes: string): Observable<CartState> {
    return of(notes).pipe(
      delay(50),
      map((note) => {
        const currentState = this.cartState$.value;
        return {
          ...currentState,
          notes: note.trim(),
          updatedAt: new Date(),
        };
      }),
      tap((newState) => this.cartState$.next(newState)),
    );
  }

  /**
   * Apply discount to cart
   */
  applyDiscount(request: ApplyDiscountRequest): Observable<CartState> {
    this.loading$.next(true);

    // Validate discount
    const validationErrors = this.validateDiscountRequest(request);
    if (validationErrors.length > 0) {
      this.loading$.next(false);
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    return of(request).pipe(
      delay(200),
      map((req) => this.processApplyDiscount(req)),
      tap((newState) => {
        this.cartState$.next(newState);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Remove discount from cart
   */
  removeDiscount(discountId: string): Observable<CartState> {
    return of(discountId).pipe(
      delay(100),
      map((id) => this.processRemoveDiscount(id)),
      tap((newState) => this.cartState$.next(newState)),
    );
  }

  /**
   * Get current cart state value
   */
  getCurrentState(): CartState {
    return this.cartState$.value;
  }

  /**
   * Get item by ID
   */
  getItemById(itemId: string): CartItem | null {
    return (
      this.cartState$.value.items.find((item) => item.id === itemId) || null
    );
  }

  /**
   * Check if product is in cart
   */
  isProductInCart(productId: string): boolean {
    return this.cartState$.value.items.some(
      (item) => item.product.id === productId,
    );
  }

  /**
   * Get item quantity for product
   */
  getProductQuantity(productId: string): number {
    const item = this.cartState$.value.items.find(
      (item) => item.product.id === productId,
    );
    return item ? item.quantity : 0;
  }

  /**
   * Process add to cart
   */
  private processAddToCart(request: AddToCartRequest): CartState {
    const currentState = this.cartState$.value;
    const existingItemIndex = currentState.items.findIndex(
      (item) => item.product.id === request.product.id,
    );

    let updatedItems: CartItem[];

    if (existingItemIndex >= 0) {
      // Update existing item
      const existingItem = currentState.items[existingItemIndex];
      const newQuantity = existingItem.quantity + request.quantity;

      updatedItems = [...currentState.items];
      updatedItems[existingItemIndex] = {
        ...existingItem,
        quantity: newQuantity,
        totalPrice: newQuantity * existingItem.unitPrice,
        notes: request.notes || existingItem.notes,
      };
    } else {
      // Add new item
      const newItem: CartItem = {
        id: this.generateItemId(),
        product: request.product,
        quantity: request.quantity,
        unitPrice: request.product.price,
        totalPrice: request.quantity * request.product.price,
        addedAt: new Date(),
        notes: request.notes,
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
    const currentState = this.cartState$.value;
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

    const updatedItems = [...currentState.items];
    updatedItems[itemIndex] = {
      ...item,
      quantity: request.quantity,
      totalPrice: request.quantity * item.unitPrice,
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
    const currentState = this.cartState$.value;
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
    const currentState = this.cartState$.value;
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
    const currentState = this.cartState$.value;
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
    const subtotal = this.calculateSubtotal(items);
    const discountAmount = discounts.reduce(
      (total, discount) => total + discount.amount,
      0,
    );
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = taxableAmount * this.TAX_RATE;
    const total = taxableAmount + taxAmount;
    const itemCount = items.length;
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      subtotal,
      taxAmount,
      discountAmount,
      total,
      itemCount,
      totalItems,
    };
  }

  /**
   * Calculate subtotal
   */
  private calculateSubtotal(items: CartItem[]): number {
    return items.reduce((sum, item) => sum + item.totalPrice, 0);
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

    if (request.product && request.quantity > request.product.stock) {
      errors.push({
        field: 'quantity',
        message: `Stock insuficiente. Disponible: ${request.product.stock}`,
      });
    }

    return errors;
  }

  /**
   * Validate discount request
   */
  private validateDiscountRequest(
    request: ApplyDiscountRequest,
  ): CartValidationError[] {
    const errors: CartValidationError[] = [];
    const currentState = this.cartState$.value;
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

  /**
   * Generate unique discount ID
   */
  private generateDiscountId(): string {
    return 'DISC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }
}
