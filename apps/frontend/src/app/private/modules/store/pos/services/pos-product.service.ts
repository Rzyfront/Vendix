import { Injectable } from '@angular/core';
import { Observable, of, BehaviorSubject, throwError } from 'rxjs';
import { delay, map, catchError } from 'rxjs/operators';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';

export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  final_price: number;
  cost?: number;
  category: string;
  brand?: string;
  stock: number;
  minStock: number;
  image?: string;
  image_url?: string;
  description?: string;
  barcode?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tax_assignments?: ProductTaxAssignment[];
}

export interface ProductTaxAssignment {
  product_id: number;
  tax_category_id: number;
  tax_categories?: TaxCategory;
}

export interface TaxCategory {
  id: number;
  name: string;
  description?: string;
  tax_rates?: TaxRate[];
  store_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface TaxRate {
  id: number;
  name: string;
  rate: string;
  store_id: number;
  is_compound: boolean;
  priority: number;
  created_at: Date;
  updated_at: Date;
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
  search?: string; // Add search as alias for query
  category?: string;
  brand?: string;
  category_id?: string | number; // Add category_id for compatibility
  brand_id?: string | number; // Add brand_id for compatibility
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
  private readonly apiUrl = `${environment.apiUrl}/store/products`;
  private categories: Category[] = [];
  private brands: Brand[] = [];
  private searchHistory$ = new BehaviorSubject<string[]>([]);

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) {
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
    const query: any = {
      page,
      limit: pageSize,
      state: 'active',
    };

    if (filters.query || filters.search) {
      query.search = filters.query || filters.search;
    }

    if (
      (filters.category && filters.category !== 'all') ||
      filters.category_id
    ) {
      query.category_id =
        filters.category !== 'all' ? filters.category : filters.category_id;
    }

    if ((filters.brand && filters.brand !== 'all') || filters.brand_id) {
      query.brand_id =
        filters.brand !== 'all' ? filters.brand : filters.brand_id;
    }

    if (filters.inStock) {
      query.include_stock = 'true';
    }

    if (filters.minPrice) {
      query.min_price = filters.minPrice;
    }

    if (filters.maxPrice) {
      query.max_price = filters.maxPrice;
    }

    if (filters.pos_optimized) {
      query.pos_optimized = 'true';
    }

    if (filters.barcode) {
      query.barcode = filters.barcode;
    }

    if (filters.include_stock) {
      query.include_stock = 'true';
    }

    const params = this.buildParams(query);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        // Uniform way to extract data and pagination
        let productsResult = [];
        let total = 0;
        let currentPage = page;
        let limitNum = pageSize;

        // Check for the success wrapper
        const responseData = response.success ? response.data : response;

        if (Array.isArray(responseData)) {
          productsResult = responseData;
          total = productsResult.length;
        } else if (responseData && Array.isArray(responseData.data)) {
          // Format { data: [...], pagination: {...} } or { data: [...], meta: {...} }
          productsResult = responseData.data;
          const pagination = responseData.pagination || responseData.meta || response.meta || {};
          total = pagination.total || productsResult.length;
          currentPage = pagination.page || page;
          limitNum = pagination.limit || pageSize;
        } else if (responseData) {
          // Fallback if data is directly in response.data but success check passed
          productsResult = Array.isArray(responseData) ? responseData : [];
          total = response.meta?.total || response.total || productsResult.length;
          currentPage = response.meta?.page || response.page || page;
          limitNum = response.meta?.limit || response.limit || pageSize;
        }

        const totalPages = Math.ceil(total / limitNum);
        const transformedProducts = this.transformProducts(productsResult);

        return {
          products: transformedProducts,
          total,
          page: currentPage,
          pageSize: limitNum,
          totalPages,
        };
      }),
      catchError((error: any) => {
        console.error('PosProductService Error:', error);
        let errorMessage = 'Error al cargar productos';

        if (error.error?.message) {
          errorMessage = error.error.message;
        } else if (error.status === 400) {
          errorMessage = 'Datos inválidos proporcionados';
        } else if (error.status === 401) {
          errorMessage = 'Acceso no autorizado';
        } else if (error.status === 403) {
          errorMessage = 'Permisos insuficientes';
        } else if (error.status === 404) {
          errorMessage = 'Producto no encontrado';
        } else if (error.status >= 500) {
          errorMessage = 'Error del servidor. Por favor intenta más tarde';
        }

        return throwError(() => errorMessage);
      }),
    );
  }

  private transformProducts(products: any[]): any[] {
    return products.map((product) => {
      // Calculate total stock from stock_levels
      let totalStock = 0;
      if (product.stock_levels && Array.isArray(product.stock_levels)) {
        // Sum stock from all locations
        const storeStockLevels = product.stock_levels.filter((level: any) => {
          return level.quantity_available > 0;
        });

        totalStock = storeStockLevels.reduce(
          (sum: number, level: any) => sum + (level.quantity_available || 0),
          0,
        );
      }

      // Fallback to stock_quantity if no stock_levels
      if (totalStock === 0) {
        totalStock = product.stock_quantity || 0;
      }

      // Get image URL with fallbacks - PRIORITIZE signed URL at the root
      let imageUrl = '';
      if (product.image_url) {
        imageUrl = product.image_url;
      } else if (product.product_images && product.product_images.length > 0) {
        imageUrl = product.product_images[0].image_url;
      } else if (product.image) {
        imageUrl = product.image;
      }

      const transformed = {
        id: product.id?.toString() || '',
        name: product.name || '',
        sku: product.sku || '',
        price: parseFloat(product.base_price || product.price || 0),
        final_price: parseFloat(product.final_price || product.base_price || product.price || 0),
        cost: product.cost_price ? parseFloat(product.cost_price) : undefined,
        category:
          product.product_categories && product.product_categories.length > 0
            ? product.product_categories[0].name
            : product.category?.name || 'Sin categoría',
        brand: product.brands?.name || '',
        stock: totalStock,
        minStock: product.min_stock_level || 5,
        image: imageUrl,
        image_url: imageUrl, // Also include as image_url for compatibility
        description: product.description || '',
        barcode: product.barcode || '',
        tags: product.tags || [],
        isActive: product.state === 'active',
        createdAt: new Date(product.created_at),
        updatedAt: new Date(product.updated_at),
        tax_assignments: product.product_tax_assignments || [],
        // Include additional data for debugging
        _rawStockLevels: product.stock_levels,
        _rawStockQuantity: product.stock_quantity,
        _rawImageUrl: product.image_url, // Debug: preserve original
      };

      // Debug log for first product
      if (products.indexOf(product) === 0) {
        console.log('POS Product transform:', {
          original: product,
          transformed,
        });
      }

      return transformed;
    });
  }

  private buildParams(query: any): HttpParams {
    let params = new HttpParams();

    Object.keys(query).forEach((key) => {
      const value = query[key];
      if (value !== undefined && value !== null) {
        params = params.set(key, value.toString());
      }
    });

    return params;
  }

  private handleError(error: any): Observable<never> {
    // Mensajes de error más descriptivos
    let errorMessage = 'An error occurred';

    if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.status === 400) {
      errorMessage = 'Invalid data provided';
    } else if (error.status === 401) {
      errorMessage = 'Unauthorized access';
    } else if (error.status === 403) {
      errorMessage = 'Insufficient permissions';
    } else if (error.status === 404) {
      errorMessage = 'Product not found';
    } else if (error.status === 409) {
      errorMessage = 'Product with this SKU or slug already exists';
    } else if (error.status >= 500) {
      errorMessage = 'Server error. Please try again later';
    }

    return throwError(() => errorMessage);
  }

  getProductById(id: string): Observable<Product | null> {
    return this.http.get<Product>(`${this.apiUrl}/${id}`).pipe(
      catchError((error: any) => {
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
        return of(null);
      }),
    );
  }

  getCategories(): Observable<Category[]> {
    return this.http
      .get<any>(`${environment.apiUrl}/store/categories`)
      .pipe(
        map((response) => {
          const data = response.success ? response.data : response;
          return Array.isArray(data) ? data : (data?.data || []);
        }),
        catchError((error: any) => {
          return of([]);
        }),
      );
  }

  getBrands(): Observable<Brand[]> {
    return this.http.get<any>(`${environment.apiUrl}/store/brands`).pipe(
      map((response) => {
        const data = response.success ? response.data : response;
        return Array.isArray(data) ? data : (data?.data || []);
      }),
      catchError((error: any) => {
        return of([]);
      }),
    );
  }

  // Simplified method similar to ProductsService.getProducts()
  getProducts(query: any = {}): Observable<SearchResult> {
    const default_query = {
      page: 1,
      limit: 50,
      state: 'active',
      ...query,
    };

    const params = this.buildParams(default_query);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        const dataRoot = response.success ? response.data : response;
        let productsResult = [];
        let total = 0;
        let page = default_query.page;
        let limitNum = default_query.limit;

        if (Array.isArray(dataRoot)) {
          productsResult = dataRoot;
          total = productsResult.length;
        } else if (dataRoot && Array.isArray(dataRoot.data)) {
          productsResult = dataRoot.data;
          const pagination = dataRoot.pagination || dataRoot.meta || response.meta || {};
          total = pagination.total || productsResult.length;
          page = pagination.page || page;
          limitNum = pagination.limit || limitNum;
        }

        const transformedProducts = this.transformProducts(productsResult);
        const totalPages = Math.ceil(total / limitNum);

        return {
          products: transformedProducts,
          total,
          page,
          pageSize: limitNum,
          totalPages,
        };
      }),
      catchError((error: any) => {
        console.error('PosProductService.getProducts Error:', error);
        return throwError(() => 'Error al cargar productos');
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
    // This would normally call an endpoint, for now return empty
    return of([]).pipe(delay(200));
  }

  getLowStockProducts(limit: number = 10): Observable<Product[]> {
    // This would normally call an endpoint, for now return empty
    return of([]).pipe(delay(200));
  }

  updateStock(productId: string, quantity: number): Observable<Product | null> {
    // This would normally call an endpoint, for now return null
    return of(null).pipe(delay(100));
  }
}
