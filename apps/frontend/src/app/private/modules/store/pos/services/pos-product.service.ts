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
    // No longer using mock data - using real API
  }

  private initializeMockData(): void {
    this.products = [
      {
        id: '1',
        name: 'Mouse Inalámbrico',
        sku: 'MOUSE-WIFI-001',
        price: 25.99,
        cost: 15.0,
        category: 'Accesorios',
        brand: 'Logitech',
        stock: 50,
        minStock: 10,
        barcode: '2345678901234',
        tags: ['mouse', 'inalámbrico', 'logitech'],
        isActive: true,
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      },
      {
        id: '2',
        name: 'Teclado Mecánico RGB',
        sku: 'KEY-MEC-003',
        price: 129.99,
        cost: 85.0,
        category: 'Accesorios',
        brand: 'Corsair',
        stock: 25,
        minStock: 5,
        barcode: '3456789012345',
        tags: ['teclado', 'mecánico', 'rgb'],
        isActive: true,
        createdAt: new Date('2024-01-16'),
        updatedAt: new Date('2024-01-16'),
      },
      {
        id: '3',
        name: 'Monitor LG 27" 4K',
        sku: 'MON-LG-007',
        price: 299.99,
        cost: 200.0,
        category: 'Accesorios',
        brand: 'LG',
        stock: 15,
        minStock: 3,
        barcode: '4567890123456',
        tags: ['monitor', '4k', 'lg'],
        isActive: true,
        createdAt: new Date('2024-01-17'),
        updatedAt: new Date('2024-01-17'),
      },
    ];

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
    // Use real API call for POS optimized search
    const params = new HttpParams()
      .set('pos_optimized', filters.pos_optimized ? 'true' : 'false')
      .set('include_stock', filters.include_stock ? 'true' : 'false')
      .set('page', page.toString())
      .set('limit', pageSize.toString());

    if (filters.barcode) {
      params.set('barcode', filters.barcode);
    } else if (filters.query) {
      params.set('search', filters.query);
    }

    if (filters.category) {
      params.set('category_id', filters.category);
    }

    if (filters.brand) {
      params.set('brand_id', filters.brand);
    }

    return this.http.get<SearchResult>(this.apiUrl, { params }).pipe(
      map(
        (response) =>
          response || { products: [], total: 0, page, pageSize, totalPages: 0 },
      ),
      catchError((error: any) => {
        console.error('Error searching products:', error);
        return of({ products: [], total: 0, page, pageSize, totalPages: 0 });
      }),
    );
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
