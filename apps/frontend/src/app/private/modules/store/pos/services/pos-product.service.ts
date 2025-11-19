import { Injectable } from '@angular/core';
import { Observable, of, BehaviorSubject } from 'rxjs';
import { delay, map, catchError } from 'rxjs/operators';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../../../environments/environment';

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  cost?: number;
  category: string;
  brand?: string;
  stock: number;
  minStock: number;
  image?: string;
  description?: string;
  barcode?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: string;
  name: string;
}

export interface Brand {
  id: string;
  name: string;
}

export interface SearchFilters {
  query?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sortBy?: 'name' | 'price' | 'stock' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  pos_optimized?: boolean;
  barcode?: string;
  include_stock?: boolean;
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable({
  providedIn: 'root',
})
export class PosProductService {
  private readonly apiUrl = `${environment.apiUrl}/products`;
  private products: Product[] = [];
  private categories: Category[] = [];
  private brands: Brand[] = [];
  private searchHistory$ = new BehaviorSubject<string[]>([]);

  constructor(private http: HttpClient) {
    this.initializeMockData();
  }

  private initializeMockData(): void {
    this.categories = [
      { id: 'all', name: 'Todos' },
      { id: 'electronics', name: 'Electronicos' },
      { id: 'clothing', name: 'Ropa' },
      { id: 'food', name: 'Alimentos' },
      { id: 'books', name: 'Libros' },
      { id: 'other', name: 'Otros' },
    ];

    this.brands = [
      { id: 'all', name: 'Todos' },
      { id: 'logitech', name: 'Logitech' },
      { id: 'corsair', name: 'Corsair' },
      { id: 'lg', name: 'LG' },
      { id: 'samsung', name: 'Samsung' },
    ];
  }

