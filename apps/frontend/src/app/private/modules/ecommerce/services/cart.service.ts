import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DomainService } from '../../../../core/services/domain.service';

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
    private api_url = '/api/ecommerce/cart';
    private local_storage_key = 'vendix_cart';

    private cart_subject = new BehaviorSubject<Cart | null>(null);
    cart$ = this.cart_subject.asObservable();

    constructor(
        private http: HttpClient,
        private domain_service: DomainService,
    ) {
        this.loadLocalCart();
    }

    private getHeaders(): HttpHeaders {
        const domain_config = this.domain_service.getCurrentDomainConfig();
        return new HttpHeaders({
            'x-store-id': domain_config?.store?.id?.toString() || '',
        });
    }

    // Local storage methods for guest cart
    private loadLocalCart(): void {
        const stored = localStorage.getItem(this.local_storage_key);
        if (stored) {
            try {
                const items: LocalCartItem[] = JSON.parse(stored);
                // Create a mock cart object for guests
                const cart: Cart = {
                    id: 0,
                    currency: 'USD',
                    subtotal: 0,
                    item_count: items.reduce((sum, i) => sum + i.quantity, 0),
                    items: [],
                };
                this.cart_subject.next(cart);
            } catch {
                localStorage.removeItem(this.local_storage_key);
            }
        }
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
        const cart: Cart = {
            id: 0,
            currency: 'USD',
            subtotal: 0,
            item_count: items.reduce((sum, i) => sum + i.quantity, 0),
            items: [],
        };
        this.cart_subject.next(cart);
    }

    addToLocalCart(product_id: number, quantity: number, product_variant_id?: number): void {
        const items = this.getLocalCart();
        const existing = items.find(
            (i) => i.product_id === product_id && i.product_variant_id === product_variant_id,
        );

        if (existing) {
            existing.quantity += quantity;
        } else {
            items.push({ product_id, product_variant_id, quantity });
        }

        this.saveLocalCart(items);
    }

    updateLocalCartItem(product_id: number, quantity: number, product_variant_id?: number): void {
        const items = this.getLocalCart();
        const item = items.find(
            (i) => i.product_id === product_id && i.product_variant_id === product_variant_id,
        );

        if (item) {
            item.quantity = quantity;
            this.saveLocalCart(items);
        }
    }

    removeFromLocalCart(product_id: number, product_variant_id?: number): void {
        let items = this.getLocalCart();
        items = items.filter(
            (i) => !(i.product_id === product_id && i.product_variant_id === product_variant_id),
        );
        this.saveLocalCart(items);
    }

    clearLocalCart(): void {
        localStorage.removeItem(this.local_storage_key);
        this.cart_subject.next(null);
    }

    // API methods for authenticated users
    getCart(): Observable<any> {
        return this.http.get(`${this.api_url}`, { headers: this.getHeaders() }).pipe(
            tap((response: any) => {
                if (response.success) {
                    this.cart_subject.next(response.data);
                }
            }),
        );
    }

    addItem(product_id: number, quantity: number, product_variant_id?: number): Observable<any> {
        return this.http
            .post(`${this.api_url}/items`, { product_id, quantity, product_variant_id }, { headers: this.getHeaders() })
            .pipe(
                tap((response: any) => {
                    if (response.success) {
                        this.cart_subject.next(response.data);
                    }
                }),
            );
    }

    updateItem(item_id: number, quantity: number): Observable<any> {
        return this.http
            .put(`${this.api_url}/items/${item_id}`, { quantity }, { headers: this.getHeaders() })
            .pipe(
                tap((response: any) => {
                    if (response.success) {
                        this.cart_subject.next(response.data);
                    }
                }),
            );
    }

    removeItem(item_id: number): Observable<any> {
        return this.http.delete(`${this.api_url}/items/${item_id}`, { headers: this.getHeaders() }).pipe(
            tap((response: any) => {
                if (response.success) {
                    this.cart_subject.next(response.data);
                }
            }),
        );
    }

    clearCart(): Observable<any> {
        return this.http.delete(this.api_url, { headers: this.getHeaders() });
    }

    syncFromLocalStorage(): Observable<any> {
        const items = this.getLocalCart();
        return this.http.post(`${this.api_url}/sync`, { items }, { headers: this.getHeaders() }).pipe(
            tap((response: any) => {
                if (response.success) {
                    this.cart_subject.next(response.data);
                    this.clearLocalCart();
                }
            }),
        );
    }
}
