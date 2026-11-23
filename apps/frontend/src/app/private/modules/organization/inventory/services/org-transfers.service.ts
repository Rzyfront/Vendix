import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import type {
  TransferPickerRow,
  TransferPayload,
} from '../../../store/inventory/transfers/quick-move/transfer-draft';
import {
  CancelOrgTransferRequest,
  CloseOrgTransferWithLossRequest,
  CompleteOrgTransferRequest,
  CreateOrgTransferRequest,
  DispatchOrgTransferRequest,
  OrgTransfer,
  OrgTransferQuery,
  OrgTransferStats,
} from '../interfaces/org-transfer.interface';

interface PaginatedTransfers {
  data: OrgTransfer[];
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    total_pages?: number;
  };
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    total_pages?: number;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Org-level transfers client. Hits `/api/organization/inventory/transfers`.
 * Lifecycle: pending → approved → in_transit → received (with cancel as
 * any-non-terminal exit).
 */
@Injectable({ providedIn: 'root' })
export class OrgTransfersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/organization/inventory/transfers`;

  list(query: OrgTransferQuery = {}): Observable<PaginatedTransfers> {
    const params = this.toParams(query);
    return this.http
      .get<any>(this.baseUrl, { params })
      .pipe(
        map((r) => this.normalizeListResponse(r)),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  findOne(id: number): Observable<OrgTransfer> {
    return this.http
      .get<ApiResponse<OrgTransfer>>(`${this.baseUrl}/${id}`)
      .pipe(
        map((r) => r.data),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  getStats(): Observable<OrgTransferStats> {
    return this.http
      .get<ApiResponse<OrgTransferStats>>(`${this.baseUrl}/stats`)
      .pipe(
        map((r) => r.data),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  create(dto: CreateOrgTransferRequest): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(this.baseUrl, dto)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  /**
   * Movimiento rápido (D1): crea y aplica en una transacción —origen −,
   * destino +— y solo deja el registro. Sin transporte ni remisión.
   */
  createAndComplete(dto: TransferPayload): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(`${this.baseUrl}/complete`, dto)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  /**
   * Picker del movimiento rápido de organización: una fila por variante con su
   * disponible en origen y destino (mismo shape que la tienda).
   */
  searchTransferableProducts(
    search: string,
    fromLocationId: number,
    toLocationId: number,
    limit = 30,
  ): Observable<TransferPickerRow[]> {
    const params = new HttpParams()
      .set('search', search)
      .set('from_location_id', String(fromLocationId))
      .set('to_location_id', String(toLocationId))
      .set('limit', String(limit));
    return this.http
      .get<any>(`${this.baseUrl}/search-products`, { params })
      .pipe(
        map((r) => (Array.isArray(r) ? r : (r?.data ?? []))),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  approve(id: number): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(`${this.baseUrl}/${id}/approve`, {})
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  dispatch(
    id: number,
    body: DispatchOrgTransferRequest = {},
  ): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(`${this.baseUrl}/${id}/dispatch`, body)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  complete(
    id: number,
    body: CompleteOrgTransferRequest,
  ): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(`${this.baseUrl}/${id}/complete`, body)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  /** D4 — cierre del pendiente como pérdida (solo tras la fecha límite). */
  closeWithLoss(
    id: number,
    body: CloseOrgTransferWithLossRequest,
  ): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(`${this.baseUrl}/${id}/close-with-loss`, body)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  cancel(
    id: number,
    body: CancelOrgTransferRequest = {},
  ): Observable<OrgTransfer> {
    return this.http
      .post<ApiResponse<OrgTransfer>>(`${this.baseUrl}/${id}/cancel`, body)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  /**
   * No internal cache today — kept for symmetry with the store-side service.
   * Reserved for future shareReplay caches on stats / counters.
   */
  invalidateCache(): void {
    /* no-op (no shareReplay caches yet) */
  }

  private normalizeListResponse(r: any): PaginatedTransfers {
    if (!r) return { data: [], meta: { total: 0 } };
    if (Array.isArray(r)) return { data: r, meta: { total: r.length } };
    const data = Array.isArray(r.data) ? r.data : [];
    return {
      data,
      meta: r.meta ?? r.pagination ?? { total: data.length },
      pagination: r.pagination,
    };
  }

  private toParams(query: Record<string, unknown> | object | undefined): HttpParams {
    let params = new HttpParams();
    if (!query) return params;
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      params = params.set(k, String(v));
    }
    return params;
  }

  private normalizeError(error: any): Error {
    const msg =
      error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      'Error desconocido';
    if (Array.isArray(msg)) return new Error(msg.join('. '));
    return new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}
