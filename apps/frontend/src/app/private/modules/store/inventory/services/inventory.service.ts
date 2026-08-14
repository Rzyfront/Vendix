import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { TenantCacheRegistry } from '../../../../../../core/services/tenant-cache-registry.service';
import {
  InventoryLocation,
  CreateLocationDto,
  UpdateLocationDto,
  InventoryAdjustment,
  CreateAdjustmentDto,
  AdjustmentQueryDto,
  AdjustmentListResponse,
  AdjustableProduct,
  BatchCreateAdjustmentsRequest,
  InventoryMovement,
  CreateMovementDto,
  MovementQueryDto,
  StockLevel,
  InventoryStats,
  InventoryBatch,
  ApiResponse,
  PaginatedResponse,
  PaginatedApiResponse,
} from '../interfaces';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let inventoryStatsCache: CacheEntry<Observable<ApiResponse<InventoryStats>>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class InventoryService {
  private readonly base_url = `${environment.apiUrl}/store/inventory`;
  private readonly CACHE_TTL = 30000; // 30 segundos
  private tenantCacheRegistry = inject(TenantCacheRegistry);

  constructor(private http: HttpClient) {
    // QUI-563 Fase 2: register the module-level cache so the switch
    // service evicts it on store change.
    this.tenantCacheRegistry.register(
      'store-inventory-stats',
      () => {
        inventoryStatsCache = null;
      },
      'InventoryService',
    );
  }

  // ============================================================
  // LOCATIONS
  // ============================================================

  getLocations(query: any = {}): Observable<ApiResponse<InventoryLocation[]>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<InventoryLocation[]>
      >(`${this.base_url}/locations`, { params })
      .pipe(catchError(this.handleError));
  }

  getLocationById(id: number): Observable<ApiResponse<InventoryLocation>> {
    return this.http
      .get<ApiResponse<InventoryLocation>>(`${this.base_url}/locations/${id}`)
      .pipe(catchError(this.handleError));
  }

  createLocation(
    data: CreateLocationDto,
  ): Observable<ApiResponse<InventoryLocation>> {
    return this.http
      .post<ApiResponse<InventoryLocation>>(`${this.base_url}/locations`, data)
      .pipe(catchError(this.handleError));
  }

  updateLocation(
    id: number,
    data: UpdateLocationDto,
  ): Observable<ApiResponse<InventoryLocation>> {
    return this.http
      .patch<
        ApiResponse<InventoryLocation>
      >(`${this.base_url}/locations/${id}`, data)
      .pipe(catchError(this.handleError));
  }

  deleteLocation(id: number): Observable<ApiResponse<void>> {
    return this.http
      .delete<ApiResponse<void>>(`${this.base_url}/locations/${id}`)
      .pipe(catchError(this.handleError));
  }

  // ============================================================
  // ADJUSTMENTS
  // ============================================================

  // `hasMore` en camelCase es lo que responde el backend; el `has_more` que se
  // declaraba acá nunca existió en el cuerpo, así que siempre llegaba undefined.
  getAdjustments(query: AdjustmentQueryDto = {}): Observable<
    ApiResponse<AdjustmentListResponse>
  > {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<AdjustmentListResponse>
      >(`${this.base_url}/adjustments`, { params })
      .pipe(catchError(this.handleError));
  }

  getAdjustmentById(id: number): Observable<ApiResponse<InventoryAdjustment>> {
    return this.http
      .get<
        ApiResponse<InventoryAdjustment>
      >(`${this.base_url}/adjustments/${id}`)
      .pipe(catchError(this.handleError));
  }

  createAdjustment(
    data: CreateAdjustmentDto,
  ): Observable<ApiResponse<InventoryAdjustment>> {
    return this.http
      .post<
        ApiResponse<InventoryAdjustment>
      >(`${this.base_url}/adjustments`, data)
      .pipe(catchError(this.handleError));
  }

  /**
   * El aprobador ya no viaja en el body: el backend lo resuelve del contexto de
   * la petición. Antes se enviaba `approved_by_user_id` (con un `0` literal) y
   * el controlador leía `approvedByUserId`, así que el dato nunca llegaba y la
   * columna quedaba en NULL.
   */
  approveAdjustment(
    id: number,
  ): Observable<ApiResponse<InventoryAdjustment>> {
    return this.http
      .patch<
        ApiResponse<InventoryAdjustment>
      >(`${this.base_url}/adjustments/${id}/approve`, {})
      .pipe(catchError(this.handleError));
  }

  deleteAdjustment(id: number): Observable<ApiResponse<void>> {
    return this.http
      .delete<ApiResponse<void>>(`${this.base_url}/adjustments/${id}`)
      .pipe(catchError(this.handleError));
  }

  searchAdjustableProducts(
    search: string,
    location_id: number,
    limit?: number,
  ): Observable<ApiResponse<AdjustableProduct[]>> {
    let params = new HttpParams()
      .set('search', search)
      .set('location_id', location_id.toString());
    if (limit) params = params.set('limit', limit.toString());

    return this.http
      .get<
        ApiResponse<AdjustableProduct[]>
      >(`${this.base_url}/adjustments/search-products`, { params })
      .pipe(catchError(this.handleError));
  }

  batchCreateAdjustments(
    dto: BatchCreateAdjustmentsRequest,
  ): Observable<ApiResponse<InventoryAdjustment[]>> {
    return this.http
      .post<
        ApiResponse<InventoryAdjustment[]>
      >(`${this.base_url}/adjustments/batch`, dto)
      .pipe(catchError(this.handleError));
  }

  batchCreateAndComplete(
    dto: BatchCreateAdjustmentsRequest,
  ): Observable<ApiResponse<InventoryAdjustment[]>> {
    return this.http
      .post<
        ApiResponse<InventoryAdjustment[]>
      >(`${this.base_url}/adjustments/batch-complete`, dto)
      .pipe(catchError(this.handleError));
  }

  getAdjustmentSummary(
    organization_id: number,
    start_date?: string,
    end_date?: string,
  ): Observable<ApiResponse<any>> {
    let params = new HttpParams().set(
      'organization_id',
      organization_id.toString(),
    );
    if (start_date) params = params.set('start_date', start_date);
    if (end_date) params = params.set('end_date', end_date);

    return this.http
      .get<ApiResponse<any>>(`${this.base_url}/adjustments/summary`, { params })
      .pipe(catchError(this.handleError));
  }

  // ============================================================
  // MOVEMENTS (Transfers)
  // ============================================================

  getMovements(
    query: MovementQueryDto = {},
  ): Observable<PaginatedApiResponse<InventoryMovement>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        PaginatedApiResponse<InventoryMovement>
      >(`${this.base_url}/movements`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Conteos de TODO el conjunto filtrado, para las tarjetas. La página del
   * listado no sirve para calcularlos: son 25 filas y la tarjeta habla del
   * total, así que el agregado se pide al backend con el MISMO filtro.
   */
  getMovementStats(
    query: MovementQueryDto = {},
  ): Observable<
    ApiResponse<{
      total: number;
      stock_in: number;
      stock_out: number;
      transfers: number;
    }>
  > {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<{
          total: number;
          stock_in: number;
          stock_out: number;
          transfers: number;
        }>
      >(`${this.base_url}/movements/stats`, { params })
      .pipe(catchError(this.handleError));
  }

  getMovementById(id: number): Observable<ApiResponse<InventoryMovement>> {
    return this.http
      .get<ApiResponse<InventoryMovement>>(`${this.base_url}/movements/${id}`)
      .pipe(catchError(this.handleError));
  }

  createMovement(
    data: CreateMovementDto,
  ): Observable<ApiResponse<InventoryMovement>> {
    return this.http
      .post<ApiResponse<InventoryMovement>>(`${this.base_url}/movements`, data)
      .pipe(catchError(this.handleError));
  }

  // ============================================================
  // STOCK LEVELS
  // ============================================================

  getStockLevels(location_id?: number): Observable<ApiResponse<StockLevel[]>> {
    let params = new HttpParams();
    if (location_id) params = params.set('location_id', location_id.toString());

    return this.http
      .get<
        ApiResponse<StockLevel[]>
      >(`${this.base_url}/stock-levels`, { params })
      .pipe(catchError(this.handleError));
  }

  getStockByProduct(
    product_id: number,
    organization_id?: number,
  ): Observable<ApiResponse<StockLevel[]>> {
    let params = new HttpParams();
    if (organization_id)
      params = params.set('organization_id', organization_id.toString());

    return this.http
      .get<
        ApiResponse<StockLevel[]>
      >(`${this.base_url}/consolidated-stock/product/${product_id}`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get stock levels by product with location details
   * Endpoint: GET /store/inventory/stock-levels/product/:productId
   */
  getStockLevelsByProduct(
    product_id: number,
    location_id?: number,
  ): Observable<ApiResponse<StockLevel[]>> {
    let params = new HttpParams();
    if (location_id) params = params.set('location_id', location_id.toString());

    return this.http
      .get<
        ApiResponse<StockLevel[]>
      >(`${this.base_url}/stock-levels/product/${product_id}`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get batches by product (and optionally by location)
   * Endpoint: GET /store/inventory/stock-levels/product/:productId/batches
   */
  getBatchesByProduct(
    product_id: number,
    location_id?: number,
  ): Observable<ApiResponse<InventoryBatch[]>> {
    let params = new HttpParams();
    if (location_id) params = params.set('location_id', location_id.toString());

    return this.http
      .get<
        ApiResponse<InventoryBatch[]>
      >(`${this.base_url}/stock-levels/product/${product_id}/batches`, { params })
      .pipe(catchError(this.handleError));
  }

  // ============================================================
  // STATS / DASHBOARD
  // ============================================================

  getInventoryStats(): Observable<ApiResponse<InventoryStats>> {
    const now = Date.now();

    if (inventoryStatsCache && (now - inventoryStatsCache.lastFetch) < this.CACHE_TTL) {
      return inventoryStatsCache.observable;
    }

    const observable$ = this.http
      .get<ApiResponse<InventoryStats>>(`${this.base_url}/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (inventoryStatsCache) {
            inventoryStatsCache.lastFetch = Date.now();
          }
        }),
        catchError(this.handleError),
      );

    inventoryStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  // ============================================================
  // BULK ADJUSTMENTS
  // ============================================================

  downloadAdjustmentTemplate(location_id?: number): Observable<Blob> {
    let params = new HttpParams();
    if (location_id) params = params.set('location_id', location_id.toString());

    return this.http
      .get(`${this.base_url}/adjustments/bulk/template/download`, {
        params,
        responseType: 'blob',
      })
      .pipe(catchError(this.handleError));
  }

  uploadBulkAdjustments(
    file: File,
    location_id: number,
    adjustment_type: string = 'count_variance',
    description?: string,
  ): Observable<ApiResponse<any>> {
    const form_data = new FormData();
    form_data.append('file', file);
    form_data.append('location_id', location_id.toString());
    form_data.append('adjustment_type', adjustment_type);
    if (description) form_data.append('description', description);

    return this.http
      .post<ApiResponse<any>>(
        `${this.base_url}/adjustments/bulk/upload`,
        form_data,
      )
      .pipe(catchError(this.handleError));
  }

  // ============================================================
  // RESERVATIONS
  // ============================================================

  releaseReservationsByProduct(
    product_id: number,
    product_variant_id?: number,
  ): Observable<ApiResponse<{ released_count: number; total_quantity: number }>> {
    const body: any = { product_id };
    if (product_variant_id) body.product_variant_id = product_variant_id;

    return this.http
      .post<
        ApiResponse<{ released_count: number; total_quantity: number }>
      >(`${this.base_url}/adjustments/reservations/release-by-product`, body)
      .pipe(catchError(this.handleError));
  }

  releaseAllReservations(): Observable<ApiResponse<{ released_count: number; total_quantity: number }>> {
    return this.http
      .post<
        ApiResponse<{ released_count: number; total_quantity: number }>
      >(`${this.base_url}/adjustments/reservations/release-all`, {})
      .pipe(catchError(this.handleError));
  }

  // ============================================================
  // Utilities
  // ============================================================

  private buildParams(query: Record<string, any>): HttpParams {
    let params = new HttpParams();
    Object.keys(query).forEach((key) => {
      const value = query[key];
      if (value !== undefined && value !== null) {
        params = params.set(key, value.toString());
      }
    });
    return params;
  }

  // Un solo traductor de errores para toda la app: `extractApiErrorMessage`
  // resuelve el `error_code` tipado contra ERROR_MESSAGES y sólo cae a los
  // genéricos por status si no hay código. La versión que vivía acá mostraba el
  // `message` del backend —el mensaje de DESARROLLO, en inglés— directo al
  // usuario, que es justo lo que parse-api-error prohíbe.
  private handleError(error: any): Observable<never> {
    console.error('InventoryService Error:', error);
    return throwError(() => extractApiErrorMessage(error));
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar inventario
   */
  invalidateCache(): void {
    inventoryStatsCache = null;
  }
}
