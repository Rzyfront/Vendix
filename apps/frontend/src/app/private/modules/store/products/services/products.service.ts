import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import {
  Product,
  ProductVariant,
  ProductImage,
  CreateProductDto,
  UpdateProductDto,
  CreateProductVariantDto,
  CreateProductImageDto,
  ProductQueryDto,
  PaginatedResponse,
  ProductStats,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class ProductsService {
  private readonly baseUrl = '/products';

  constructor(private http: HttpClient) {}

  // CRUD Básico
  getProducts(
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<PaginatedResponse<Product>>(this.baseUrl, { params })
      .pipe(catchError(this.handleError));
  }

  getProductById(id: number): Observable<Product> {
    return this.http
      .get<Product>(`${this.baseUrl}/${id}`)
      .pipe(catchError(this.handleError));
  }

  getProductBySlug(slug: string, storeId: number): Observable<Product> {
    return this.http
      .get<Product>(`${this.baseUrl}/slug/${slug}/store/${storeId}`)
      .pipe(catchError(this.handleError));
  }

  getProductsByStore(
    storeId: number,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        PaginatedResponse<Product>
      >(`${this.baseUrl}/store/${storeId}`, { params })
      .pipe(catchError(this.handleError));
  }

  createProduct(product: CreateProductDto): Observable<Product> {
    return this.http
      .post<Product>(this.baseUrl, product)
      .pipe(catchError(this.handleError));
  }

  updateProduct(id: number, product: UpdateProductDto): Observable<Product> {
    return this.http
      .patch<Product>(`${this.baseUrl}/${id}`, product)
      .pipe(catchError(this.handleError));
  }

  deactivateProduct(id: number): Observable<Product> {
    return this.http
      .patch<Product>(`${this.baseUrl}/${id}/deactivate`, {})
      .pipe(catchError(this.handleError));
  }

  deleteProduct(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/${id}`)
      .pipe(catchError(this.handleError));
  }

  // Gestión de Variantes
  getProductVariants(productId: number): Observable<ProductVariant[]> {
    return this.http
      .get<ProductVariant[]>(`${this.baseUrl}/${productId}/variants`)
      .pipe(catchError(this.handleError));
  }

  createProductVariant(
    productId: number,
    variant: CreateProductVariantDto,
  ): Observable<ProductVariant> {
    return this.http
      .post<ProductVariant>(`${this.baseUrl}/${productId}/variants`, variant)
      .pipe(catchError(this.handleError));
  }

  updateProductVariant(
    variantId: number,
    variant: Partial<CreateProductVariantDto>,
  ): Observable<ProductVariant> {
    return this.http
      .patch<ProductVariant>(`${this.baseUrl}/variants/${variantId}`, variant)
      .pipe(catchError(this.handleError));
  }

  deleteProductVariant(variantId: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/variants/${variantId}`)
      .pipe(catchError(this.handleError));
  }

  // Gestión de Imágenes
  getProductImages(productId: number): Observable<ProductImage[]> {
    return this.http
      .get<ProductImage[]>(`${this.baseUrl}/${productId}/images`)
      .pipe(catchError(this.handleError));
  }

  addProductImage(
    productId: number,
    image: CreateProductImageDto,
  ): Observable<ProductImage> {
    return this.http
      .post<ProductImage>(`${this.baseUrl}/${productId}/images`, image)
      .pipe(catchError(this.handleError));
  }

  deleteProductImage(imageId: number): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/images/${imageId}`)
      .pipe(catchError(this.handleError));
  }

  setMainImage(productId: number, imageId: number): Observable<ProductImage> {
    return this.http
      .patch<ProductImage>(
        `${this.baseUrl}/${productId}/images/${imageId}/main`,
        {},
      )
      .pipe(catchError(this.handleError));
  }

  // Estadísticas
  getProductStats(storeId?: number): Observable<ProductStats> {
    const url = storeId
      ? `${this.baseUrl}/stats/store/${storeId}`
      : `${this.baseUrl}/stats`;
    return this.http.get<ProductStats>(url).pipe(catchError(this.handleError));
  }

  // Búsqueda y filtros avanzados
  searchProducts(
    search: string,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams({ ...query, search });
    return this.http
      .get<PaginatedResponse<Product>>(`${this.baseUrl}/search`, { params })
      .pipe(catchError(this.handleError));
  }

  getProductsByCategory(
    categoryId: number,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        PaginatedResponse<Product>
      >(`${this.baseUrl}/category/${categoryId}`, { params })
      .pipe(catchError(this.handleError));
  }

  getProductsByBrand(
    brandId: number,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        PaginatedResponse<Product>
      >(`${this.baseUrl}/brand/${brandId}`, { params })
      .pipe(catchError(this.handleError));
  }

  getLowStockProducts(
    threshold: number = 10,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams({ ...query, limit: 100 }); // Límite para bajo stock
    return this.http
      .get<
        PaginatedResponse<Product>
      >(`${this.baseUrl}/low-stock/${threshold}`, { params })
      .pipe(catchError(this.handleError));
  }

  // Utilidades
  private buildParams(query: ProductQueryDto): HttpParams {
    let params = new HttpParams();

    Object.keys(query).forEach((key) => {
      const value = query[key as keyof ProductQueryDto];
      if (value !== undefined && value !== null) {
        params = params.set(key, value.toString());
      }
    });

    return params;
  }

  private handleError(error: any): Observable<never> {
    console.error('ProductsService Error:', error);

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
}
