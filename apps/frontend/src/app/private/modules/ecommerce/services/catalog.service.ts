import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

export interface Product {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    base_price: number;
    sku: string | null;
    stock_quantity: number | null;
    image_url: string | null;
    brand: { id: number; name: string } | null;
    categories: { id: number; name: string; slug: string }[];
}

export interface ProductDetail extends Product {
    images: { id: number; image_url: string; is_main: boolean }[];
    variants: { id: number; name: string; sku: string; price_override: number | null; stock_quantity: number; attributes: any }[];
    reviews: { id: number; rating: number; comment: string; created_at: string; user_name: string }[];
    avg_rating: number;
    review_count: number;
}

export interface Category {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    image_url: string | null;
}

export interface Brand {
    id: number;
    name: string;
    logo_url: string | null;
}

export interface CatalogQuery {
    search?: string;
    category_id?: number;
    brand_id?: number;
    min_price?: number;
    max_price?: number;
    sort_by?: 'name' | 'price_asc' | 'price_desc' | 'newest';
    page?: number;
    limit?: number;
    created_after?: string;
    has_discount?: boolean;
}

export interface PaginatedResponse<T> {
    success: boolean;
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        total_pages: number;
    };
}

@Injectable({
    providedIn: 'root',
})
export class CatalogService {
    private api_url = `${environment.apiUrl}/ecommerce/catalog`;

    constructor(
        private http: HttpClient,
        private domain_service: TenantFacade,
    ) { }

    private getHeaders(): HttpHeaders {
        const domainConfig = this.domain_service.getCurrentDomainConfig();
        const storeId = domainConfig?.store_id;
        return new HttpHeaders({
            'x-store-id': storeId?.toString() || '',
        });
    }

    getProducts(query: CatalogQuery = {}): Observable<PaginatedResponse<Product>> {
        let params = new HttpParams();

        if (query.search) params = params.set('search', query.search);
        if (query.category_id) params = params.set('category_id', query.category_id.toString());
        if (query.brand_id) params = params.set('brand_id', query.brand_id.toString());
        if (query.min_price) params = params.set('min_price', query.min_price.toString());
        if (query.max_price) params = params.set('max_price', query.max_price.toString());
        if (query.sort_by) params = params.set('sort_by', query.sort_by);
        if (query.page) params = params.set('page', query.page.toString());
        if (query.limit) params = params.set('limit', query.limit.toString());
        if (query.created_after) params = params.set('created_after', query.created_after);
        if (query.has_discount !== undefined) params = params.set('has_discount', query.has_discount.toString());

        return this.http.get<PaginatedResponse<Product>>(this.api_url, {
            headers: this.getHeaders(),
            params,
        });
    }

    getProductBySlug(slug: string): Observable<{ success: boolean; data: ProductDetail }> {
        return this.http.get<{ success: boolean; data: ProductDetail }>(`${this.api_url}/${slug}`, {
            headers: this.getHeaders(),
        });
    }

    getCategories(): Observable<{ success: boolean; data: Category[] }> {
        return this.http.get<{ success: boolean; data: Category[] }>(`${this.api_url}/categories`, {
            headers: this.getHeaders(),
        });
    }

    getBrands(): Observable<{ success: boolean; data: Brand[] }> {
        return this.http.get<{ success: boolean; data: Brand[] }>(`${this.api_url}/brands`, {
            headers: this.getHeaders(),
        });
    }
}
