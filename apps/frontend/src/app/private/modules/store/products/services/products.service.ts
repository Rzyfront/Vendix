import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
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

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class ProductsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // CRUD Básico
  getProducts(
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<PaginatedResponse<Product>>
      >(`${this.apiUrl}/store/products`, { params })
      .pipe(
        map(
          (response: any) =>
            ({
              data: response.data,
              pagination: response.meta,
            }) as PaginatedResponse<Product>,
        ),
        catchError(this.handleError),
      );
  }

  getProductById(id: number): Observable<Product> {
    return this.http
      .get<ApiResponse<Product>>(`${this.apiUrl}/store/products/${id}`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getProductBySlug(slug: string, storeId: number): Observable<Product> {
    return this.http
      .get<
        ApiResponse<Product>
      >(`${this.apiUrl}/store/products/slug/${slug}/store/${storeId}`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getProductsByStore(
    storeId: number,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<PaginatedResponse<Product>>
      >(`${this.apiUrl}/store/products/store/${storeId}`, { params })
      .pipe(
        map(
          (response: any) =>
            ({
              data: response.data,
              pagination: response.meta,
            }) as PaginatedResponse<Product>,
        ),
        catchError(this.handleError),
      );
  }

  createProduct(product: CreateProductDto): Observable<Product> {
    return this.http
      .post<ApiResponse<Product>>(`${this.apiUrl}/store/products`, product)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  updateProduct(id: number, product: UpdateProductDto): Observable<Product> {
    return this.http
      .patch<
        ApiResponse<Product>
      >(`${this.apiUrl}/store/products/${id}`, product)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deactivateProduct(id: number): Observable<Product> {
    return this.http
      .patch<
        ApiResponse<Product>
      >(`${this.apiUrl}/store/products/${id}/deactivate`, {})
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteProduct(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/products/${id}`)
      .pipe(catchError(this.handleError));
  }

  // Gestión de Variantes
  getProductVariants(productId: number): Observable<ProductVariant[]> {
    return this.http
      .get<
        ApiResponse<ProductVariant[]>
      >(`${this.apiUrl}/store/products/${productId}/variants`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  createProductVariant(
    productId: number,
    variant: CreateProductVariantDto,
  ): Observable<ProductVariant> {
    return this.http
      .post<
        ApiResponse<ProductVariant>
      >(`${this.apiUrl}/store/products/${productId}/variants`, variant)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  updateProductVariant(
    variantId: number,
    variant: Partial<CreateProductVariantDto>,
  ): Observable<ProductVariant> {
    return this.http
      .patch<
        ApiResponse<ProductVariant>
      >(`${this.apiUrl}/store/products/variants/${variantId}`, variant)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteProductVariant(variantId: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/products/variants/${variantId}`)
      .pipe(catchError(this.handleError));
  }

  // Gestión de Imágenes
  getProductImages(productId: number): Observable<ProductImage[]> {
    return this.http
      .get<
        ApiResponse<ProductImage[]>
      >(`${this.apiUrl}/store/products/${productId}/images`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  addProductImage(
    productId: number,
    image: CreateProductImageDto,
  ): Observable<ProductImage> {
    return this.http
      .post<
        ApiResponse<ProductImage>
      >(`${this.apiUrl}/store/products/${productId}/images`, image)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteProductImage(imageId: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/products/images/${imageId}`)
      .pipe(catchError(this.handleError));
  }

  setMainImage(productId: number, imageId: number): Observable<ProductImage> {
    return this.http
      .patch<
        ApiResponse<ProductImage>
      >(`${this.apiUrl}/store/products/${productId}/images/${imageId}/main`, {})
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  // Estadísticas
  getProductStats(storeId: number): Observable<ProductStats> {
    const url = `${this.apiUrl}/store/products/stats/store/${storeId}`;
    return this.http.get<ApiResponse<ProductStats>>(url).pipe(
      map((response) => response.data),
      catchError(this.handleError),
    );
  }

  // Búsqueda y filtros avanzados
  searchProducts(
    search: string,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams({ ...query, search });
    return this.http
      .get<
        ApiResponse<PaginatedResponse<Product>>
      >(`${this.apiUrl}/store/products/search`, { params })
      .pipe(
        map(
          (response: any) =>
            ({
              data: response.data,
              pagination: response.meta,
            }) as PaginatedResponse<Product>,
        ),
        catchError(this.handleError),
      );
  }

  getProductsByCategory(
    categoryId: number,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<PaginatedResponse<Product>>
      >(`${this.apiUrl}/store/products/category/${categoryId}`, { params })
      .pipe(
        map(
          (response: any) =>
            ({
              data: response.data,
              pagination: response.meta,
            }) as PaginatedResponse<Product>,
        ),
        catchError(this.handleError),
      );
  }

  getProductsByBrand(
    brandId: number,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<PaginatedResponse<Product>>
      >(`${this.apiUrl}/store/products/brand/${brandId}`, { params })
      .pipe(
        map(
          (response: any) =>
            ({
              data: response.data,
              pagination: response.meta,
            }) as PaginatedResponse<Product>,
        ),
        catchError(this.handleError),
      );
  }

  getLowStockProducts(
    threshold: number = 10,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams({ ...query, limit: 100 }); // Límite para bajo stock
    return this.http
      .get<
        ApiResponse<PaginatedResponse<Product>>
      >(`${this.apiUrl}/store/products/low-stock/${threshold}`, { params })
      .pipe(
        map(
          (response: any) =>
            ({
              data: response.data,
              pagination: response.meta,
            }) as PaginatedResponse<Product>,
        ),
        catchError(this.handleError),
      );
  }

  // Carga Masiva
  getBulkUploadTemplate(
    type: 'quick' | 'complete' = 'quick',
  ): Observable<Blob> {
    return this.http
      .get(`${this.apiUrl}/store/products/bulk/template/download`, {
        params: { type },
        responseType: 'blob',
      })
      .pipe(catchError(this.handleError));
  }

  uploadBulkProducts(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http
      .post<
        ApiResponse<any>
      >(`${this.apiUrl}/store/products/bulk/upload/file`, formData)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  uploadBulkProductsJson(products: any[]): Observable<any> {
    return this.http
      .post<
        ApiResponse<any>
      >(`${this.apiUrl}/store/products/bulk/upload/json`, { products })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
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
