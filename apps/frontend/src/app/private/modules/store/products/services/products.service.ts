import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, from, map, switchMap } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { AnalyticsService } from '../../analytics/services/analytics.service';
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
  OnlinePurchaseLinkResult,
  ArchiveWriteOffPlan,
} from '../interfaces';
import {
  BulkImageAnalysisResult,
  BulkImageUploadResult,
} from '../interfaces/bulk-image-analysis.interface';
import {
  BulkProductAnalysisResult,
  BulkProductUploadResult,
} from '../interfaces/bulk-product-analysis.interface';
import { PRODUCT_SAVE_ERROR_MAP } from '../utils/product-save-requirements';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
  message: string;
  error?: string;
  /** Código tipado de error para enrutar al mensaje UX correcto. Opcional
   *  porque solo lo emiten los envelopes que vienen del `AllExceptionsFilter`
   *  (errores), no los `responseService.success()` / `created()` etc. */
  error_code?: string;
}

export interface ProductImageEnhancementRequest {
  image_url: string;
  prompt: string;
  product_name?: string;
  product_type?: 'physical' | 'service';
  description?: string;
  extra_context?: Record<string, any>;
}

export interface ProductImageEnhancementResult {
  image_url: string;
  revised_prompt?: string;
  model?: string;
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

const storeProductsStatsCache = new Map<
  number,
  CacheEntry<Observable<ProductStats>>
>();

@Injectable({
  providedIn: 'root',
})
export class ProductsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  constructor(
    private http: HttpClient,
    private analytics: AnalyticsService,
  ) {}

  /**
   * Valida `response.success` antes de devolver `response.data`. Si el backend
   * respondió HTTP 200 con `success:false`, lanza un objeto que
   * `handleError` / `handleSaveError` / `handleArchiveError` saben leer para
   * preservar `error_code` y `details`. Ver `vendix-error-handling/SKILL.md`.
   *
   * Los controllers backend YA NO deberían producir este caso: el patrón
   * `try/catch + responseService.error()` (FB-09) fue eliminado en
   * `products.controller.ts`. Este guard protege frente a regresiones y a
   * servidores upstream que aún respondan 200+success:false.
   *
   * Sin `this` — seguro pasarlo por referencia como `map(this.unwrap)`.
   */
  private unwrap<T>(response: ApiResponse<T>): T {
    if (!response.success) {
      throw {
        error: response,
        error_code: response.error_code ?? null,
        message:
          response.message || response.error || 'Operación fallida',
      };
    }
    return response.data;
  }

  /**
   * Variante paginada: convierte `ApiResponse<T[]>` con `meta` al shape
   * `PaginatedResponse<T>` que esperan los componentes. Mismo contrato de
   * error que `unwrap`. Sin `this`.
   */
  private unwrapPaginated<T>(
    response: ApiResponse<T[]> & { meta?: any },
  ): PaginatedResponse<T> {
    if (!response.success) {
      throw {
        error: response,
        error_code: response.error_code ?? null,
        message:
          response.message || response.error || 'Operación fallida',
      };
    }
    return {
      data: response.data,
      pagination: response.meta,
    };
  }

  // CRUD Básico
  getProducts(
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams(query);
    return this.http
      .get<ApiResponse<Product[]>>(`${this.apiUrl}/store/products`, { params })
      .pipe(
        map(this.unwrapPaginated),
        catchError(this.handleError),
      );
  }

