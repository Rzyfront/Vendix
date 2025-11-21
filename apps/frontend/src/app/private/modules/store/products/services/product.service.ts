import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Product,
  ProductQueryDto,
  PaginatedResponse,
  CreateProductDto,
  UpdateProductDto,
  ProductStats,
  ProductCategory,
  Brand,
} from '../interfaces/product.interface';

@Injectable({
  providedIn: 'root',
})
export class ProductService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = `${environment.apiUrl}/products`;

  // BehaviorSubject for real-time updates
  private productsSubject = new BehaviorSubject<Product[]>([]);
  private loadingSubject = new BehaviorSubject<boolean>(false);
  private paginationSubject = new BehaviorSubject<any>(null);

  products$ = this.productsSubject.asObservable();
  loading$ = this.loadingSubject.asObservable();
  pagination$ = this.paginationSubject.asObservable();

  /**
   * Get products with pagination and filtering
   */
  getProducts(query: ProductQueryDto): Observable<PaginatedResponse<Product>> {
    this.loadingSubject.next(true);

    return this.http.get<PaginatedResponse<Product>>(this.API_URL, {
      params: this.buildQueryParams(query),
    });
  }

  /**
   * Get product by ID
   */
  getProductById(id: number): Observable<Product> {
    return this.http.get<Product>(`${this.API_URL}/${id}`);
  }

  /**
   * Get product by slug
   */
  getProductBySlug(slug: string): Observable<Product> {
    return this.http.get<Product>(`${this.API_URL}/slug/${slug}`);
  }

  /**
   * Create new product
   */
  createProduct(productData: CreateProductDto): Observable<Product> {
    return this.http.post<Product>(this.API_URL, productData);
  }

  /**
   * Update existing product
   */
  updateProduct(
    id: number,
    productData: UpdateProductDto,
  ): Observable<Product> {
    return this.http.patch<Product>(`${this.API_URL}/${id}`, productData);
  }

  /**
   * Delete product (soft delete)
   */
  deleteProduct(id: number): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`);
  }

  /**
   * Archive product
   */
  archiveProduct(id: number): Observable<Product> {
    return this.http.patch<Product>(`${this.API_URL}/${id}/archive`, {});
  }

  /**
   * Restore archived product
   */
  restoreProduct(id: number): Observable<Product> {
    return this.http.patch<Product>(`${this.API_URL}/${id}/restore`, {});
  }

  /**
   * Get product statistics
   */
  getProductStats(storeId?: number): Observable<ProductStats> {
    const url = storeId
      ? `${this.API_URL}/stats?store_id=${storeId}`
      : `${this.API_URL}/stats`;
    return this.http.get<ProductStats>(url);
  }

  /**
   * Get product categories
   */
  getCategories(storeId?: number): Observable<ProductCategory[]> {
    const url = storeId
      ? `${this.API_URL}/categories?store_id=${storeId}`
      : `${this.API_URL}/categories`;
    return this.http.get<ProductCategory[]>(url);
  }

  /**
   * Get product brands
   */
  getBrands(storeId?: number): Observable<Brand[]> {
    const url = storeId
      ? `${this.API_URL}/brands?store_id=${storeId}`
      : `${this.API_URL}/brands`;
    return this.http.get<Brand[]>(url);
  }

  /**
   * Search products with autocomplete
   */
  searchProducts(query: string, limit: number = 10): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.API_URL}/search`, {
      params: { q: query, limit },
    });
  }

  /**
   * Get low stock products
   */
  getLowStockProducts(
    threshold: number = 10,
    storeId?: number,
  ): Observable<Product[]> {
    const params: any = { threshold };
    if (storeId) params.store_id = storeId;

    return this.http.get<Product[]>(`${this.API_URL}/low-stock`, { params });
  }

  /**
   * Get out of stock products
   */
  getOutOfStockProducts(storeId?: number): Observable<Product[]> {
    const url = storeId
      ? `${this.API_URL}/out-of-stock?store_id=${storeId}`
      : `${this.API_URL}/out-of-stock`;
    return this.http.get<Product[]>(url);
  }

  /**
   * Update product stock
   */
  updateStock(
    productId: number,
    quantity: number,
    locationId?: number,
  ): Observable<Product> {
    const body: any = { quantity };
    if (locationId) body.location_id = locationId;

    return this.http.patch<Product>(`${this.API_URL}/${productId}/stock`, body);
  }

  /**
   * Bulk update products
   */
  bulkUpdateProducts(
    updates: { id: number; data: UpdateProductDto }[],
  ): Observable<Product[]> {
    return this.http.patch<Product[]>(`${this.API_URL}/bulk`, { updates });
  }

  /**
   * Import products from CSV
   */
  importProducts(
    file: File,
  ): Observable<{ imported: number; errors: string[] }> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<{ imported: number; errors: string[] }>(
      `${this.API_URL}/import`,
      formData,
    );
  }

  /**
   * Export products to CSV
   */
  exportProducts(query: ProductQueryDto): Observable<Blob> {
    return this.http.get(`${this.API_URL}/export`, {
      params: this.buildQueryParams(query),
      responseType: 'blob',
    });
  }

  /**
   * Update local products array (for real-time updates)
   */
  updateLocalProducts(products: Product[]): void {
    this.productsSubject.next(products);
  }

  /**
   * Add product to local array
   */
  addLocalProduct(product: Product): void {
    const currentProducts = this.productsSubject.value;
    this.productsSubject.next([...currentProducts, product]);
  }

  /**
   * Update product in local array
   */
  updateLocalProduct(updatedProduct: Product): void {
    const currentProducts = this.productsSubject.value;
    const index = currentProducts.findIndex((p) => p.id === updatedProduct.id);

    if (index !== -1) {
      const updatedProducts = [...currentProducts];
      updatedProducts[index] = updatedProduct;
      this.productsSubject.next(updatedProducts);
    }
  }

  /**
   * Remove product from local array
   */
  removeLocalProduct(productId: number): void {
    const currentProducts = this.productsSubject.value;
    const filteredProducts = currentProducts.filter((p) => p.id !== productId);
    this.productsSubject.next(filteredProducts);
  }

  /**
   * Set loading state
   */
  setLoading(loading: boolean): void {
    this.loadingSubject.next(loading);
  }

  /**
   * Set pagination data
   */
  setPagination(pagination: any): void {
    this.paginationSubject.next(pagination);
  }

  /**
   * Build query parameters from ProductQueryDto
   */
  private buildQueryParams(query: ProductQueryDto): any {
    const params: any = {};

    if (query.page) params.page = query.page;
    if (query.limit) params.limit = query.limit;
    if (query.search) params.search = query.search;
    if (query.state) params.state = query.state;
    if (query.store_id) params.store_id = query.store_id;
    if (query.category_id) params.category_id = query.category_id;
    if (query.brand_id) params.brand_id = query.brand_id;
    if (query.include_inactive !== undefined)
      params.include_inactive = query.include_inactive;
    if (query.pos_optimized !== undefined)
      params.pos_optimized = query.pos_optimized;
    if (query.barcode) params.barcode = query.barcode;
    if (query.include_stock !== undefined)
      params.include_stock = query.include_stock;

    return params;
  }
}
