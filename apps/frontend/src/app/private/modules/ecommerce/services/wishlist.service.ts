import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';

export interface WishlistItem {
    id: number;
    product_id: number;
    product_variant_id: number | null;
    added_at: string;
    product: {
        id: number;
        name: string;
        slug: string;
        base_price: number;
        sku: string | null;
        stock_quantity: number | null;
        image_url: string | null;
    };
    variant: {
        name: string;
        sku: string;
        price_override: number | null;
        attributes: any;
    } | null;
}

export interface Wishlist {
    id: number;
    item_count: number;
    items: WishlistItem[];
}

@Injectable({
    providedIn: 'root',
})
export class WishlistService {
    private api_url = '/api/ecommerce/wishlist';

    private wishlist_subject = new BehaviorSubject<Wishlist | null>(null);
    wishlist$ = this.wishlist_subject.asObservable();

    constructor(
        private http: HttpClient,
        private domain_service: TenantFacade,
    ) { }

    private getHeaders(): HttpHeaders {
        const domain_config = this.domain_service.getCurrentTenantConfig();
        return new HttpHeaders({
            'x-store-id': store_id?.toString() || '',
        });
    }

    getWishlist(): Observable<any> {
        return this.http.get(this.api_url, { headers: this.getHeaders() }).pipe(
            tap((response: any) => {
                if (response.success) {
                    this.wishlist_subject.next(response.data);
                }
            }),
        );
    }

    addItem(product_id: number, product_variant_id?: number): Observable<any> {
        return this.http
            .post(this.api_url, { product_id, product_variant_id }, { headers: this.getHeaders() })
            .pipe(
                tap((response: any) => {
                    if (response.success) {
                        this.wishlist_subject.next(response.data);
                    }
                }),
            );
    }

    removeItem(product_id: number): Observable<any> {
        return this.http.delete(`${this.api_url}/${product_id}`, { headers: this.getHeaders() }).pipe(
            tap((response: any) => {
                if (response.success) {
                    this.wishlist_subject.next(response.data);
                }
            }),
        );
    }

    checkInWishlist(product_id: number): Observable<{ success: boolean; data: { in_wishlist: boolean } }> {
        return this.http.get<{ success: boolean; data: { in_wishlist: boolean } }>(
            `${this.api_url}/check/${product_id}`,
            { headers: this.getHeaders() },
        );
    }
}
