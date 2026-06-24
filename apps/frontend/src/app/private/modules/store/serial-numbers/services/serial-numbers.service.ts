import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

/**
 * Inventory serial-number status enum (mirrors backend serial_number_status_enum).
 */
export type SerialNumberStatus =
  | 'in_stock'
  | 'reserved'
  | 'sold'
  | 'returned'
  | 'damaged'
  | 'expired'
  | 'in_transit';

/**
 * Read-only serial row as returned by
 * GET `/store/inventory/serial-numbers` (ResponseService.paginated envelope).
 *
 * The pool is populated by purchase-receipt / POS flows; this module only
 * lists and searches it. There is NO order/customer field on the list
 * endpoint, so no order/customer filter can be offered here.
 */
export interface SerialNumber {
  id: number;
  serial_number: string;
  status: SerialNumberStatus;
  product_id: number;
  product_variant_id: number | null;
  location_id: number | null;
  batch_id: number | null;
  cost: string | number | null;
  sold_date: string | null;
  warranty_expiry: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  products?: { id: number; name: string; sku: string };
  product_variants?: { id: number; name: string; sku: string };
  inventory_batches?: {
    id: number;
    batch_number: string;
    expiration_date: string | null;
  };
  inventory_locations?: { id: number; name: string };
}

/**
 * Query parameters accepted by the list endpoint. All optional.
 * Note: the endpoint also supports product_variant_id, batch_id and
 * location_id, but this list module only surfaces search/status/product_id.
 */
export interface SerialNumberQuery {
  product_id?: number;
  product_variant_id?: number;
  batch_id?: number;
  location_id?: number;
  status?: SerialNumberStatus;
  search?: string;
  page?: number;
  limit?: number;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages?: number;
    };
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Query for the "available serials" endpoint. `product_id` and `location_id`
 * are required by the backend; `product_variant_id` is optional.
 */
export interface AvailableSerialNumberQuery {
  product_id: number;
  location_id: number;
  product_variant_id?: number;
}

/**
 * QUI-431 — A single serial to backfill via the bulk-create endpoint.
 * `serial_number` is required; the rest are optional metadata captured from
 * the textarea/CSV bulk-load modal.
 */
export interface BulkBackfillItem {
  serial_number: string;
  cost?: number;
  warranty_expiry?: string;
  notes?: string;
}

/**
 * Body for `POST {basePath}/bulk`. Creates many serials at once for a
 * product/variant at a location. The backend validates parity against the
 * existing stock and reports per-row failures instead of aborting the batch.
 */
export interface BulkBackfillPayload {
  product_id: number;
  product_variant_id?: number;
  location_id: number;
  items: BulkBackfillItem[];
}

/**
 * Result envelope payload for `POST {basePath}/bulk`. `created_serials` holds
 * the rows that were persisted; `failed` lists each rejected serial with the
 * reason so the UI can show a per-row failure report.
 */
export interface BulkBackfillResult {
  created: number;
  created_serials: SerialNumber[];
  failed: { serial_number: string; reason: string }[];
}

/**
 * Store-scoped read service for inventory serial numbers.
 *
 * Backend permission enforcement:
 *   - GET list → store:inventory:serial_numbers:read
 */
@Injectable({ providedIn: 'root' })
export class SerialNumbersService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/inventory/serial-numbers';
  private http = inject(HttpClient);

  /**
   * List serial numbers returning the full paginated envelope (including meta).
   */
  listPaginated(
    query: SerialNumberQuery = {},
  ): Observable<PaginatedApiResponse<SerialNumber>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    if (query.product_id != null) {
      params = params.set('product_id', String(query.product_id));
    }
    if (query.product_variant_id != null) {
      params = params.set(
        'product_variant_id',
        String(query.product_variant_id),
      );
    }
    if (query.batch_id != null) {
      params = params.set('batch_id', String(query.batch_id));
    }
    if (query.location_id != null) {
      params = params.set('location_id', String(query.location_id));
    }

    return this.http
      .get<
        PaginatedApiResponse<SerialNumber>
      >(`${this.apiUrl}${this.basePath}`, { params })
      .pipe(catchError(this.handleError));
  }

  /**
   * QUI-431 — In_stock serials available to sell for a product/variant at a
   * location (FIFO order). Consumed by the POS serial-selection modal. Returns
   * the unwrapped `data` array (the endpoint uses ResponseService.success).
   */
  listAvailable(query: AvailableSerialNumberQuery): Observable<SerialNumber[]> {
    let params = new HttpParams()
      .set('product_id', String(query.product_id))
      .set('location_id', String(query.location_id));
    if (query.product_variant_id != null) {
      params = params.set(
        'product_variant_id',
        String(query.product_variant_id),
      );
    }

    return this.http
      .get<
        ApiResponse<SerialNumber[]>
      >(`${this.apiUrl}${this.basePath}/available`, { params })
      .pipe(
        map((res) => res?.data ?? []),
        catchError(this.handleError),
      );
  }

  /**
   * QUI-431 — Backfill (or collect) many serials for a product/variant at a
   * location. Returns the unwrapped result payload (created count, created
   * rows, and per-serial failures). The backend never throws on partial
   * failure; failures come back inside `failed`.
   */
  bulkCreate(payload: BulkBackfillPayload): Observable<BulkBackfillResult> {
    return this.http
      .post<
        ApiResponse<BulkBackfillResult>
      >(`${this.apiUrl}${this.basePath}/bulk`, payload)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * Update editable fields of a single serial (serial_number / notes / cost).
   */
  update(
    id: number,
    dto: { serial_number?: string; notes?: string; cost?: number },
  ): Observable<SerialNumber> {
    return this.http
      .patch<
        ApiResponse<SerialNumber>
      >(`${this.apiUrl}${this.basePath}/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * Transition a serial to a new status (in_stock, damaged, returned, ...).
   */
  updateStatus(
    id: number,
    status: SerialNumberStatus,
  ): Observable<SerialNumber> {
    return this.http
      .patch<
        ApiResponse<SerialNumber>
      >(`${this.apiUrl}${this.basePath}/${id}/status`, { status })
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  /**
   * Delete a single serial. Resolves to void on success.
   */
  remove(id: number): Observable<void> {
    return this.http
      .delete<
        ApiResponse<{ success: true }>
      >(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(
        map(() => void 0),
        catchError(this.handleError),
      );
  }

  private handleError(error: any): Observable<never> {
    // eslint-disable-next-line no-console
    console.error('SerialNumbersService Error:', error);
    let message = 'Error al procesar la solicitud';
    const apiMessage = error?.error?.message;
    if (apiMessage) {
      message =
        typeof apiMessage === 'string'
          ? apiMessage
          : Array.isArray(apiMessage)
            ? apiMessage.join(', ')
            : message;
    } else if (error?.status === 401) {
      message = 'No autorizado';
    } else if (error?.status === 403) {
      message = 'No tienes permisos suficientes';
    } else if (error?.status === 404) {
      message = 'Número de serie no encontrado';
    } else if (typeof error?.status === 'number' && error.status >= 500) {
      message = 'Error del servidor. Inténtalo más tarde';
    }
    return throwError(() => message);
  }
}
