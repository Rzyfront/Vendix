import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CatalogService, Product } from './catalog.service';
import { environment } from '../../../../../environments/environment';

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
  };
  variant: {
    name: string;
    sku: string;
    attributes: any;
  } | null;
}

export interface Cart {
  id: number;
  currency: string;
  subtotal: number;
  item_count: number;
  items: CartItem[];
}

interface LocalCartItem {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
}

@Injectable({
  providedIn: 'root',
})
export class CartService {
  private api_url = `${environment.apiUrl}/ecommerce/cart`;
  private local_storage_key = 'vendix_cart';

  private cart_subject = new BehaviorSubject<Cart | null>(null);
  cart$ = this.cart_subject.asObservable();

  private item_added_subject = new Subject<void>();
  itemAdded$ = this.item_added_subject.asObservable();

  private is_authenticated = false;

  constructor(
    private http: HttpClient,
    private domain_service: TenantFacade,
    private catalog_service: CatalogService,
    private auth_facade: AuthFacade,
  ) {
    this.initializeCart();
  }

  private initializeCart() {
    this.auth_facade.isAuthenticated$.subscribe((isAuthenticated) => {
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
    const stored = localStorage.getItem(this.local_storage_key);
    if (stored) {
      try {
        const items: LocalCartItem[] = JSON.parse(stored);
        if (items.length === 0) {
          this.emitEmptyCart();
          return;
        }

        const productIds = [...new Set(items.map((i) => i.product_id))];
        this.catalog_service
          .getProducts({ ids: productIds.join(','), limit: 100 })
          .subscribe({
            next: (response) => {
              const products: Product[] = response.data;

              const cartItems: CartItem[] = items
                .map((localItem) => {
                  const product = products.find(
                    (p) => p.id === localItem.product_id,
                  );
                  if (!product) return null;

                  const price = Number(
                    product.final_price || product.base_price,
                  );

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
                    },
                    variant: null,
                  };
                })
                .filter((i) => i !== null) as CartItem[];

              const cart: Cart = {
                id: 0,
                currency: 'USD',
                subtotal: cartItems.reduce((sum, i) => sum + i.total_price, 0),
                item_count: cartItems.reduce((sum, i) => sum + i.quantity, 0),
                items: cartItems,
              };
              this.cart_subject.next(cart);
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
      currency: 'USD',
      subtotal: 0,
      item_count: 0,
      items: [],
    };
    this.cart_subject.next(cart);
  }

  private getLocalCart(): LocalCartItem[] {
    const stored = localStorage.getItem(this.local_storage_key);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    }
    return [];
  }

  private saveLocalCart(items: LocalCartItem[]): void {
    localStorage.setItem(this.local_storage_key, JSON.stringify(items));
    this.loadLocalCart();
  }

  /**
   * @deprecated Use addToCart() instead which automatically handles authentication state
   */
  addToLocalCart(
    product_id: number,
    quantity: number,
    product_variant_id?: number,
  ): void {
    const items = this.getLocalCart();
    const existing = items.find(
      (i) =>
        i.product_id === product_id &&
        i.product_variant_id === product_variant_id,
    );

    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({ product_id, product_variant_id, quantity });
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
      item.quantity = quantity;
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
            this.cart_subject.next(response.data);
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
            this.cart_subject.next(response.data);
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
            this.cart_subject.next(response.data);
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
            this.cart_subject.next(response.data);
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
            this.cart_subject.next(response.data);
            // Limpiar localStorage INMEDIATAMENTE después de sincronizar
            localStorage.removeItem(this.local_storage_key);
          }
        }),
      );
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
  ): Observable<any> | void {
    if (this.is_authenticated) {
      return this.addItem(product_id, quantity, product_variant_id);
    } else {
      this.addToLocalCart(product_id, quantity, product_variant_id);
    }
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

  // ========== SHIPPING ==========
  getShippingEstimates(address: {
    country_code: string;
    state_province?: string;
    city?: string;
    postal_code?: string;
  }): Observable<any[]> {
    const cart = this.cart_subject.value;
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