  searchProducts(
    filters: SearchFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Observable<SearchResult> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', pageSize.toString());

    if (filters.query) {
      params = params.set('search', filters.query);
    }

    if (filters.category && filters.category !== 'all') {
      params = params.set('category_id', filters.category);
    }

    if (filters.brand && filters.brand !== 'all') {
      params = params.set('brand_id', filters.brand);
    }

    if (filters.inStock) {
      // For POS, we want products with stock
      params = params.set('include_stock', 'true');
    }

    if (filters.minPrice) {
      params = params.set('min_price', filters.minPrice.toString());
    }

    if (filters.maxPrice) {
      params = params.set('max_price', filters.maxPrice.toString());
    }

    if (filters.pos_optimized) {
      params = params.set('pos_optimized', 'true');
    }

    if (filters.barcode) {
      params = params.set('barcode', filters.barcode);
    }

    if (filters.include_stock) {
      params = params.set('include_stock', 'true');
    }

    // Add store filter if available
    const currentStore = this.getCurrentStoreId();
    if (currentStore) {
      params = params.set('store_id', currentStore.toString());
    }

    // Only get active products for POS
    params = params.set('state', 'active');

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        // Handle different response formats
        let products = [];
        let total = 0;
        let currentPage = page;
        let limit = pageSize;
        let totalPages = 0;

        if (response.data && Array.isArray(response.data)) {
          // Standard paginated response
          products = response.data;
          total = response.meta?.total || response.total || products.length;
          currentPage = response.meta?.page || response.page || page;
          limit = response.meta?.limit || response.limit || pageSize;
          totalPages = Math.ceil(total / limit);
        } else if (Array.isArray(response)) {
          // Direct array response
          products = response;
          total = products.length;
          totalPages = Math.ceil(total / pageSize);
        } else if (response.products && Array.isArray(response.products)) {
          // Response with products property
          products = response.products;
          total = response.total || products.length;
          totalPages = Math.ceil(total / pageSize);
        }

        return {
          products: this.transformProducts(products),
          total,
          page: currentPage,
          pageSize: limit,
          totalPages,
        };
      }),
      catchError((error) => {
        console.error('Error searching products:', error);
        return of({
          products: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        });
      }),
    );
  }

  private transformProducts(products: any[]): any[] {
    return products.map((product) => ({
      id: product.id?.toString() || '',
      name: product.name || '',
      sku: product.sku || '',
      price: parseFloat(product.base_price || product.price || 0),
      cost: product.cost_price ? parseFloat(product.cost_price) : undefined,
      category: product.category?.name || 'Sin categoría',
      brand: product.brand?.name || '',
      stock: product.stock_quantity || product.quantity_available || 0,
      minStock: product.min_stock_level || 5,
      image: product.image_url || product.image || '',
      description: product.description || '',
      barcode: product.barcode || '',
      tags: product.tags || [],
      isActive: product.state === 'active',
      createdAt: new Date(product.created_at),
      updatedAt: new Date(product.updated_at),
    }));
  }

  private getCurrentStoreId(): number | null {
    // Try to get store ID from localStorage
    const storeData = localStorage.getItem('current_store');
    if (storeData) {
      try {
        const store = JSON.parse(storeData);
        return typeof store.id === 'string' ? parseInt(store.id) : store.id;
      } catch {
        return null;
      }
    }
    return null;
  }

  getProductById(id: string): Observable<Product | null> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`).pipe(
      catchError((error: any) => {
        console.error('Error getting product by ID:', error);
        return of(null);
      }),
    );
  }

  getProductByBarcode(barcode: string): Observable<Product | null> {
    const params = new HttpParams().set('barcode', barcode);
    return this.http.get<SearchResult>(this.apiUrl, { params }).pipe(
      map((response) =>
        response.products && response.products.length > 0
          ? response.products[0]
          : null,
      ),
      catchError((error: any) => {
        console.error('Error getting product by barcode:', error);
        return of(null);
      }),
    );
  }

  getProductBySku(sku: string): Observable<Product | null> {
    const params = new HttpParams().set('sku', sku);
    return this.http.get<SearchResult>(this.apiUrl, { params }).pipe(
      map((response) =>
        response.products && response.products.length > 0
          ? response.products[0]
          : null,
      ),
      catchError((error: any) => {
        console.error('Error getting product by SKU:', error);
        return of(null);
      }),
    );
  }

  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${environment.apiUrl}/categories`).pipe(
      catchError((error: any) => {
        console.error('Error getting categories:', error);
        return of([]);
      }),
    );
  }

  getBrands(): Observable<Brand[]> {
    return this.http.get<Brand[]>(`${environment.apiUrl}/brands`).pipe(
      catchError((error: any) => {
        console.error('Error getting brands:', error);
        return of([]);
      }),
    );
  }

  getCategoryIds(): Observable<string[]> {
    return of(this.categories.map((c) => c.id)).pipe(delay(100));
  }

  getBrandIds(): Observable<string[]> {
    return of(this.brands.map((b) => b.id)).pipe(delay(100));
  }

  getSearchHistory(): Observable<string[]> {
    return this.searchHistory$.asObservable();
  }

  addToSearchHistory(query: string): void {
    if (!query || query.trim().length < 2) return;

    const current = this.searchHistory$.value;
    const filtered = current.filter(
      (q) => q.toLowerCase() !== query.toLowerCase(),
    );
    const updated = [query, ...filtered].slice(0, 10);
    this.searchHistory$.next(updated);
  }

  clearSearchHistory(): void {
    this.searchHistory$.next([]);
  }

  getPopularProducts(limit: number = 10): Observable<Product[]> {
    const popular = this.products
      .filter((p) => p.isActive)
      .sort((a, b) => b.stock - a.stock)
      .slice(0, limit);
    return of(popular).pipe(delay(200));
  }

  getLowStockProducts(limit: number = 10): Observable<Product[]> {
    const lowStock = this.products
      .filter((p) => p.isActive && p.stock <= p.minStock)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, limit);
    return of(lowStock).pipe(delay(200));
  }

  updateStock(productId: string, quantity: number): Observable<Product | null> {
    const product = this.products.find((p) => p.id === productId);
    if (product) {
      product.stock = Math.max(0, quantity);
      product.updatedAt = new Date();
    }
    return of(product || null).pipe(delay(100));
  }
}
