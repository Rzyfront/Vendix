import { Injectable, signal } from '@angular/core';
import { Observable, of, throwError, forkJoin } from 'rxjs';
import { catchError, delay, map, tap } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
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

@Injectable({
  providedIn: 'root',
})
export class PosCartService {
  readonly cartState = signal<CartState>(this.getInitialState());
  readonly loading = signal<boolean>(false);

  constructor(
    private productService: PosProductService,
    private priceResolver: PriceResolverService,
  ) { }

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
   * Apply eligible promotions to the cart
   */
  applyPromotions(activePromotions: any[]): Observable<CartState> {
    return of(activePromotions).pipe(
      map((promotions) => {
        const currentState = this.cartState();

        // Remove previously auto-applied promotion discounts
        const manualDiscounts = currentState.appliedDiscounts.filter(d => !d.is_auto_applied);

        // Calculate cart total for order-level eligibility
        const subtotal = this.calculateSubtotal(currentState.items);

        // Apply eligible auto-apply promotions
        const promoDiscounts: CartDiscount[] = [];
        for (const promo of promotions) {
          if (!promo.is_auto_apply) continue;

          // Check min purchase
          if (promo.min_purchase_amount && subtotal < Number(promo.min_purchase_amount)) continue;

          const applicableTotal = this.calculatePromotionApplicableTotal(
            promo,
            currentState.items,
          );
          if (applicableTotal <= 0) continue;

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

          promoDiscounts.push({
            id: 'PROMO_' + promo.id,
            type: promo.type === 'percentage' ? 'percentage' : 'fixed',
            value: Number(promo.value),
            description: promo.name,
            amount: Math.round(discountAmount * 100) / 100,
            promotion_id: promo.id,
            is_auto_applied: true,
          });
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
    const multiplier = item.is_weight_product && item.weight
      ? item.weight
      : item.quantity;
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
    const existingItemIndex = isWeightProduct
      ? -1 // Don't combine weight items
      : currentState.items.findIndex(
          (item) =>
            item.product.id === request.product.id &&
            (item.variant_id || null) === (request.variant?.id || null),
        );

    // Variant-aware pricing
    const basePrice = this.resolveUnitPrice(request.product, request.variant);
    let updatedItems: CartItem[];

    if (existingItemIndex >= 0) {
      // Update existing item
      const existingItem = currentState.items[existingItemIndex];
      const newQuantity = existingItem.quantity + request.quantity;
      const finalUnitPrice = this.calculateItemFinalPriceWithBase(request.product, basePrice);

      updatedItems = [...currentState.items];
      updatedItems[existingItemIndex] = {
        ...existingItem,
        quantity: newQuantity,
        taxAmount: this.calculateItemTaxWithBase(request.product, basePrice, newQuantity),
        finalPrice: finalUnitPrice,
        totalPrice: newQuantity * finalUnitPrice,
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
      const itemTotalPrice = isWeightProduct
        ? finalUnitPrice * weight
        : request.quantity * finalUnitPrice;

      // For weight products, tax is calculated on the total (price * weight), not just price * quantity
      const taxMultiplier = isWeightProduct ? weight : quantity;
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
        // Weight product fields
        weight: isWeightProduct ? weight : undefined,
        weight_unit: isWeightProduct ? (request.weight_unit || 'kg') : undefined,
        is_weight_product: isWeightProduct,
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

    const updatedItems = [...currentState.items];
    const finalUnitPrice = item.finalPrice;

    // For weight products, total is based on weight, not quantity
    const isWeightItem = item.is_weight_product && item.weight;
    const newTotalPrice = isWeightItem
      ? item.weight! * finalUnitPrice
      : request.quantity * finalUnitPrice;
    const taxMultiplier = isWeightItem ? item.weight! : request.quantity;

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
      const availableStock = request.variant ? request.variant.stock : request.product.stock;

      // Check current cart quantity for this product+variant combo
      const currentState = this.cartState();
      const existingItem = currentState.items.find(
        (item) =>
          item.product.id === request.product.id &&
          (item.variant_id || null) === (request.variant?.id || null),
      );
      const currentCartQuantity = existingItem ? existingItem.quantity : 0;
      const totalRequestedQuantity = currentCartQuantity + request.quantity;

      if (request.product && totalRequestedQuantity > availableStock) {
        errors.push({
          field: 'quantity',
          message: currentCartQuantity > 0
            ? `Stock insuficiente. Ya tienes ${currentCartQuantity} en el carrito. Disponible: ${availableStock}`
            : `Stock insuficiente. Disponible: ${availableStock}`,
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
