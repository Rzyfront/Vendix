import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  InventoryLocation,
  CreateLocationDto,
  UpdateLocationDto,
  InventoryAdjustment,
  CreateAdjustmentDto,
  AdjustmentQueryDto,
  InventoryMovement,
  CreateMovementDto,
  MovementQueryDto,
  StockLevel,
  InventoryStats,
  InventoryBatch,
  ApiResponse,
  PaginatedResponse,
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

  constructor(private http: HttpClient) {}

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

  getAdjustments(query: AdjustmentQueryDto = {}): Observable<
    ApiResponse<{
      adjustments: InventoryAdjustment[];
      total: number;
      has_more: boolean;
    }>
  > {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<{
          adjustments: InventoryAdjustment[];
          total: number;
          has_more: boolean;
        }>
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

  approveAdjustment(
    id: number,
    approved_by_user_id: number,
  ): Observable<ApiResponse<InventoryAdjustment>> {
    return this.http
      .patch<
        ApiResponse<InventoryAdjustment>
      >(`${this.base_url}/adjustments/${id}/approve`, { approved_by_user_id })
      .pipe(catchError(this.handleError));
  }

  deleteAdjustment(id: number): Observable<ApiResponse<void>> {
    return this.http
      .delete<ApiResponse<void>>(`${this.base_url}/adjustments/${id}`)
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
  ): Observable<ApiResponse<InventoryMovement[]>> {
    const params = this.buildParams(query);
    return this.http
      .get<
        ApiResponse<InventoryMovement[]>
      >(`${this.base_url}/movements`, { params })
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

  private handleError(error: any): Observable<never> {
    console.error('InventoryService Error:', error);
    let error_message = 'An error occurred';

    if (error.error?.message) {
      error_message = error.error.message;
    } else if (error.status === 400) {
      error_message = 'Invalid data provided';
    } else if (error.status === 401) {
      error_message = 'Unauthorized access';
    } else if (error.status === 403) {
      error_message = 'Insufficient permissions';
    } else if (error.status === 404) {
      error_message = 'Resource not found';
    } else if (error.status >= 500) {
      error_message = 'Server error. Please try again later';
    }

    return throwError(() => error_message);
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar inventario
   */
  invalidateCache(): void {
    inventoryStatsCache = null;
  }
}
