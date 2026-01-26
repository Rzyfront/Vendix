import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface Product {
  id: number;
  name: string;
  sku: string;
  description?: string;
  price: number;
  final_price: number;
  cost?: number;
  stock_quantity: number;
  category_id?: number;
  category?: {
    id: number;
    name: string;
  };
  brand_id?: number;
  brand?: {
    id: number;
    name: string;
  };
  variants?: ProductVariant[];
  images?: ProductImage[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  sku: string;
  name: string;
  price: number;
  cost?: number;
  stock_quantity: number;
  attributes?: Record<string, any>;
  image?: string;
  is_active: boolean;
}

export interface ProductImage {
  id: number;
  product_id: number;
  image_url: string;
  alt_text?: string;
  is_primary: boolean;
  sort_order: number;
}

export interface ProductSearchRequest {
  search?: string;
  store_id?: number;
  category_id?: number;
  brand_id?: number;
  is_active?: boolean;
  page?: number;
  limit?: number;
  sort_by?: 'name' | 'price' | 'created_at' | 'stock_quantity';
  sort_order?: 'asc' | 'desc';
}

export interface ProductSearchResponse {
  data: Product[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class ProductsService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  searchProducts(
    request: ProductSearchRequest,
  ): Observable<ProductSearchResponse> {
    const params = new HttpParams();

    if (request.search) params.set('search', request.search);
    if (request.store_id) params.set('store_id', request.store_id.toString());
    if (request.category_id)
      params.set('category_id', request.category_id.toString());
    if (request.brand_id) params.set('brand_id', request.brand_id.toString());
    if (request.is_active !== undefined)
      params.set('is_active', request.is_active.toString());
    if (request.page) params.set('page', request.page.toString());
    if (request.limit) params.set('limit', request.limit.toString());
    if (request.sort_by) params.set('sort_by', request.sort_by);
    if (request.sort_order) params.set('sort_order', request.sort_order);

    return this.http.get<ProductSearchResponse>(
      `${this.baseUrl}/organization/products`,
      {
        params,
      },
    );
  }

  getProductById(id: number, store_id?: number): Observable<Product> {
    const params = new HttpParams();
    if (store_id) params.set('store_id', store_id.toString());

    return this.http.get<Product>(
      `${this.baseUrl}/organization/products/${id}`,
      { params },
    );
  }

  getProductVariants(
    productId: number,
    store_id?: number,
  ): Observable<ProductVariant[]> {
    const params = new HttpParams();
    if (store_id) params.set('store_id', store_id.toString());

    return this.http.get<ProductVariant[]>(
      `${this.baseUrl}/organization/products/${productId}/variants`,
      { params },
    );
  }

  checkInventory(
    productId: number,
    variantId?: number,
    store_id?: number,
  ): Observable<{
    available: boolean;
    stock_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
  }> {
    const params = new HttpParams();
    if (variantId) params.set('variant_id', variantId.toString());
    if (store_id) params.set('store_id', store_id.toString());

    return this.http.get<any>(
      `${this.baseUrl}/organization/products/${productId}/inventory`,
      { params },
    );
  }

  // Método para obtener productos populares de una tienda
  getPopularProducts(
    store_id: number,
    limit: number = 10,
  ): Observable<Product[]> {
    return this.searchProducts({
      store_id,
      is_active: true,
      sort_by: 'stock_quantity',
      sort_order: 'desc',
      limit,
    }).pipe(map((response) => response.data));
  }

  // Método para obtener productos por categoría
  getProductsByCategory(
    store_id: number,
    category_id: number,
    limit: number = 20,
  ): Observable<Product[]> {
    return this.searchProducts({
      store_id,
      category_id,
      is_active: true,
      sort_by: 'name',
      sort_order: 'asc',
      limit,
    }).pipe(map((response) => response.data));
  }
}