  getProductById(id: number): Observable<Product> {
    return this.http
      .get<ApiResponse<Product>>(`${this.apiUrl}/store/products/${id}`)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  getProductBySlug(slug: string, storeId: number): Observable<Product> {
    return this.http
      .get<
        ApiResponse<Product>
      >(`${this.apiUrl}/store/products/slug/${slug}/store/${storeId}`)
      .pipe(
        map(this.unwrap),
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
        ApiResponse<Product[]>
      >(`${this.apiUrl}/store/products/store/${storeId}`, { params })
      .pipe(
        map(this.unwrapPaginated),
        catchError(this.handleError),
      );
  }

  createProduct(product: CreateProductDto): Observable<Product> {
    return this.http
      .post<ApiResponse<Product>>(`${this.apiUrl}/store/products`, product)
      .pipe(
        map(this.unwrap),
        // Invalidar el cache de analytics: nuevos productos / cambios de
        // stock_quantity / track_inventory afectan las métricas (Unidades
        // en Mano, Valor en Stock, Bajo Stock). El flag global se consume
        // en el siguiente read del AnalyticsService.
        tap(() => this.analytics.requestInvalidation()),
        // Ruta de error DEDICADA: preserva `error_code` para el modal de
        // requisitos (NO usa el `handleError` compartido que aplana a string).
        catchError(this.handleSaveError),
      );
  }

  updateProduct(id: number, product: UpdateProductDto): Observable<Product> {
    return this.http
      .patch<
        ApiResponse<Product>
      >(`${this.apiUrl}/store/products/${id}`, product)
      .pipe(
        map(this.unwrap),
        // Invalidar cache de analytics por cambios de stock/state.
        tap(() => this.analytics.requestInvalidation()),
        // Ruta de error DEDICADA: preserva `error_code` para el modal de
        // requisitos (NO usa el `handleError` compartido que aplana a string).
        catchError(this.handleSaveError),
      );
  }

  generateOnlinePurchaseLink(id: number): Observable<OnlinePurchaseLinkResult> {
    return this.http
      .post<
        ApiResponse<OnlinePurchaseLinkResult>
      >(`${this.apiUrl}/store/products/${id}/online-purchase-link`, {})
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  deactivateProduct(id: number): Observable<Product> {
    return this.http
      .patch<
        ApiResponse<Product>
      >(`${this.apiUrl}/store/products/${id}/deactivate`, {})
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  /**
   * CP-PURCHASE-TRANSPARENCY D.9 — vista previa del castigo de inventario.
   *
   * `GET /store/products/:id/archive-preview`. Estrictamente de solo lectura:
   * calcula lo que el archivado destruiría SIN destruir nada. Es la primera
   * mitad del flujo de dos tiempos; la segunda es `deleteProduct(id, true)`.
   *
   * Ruta de error DEDICADA (`handleArchiveError`) por la misma razón que abajo.
   */
  previewArchiveWriteOff(id: number): Observable<ArchiveWriteOffPlan> {
    return this.http
      .get<
        ApiResponse<ArchiveWriteOffPlan>
      >(`${this.apiUrl}/store/products/${id}/archive-preview`)
      .pipe(
        map(this.unwrap),
        catchError(this.handleArchiveError),
      );
  }

  /**
   * Archiva el producto. Con `confirmStockWriteOff` da de baja sus existencias.
   *
   * ## POR QUÉ NO USA `handleError`
   *
   * `handleError` APLANA el error a un `string` (`throwError(() => mensaje)`).
   * Con D.4 desplegado eso destruye el flujo entero: el rechazo por existencias
   * llega como 409 `PROD_VARIANT_HAS_STOCK_001` con el plan completo en
   * `details.archive_write_off`, y ese objeto —las unidades, el valor, el
   * desglose por ubicación y variante, las existencias fuera de alcance— es
   * justo lo que el diálogo de confirmación necesita enseñar. Aplanado a una
   * cadena, el operador recibe un toast rojo, no sabe que hay existencias, no
   * sabe que hay una confirmación posible y no tiene botón que la ofrezca.
   *
   * `handleArchiveError` propaga un objeto que preserva `error_code`, `details`
   * y el cuerpo crudo, igual que hace `handleSaveError` para el formulario.
   *
   * ## LA CONFIRMACIÓN VIAJA POR QUERY STRING
   *
   * `DELETE` no lleva cuerpo en este contrato
   * (`products.controller.ts:410-419`). El parámetro solo se añade cuando es
   * `true`: mandar `confirm_stock_write_off=false` sería declarar una decisión
   * que nadie tomó, y el backend ya trata su ausencia como «no confirmado».
   */
  deleteProduct(id: number, confirmStockWriteOff = false): Observable<void> {
    const params = confirmStockWriteOff
      ? new HttpParams().set('confirm_stock_write_off', 'true')
      : undefined;

    return this.http
      .delete<void>(`${this.apiUrl}/store/products/${id}`, { params })
      .pipe(
        // Invalidar cache de analytics por eliminación de producto.
        tap(() => this.analytics.requestInvalidation()),
        catchError(this.handleArchiveError),
      );
  }

  // Gestión de Variantes
  getProductVariants(productId: number): Observable<ProductVariant[]> {
    return this.http
      .get<
        ApiResponse<ProductVariant[]>
      >(`${this.apiUrl}/store/products/${productId}/variants`)
      .pipe(
        map(this.unwrap),
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
        map(this.unwrap),
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
        map(this.unwrap),
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
        map(this.unwrap),
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
        map(this.unwrap),
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
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  // Preview seguro de imagen remota (URL → dataUrl editable)
  // Nota: este endpoint devuelve el objeto crudo (sin envoltorio { success, data })
  getRemoteImagePreview(url: string): Observable<{
    dataUrl: string;
    fileName: string;
    contentType: string;
    byteLength: number;
  }> {
    return this.http
      .post<{
        dataUrl: string;
        fileName: string;
        contentType: string;
        byteLength: number;
      }>(`${this.apiUrl}/upload/remote-image-preview`, { url })
      .pipe(catchError(this.handleError));
  }

  // Generación de descripción con IA
  generateDescription(data: Record<string, any>): Observable<any> {
    return this.http
      .post<
        ApiResponse<any>
      >(`${this.apiUrl}/store/products/generate-description`, data)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  enhanceProductImage(
    data: ProductImageEnhancementRequest,
  ): Observable<ProductImageEnhancementResult> {
    return this.http
      .post<
        ApiResponse<ProductImageEnhancementResult>
      >(`${this.apiUrl}/store/products/enhance-image`, data)
      .pipe(
        map((response) => {
          if (!response?.success || !response.data?.image_url) {
            throw response;
          }

          return response.data;
        }),
      );
  }

  // Estadísticas
  getProductStats(storeId: number): Observable<ProductStats> {
    const now = Date.now();
    const cached = storeProductsStatsCache.get(storeId);

    if (cached && now - cached.lastFetch < this.CACHE_TTL) {
      return cached.observable;
    }

    const url = `${this.apiUrl}/store/products/stats/store/${storeId}`;
    const observable$ = this.http.get<ApiResponse<ProductStats>>(url).pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      map(this.unwrap),
      tap(() => {
        const entry = storeProductsStatsCache.get(storeId);
        if (entry) {
          entry.lastFetch = Date.now();
        }
      }),
      catchError(this.handleError),
    );

    storeProductsStatsCache.set(storeId, {
      observable: observable$,
      lastFetch: now,
    });

    return observable$;
  }

  // Búsqueda y filtros avanzados
  searchProducts(
    search: string,
    query: ProductQueryDto = {},
  ): Observable<PaginatedResponse<Product>> {
    const params = this.buildParams({ ...query, search });
    return this.http
      .get<ApiResponse<Product[]>>(`${this.apiUrl}/store/products/search`, { params })
      .pipe(
        map(this.unwrapPaginated),
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
        ApiResponse<Product[]>
      >(`${this.apiUrl}/store/products/category/${categoryId}`, { params })
      .pipe(
        map(this.unwrapPaginated),
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
        ApiResponse<Product[]>
      >(`${this.apiUrl}/store/products/brand/${brandId}`, { params })
      .pipe(
        map(this.unwrapPaginated),
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
        ApiResponse<Product[]>
      >(`${this.apiUrl}/store/products/low-stock/${threshold}`, { params })
      .pipe(
        map(this.unwrapPaginated),
        catchError(this.handleError),
      );
  }

  // Carga Masiva
  getBulkUploadTemplate(
    type: 'products' | 'services' | 'quick' | 'complete' = 'products',
  ): Observable<Blob> {
    return this.http
      .get(`${this.apiUrl}/store/products/bulk/template/download`, {
        params: { type },
        responseType: 'blob',
      })
      .pipe(catchError(this.handleError));
  }

  /**
   * Descarga un XLSX con los productos actuales de la tienda, en el mismo
   * formato de la plantilla de Carga Masiva + 3 columnas informativas
   * (Precio Compra, Cantidad Actual, Tiene Imagen).
   */
  exportCurrentProducts(): Observable<Blob> {
    return this.http
      .get(`${this.apiUrl}/store/products/bulk/export`, {
        responseType: 'blob',
      })
      .pipe(
        catchError((err) => this.parseBlobError(err, 'exportCurrentProducts')),
      );
  }

  /**
   * Convierte el `error.error` (Blob) en un `Error` con el mensaje legible
   * del backend. Necesario porque `responseType: 'blob'` hace que Angular
   * NO parsee automáticamente el JSON de error, y `extractApiErrorMessage`
   * no puede leer un Blob — termina mostrando "Error desconocido" al usuario.
   */
  private parseBlobError(err: any, context: string): Observable<never> {
    return from(this.extractBlobMessage(err, context)).pipe(
      switchMap((message) => throwError(() => new Error(message))),
    );
  }

  private async extractBlobMessage(err: any, context: string): Promise<string> {
    let backendMessage: string | undefined;
    const blob = err?.error;
    if (blob instanceof Blob) {
      try {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        backendMessage =
          parsed?.error?.message ?? parsed?.message ?? parsed?.error;
      } catch {
        // blob no es JSON parseable — dejamos `backendMessage` undefined
      }
    }
    const message =
      backendMessage ?? err?.message ?? 'Error al exportar la plantilla';
    console.error(`[${context}]`, err, '→ mensaje final:', message);
    return message;
  }

  uploadBulkProducts(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http
      .post<
        ApiResponse<any>
      >(`${this.apiUrl}/store/products/bulk/upload/file`, formData)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  uploadBulkProductsJson(products: any[]): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(`${this.apiUrl}/store/products/bulk/upload`, {
        products,
      })
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  // Carga Masiva de Imágenes
  getBulkImageUploadTemplate(
    type: 'example' | 'store-skus' = 'example',
  ): Observable<Blob> {
    return this.http
      .get(`${this.apiUrl}/store/products/bulk-images/template/download`, {
        params: { type },
        responseType: 'blob',
      })
      .pipe(catchError(this.handleError));
  }

  uploadBulkImages(file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http
      .post<
        ApiResponse<any>
      >(`${this.apiUrl}/store/products/bulk-images/upload`, formData)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  analyzeBulkImages(file: File): Observable<BulkImageAnalysisResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<
        ApiResponse<BulkImageAnalysisResult>
      >(`${this.apiUrl}/store/products/bulk-images/analyze`, formData)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  uploadBulkImagesFromSession(
    sessionId: string,
  ): Observable<BulkImageUploadResult> {
    return this.http
      .post<
        ApiResponse<BulkImageUploadResult>
      >(`${this.apiUrl}/store/products/bulk-images/upload-session`, { session_id: sessionId })
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  // Carga Masiva de Productos (Análisis y Sesión)
  analyzeBulkProducts(file: File): Observable<BulkProductAnalysisResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<
        ApiResponse<BulkProductAnalysisResult>
      >(`${this.apiUrl}/store/products/bulk/analyze`, formData)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  uploadBulkProductsFromSession(
    sessionId: string,
  ): Observable<BulkProductUploadResult> {
    return this.http
      .post<
        ApiResponse<BulkProductUploadResult>
      >(`${this.apiUrl}/store/products/bulk/upload-session`, { session_id: sessionId })
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  cancelBulkProductSession(sessionId: string): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/products/bulk/session/${sessionId}`)
      .pipe(catchError(this.handleError));
  }

  // Promociones del producto
  getProductPromotions(productId: number): Observable<any[]> {
    return this.http
      .get<
        ApiResponse<any[]>
      >(`${this.apiUrl}/store/products/${productId}/promotions`)
      .pipe(
        map(this.unwrap),
        catchError(this.handleError),
      );
  }

  updateProductPromotions(
    productId: number,
    promotionIds: number[],
  ): Observable<any[]> {
    return this.http
      .patch<
        ApiResponse<any[]>
      >(`${this.apiUrl}/store/products/${productId}/promotions`, { promotion_ids: promotionIds })
      .pipe(
        map(this.unwrap),
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
    let errorMessage = 'Ocurrió un error';

    // El backend envía `error_code` (VendixHttpException). Si lo conocemos,
    // usamos el mensaje curado en español del catálogo — así el texto que
    // recibe la UI (modal de requisitos o toast) explica el escenario concreto
    // aunque este handler aplane el error a string y pierda el código.
    const backendCode: string | undefined =
      error?.error?.error_code ?? error?.error_code;

    if (backendCode && PRODUCT_SAVE_ERROR_MAP[backendCode]) {
      errorMessage = PRODUCT_SAVE_ERROR_MAP[backendCode].reason;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    } else if (error.status === 400) {
      errorMessage = 'Datos inválidos proporcionados';
    } else if (error.status === 401) {
      errorMessage = 'Acceso no autorizado';
    } else if (error.status === 403) {
      errorMessage = 'Permisos insuficientes';
    } else if (error.status === 404) {
      errorMessage = 'Producto no encontrado';
    } else if (error.status === 409) {
      errorMessage = 'Ya existe un producto con este SKU o slug';
    } else if (error.status >= 500) {
      errorMessage = 'Error del servidor. Por favor intenta más tarde';
    }

    return throwError(() => errorMessage);
  }

  /**
   * Ruta de error DEDICADA para `createProduct` / `updateProduct`.
   *
   * A diferencia de `handleError` (compartido por el resto de métodos, que
   * aplana el error a un **string** para toasts genéricos y PIERDE el
   * `error_code`), esta ruta propaga un OBJETO que PRESERVA `error_code` y
   * `details`. Así el consumidor puede llamar `mapBackendErrorToRequirements(err)`
   * y alcanzar los casos 1 (`SYS_VALIDATION_001`, desglose por campo) y 2 (mapa
   * curado con label + CTA) del modal de requisitos, en vez de degradar siempre
   * al genérico (case 3).
   *
   * Forma del objeto propagado:
   * - `error_code` / `details`: leídos por `parseApiError` (`body.error_code`).
   * - `message`: texto plano en español para toast/banner cuando el consumidor
   *   NO re-cura por código (reutiliza `PRODUCT_SAVE_ERROR_MAP` igual que
   *   `handleError`, para no perder el texto en español).
   * - `error`: se preserva el cuerpo CRUDO del backend para que
   *   `mapBackendErrorToRequirements` pueda desambiguar `PROD_VALIDATE_001` con
   *   el detalle real de la regla (`readBackendMessage` lee `err.error.message`)
   *   y para que `extractApiErrorMessage` resuelva el mensaje de `ERROR_MESSAGES`.
   *
   * No usa `this` (igual que `handleError`), por lo que es seguro pasarlo por
   * referencia a `catchError(this.handleSaveError)`.
   */
  private handleSaveError(error: any): Observable<never> {
    console.error('ProductsService Save Error:', error);

    const backendCode: string | undefined =
      error?.error?.error_code ?? error?.error_code;

    // Misma cascada de resolución de mensaje curado que `handleError`.
    let message = 'No se pudo guardar el producto';
    if (backendCode && PRODUCT_SAVE_ERROR_MAP[backendCode]) {
      message = PRODUCT_SAVE_ERROR_MAP[backendCode].reason;
    } else if (typeof error === 'string') {
      message = error;
    } else if (error?.error?.message) {
      message = error.error.message;
    } else if (error?.message) {
      message = error.message;
    } else if (error?.status === 400) {
      message = 'Datos inválidos proporcionados';
    } else if (error?.status === 401) {
      message = 'Acceso no autorizado';
    } else if (error?.status === 403) {
      message = 'Permisos insuficientes';
    } else if (error?.status === 404) {
      message = 'Producto no encontrado';
    } else if (error?.status === 409) {
      message = 'Ya existe un producto con este SKU o slug';
    } else if (error?.status >= 500) {
      message = 'Error del servidor. Por favor intenta más tarde';
    }

    return throwError(() => ({
      error_code: backendCode ?? null,
      message,
      details: error?.error?.details ?? null,
      error: error?.error ?? undefined,
    }));
  }

  /**
   * Ruta de error DEDICADA para el archivado (D.9): `previewArchiveWriteOff` y
   * `deleteProduct`.
   *
   * PRESERVA EL OBJETO. `handleError` aplana a `string` y con eso desaparece
   * `details.archive_write_off` —el plan del castigo que el backend devuelve
   * junto al 409— y también el `error_code`, así que el consumidor no puede ni
   * distinguir «hay existencias, confirma» de «no tienes permiso».
   *
   * Tampoco reescribe el 409 como «Ya existe un producto con este SKU o slug»,
   * que es lo que hacía `handleError` y era falso para esta ruta: en el
   * archivado un 409 significa existencias, reservas activas o falta de
   * confirmación, nunca un conflicto de unicidad.
   *
   * No usa `this`, por lo que es seguro pasarlo por referencia a `catchError`.
   */
  private handleArchiveError(error: any): Observable<never> {
    console.error('ProductsService Archive Error:', error);

    const body = error?.error ?? error;
    const backendCode: string | undefined =
      body?.error_code ?? error?.error_code;

    let message = 'No se pudo eliminar el producto';
    if (backendCode && PRODUCT_SAVE_ERROR_MAP[backendCode]) {
      message = PRODUCT_SAVE_ERROR_MAP[backendCode].reason;
    } else if (typeof error === 'string') {
      message = error;
    } else if (typeof body?.message === 'string') {
      message = body.message;
    } else if (typeof error?.message === 'string') {
      message = error.message;
    } else if (error?.status === 401) {
      message = 'Acceso no autorizado';
    } else if (error?.status === 403) {
      message = 'No tienes permiso para eliminar productos';
    } else if (error?.status === 404) {
      message = 'Producto no encontrado';
    } else if (error?.status >= 500) {
      message = 'Error del servidor. Por favor intenta más tarde';
    }

    return throwError(() => ({
      error_code: backendCode ?? null,
      message,
      status: error?.status ?? null,
      details: body?.details ?? null,
      error: body ?? undefined,
    }));
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar productos
   * @param storeId - ID de la tienda. Si no se proporciona, se limpia todo el caché
   */
  invalidateCache(storeId?: number): void {
    if (storeId) {
      storeProductsStatsCache.delete(storeId);
    } else {
      storeProductsStatsCache.clear();
    }
  }
}
