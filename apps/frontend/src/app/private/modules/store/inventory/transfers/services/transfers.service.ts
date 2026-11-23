import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  StoreScopedCache,
  activeStoreId,
} from '../../../../../../core/utils/store-scoped-cache';
import {
  StockTransfer,
  TransferQuery,
  TransferStats,
  CreateTransferRequest,
  CompleteTransferItem,
  TransferableProduct,
} from '../interfaces';

/**
 * Stats cards cache, one entry per store and emptied on every store switch
 * (QUI-1021): the backend resolves the store from the session, so the URL
 * alone does not say whose stats a response holds.
 */
const transferStatsCache = new StoreScopedCache<TransferStats>(30_000);

@Injectable({
  providedIn: 'root',
})
export class TransfersService {
  private readonly apiUrl = `${environment.apiUrl}/store/stock-transfers`;
  private readonly authFacade = inject(AuthFacade);

  constructor(private http: HttpClient) {}

  getAll(query: TransferQuery = {}): Observable<StockTransfer[]> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });
    const url = `${this.apiUrl}?${params.toString()}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  getStats(): Observable<TransferStats> {
    const storeId = activeStoreId(this.authFacade);
    const cached = transferStatsCache.get(storeId);
    if (cached) {
      return cached;
    }
    const observable$ = this.http.get<any>(`${this.apiUrl}/stats`).pipe(
      map((r) => r.data || r),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => transferStatsCache.touch(storeId)),
      catchError((error) => {
        transferStatsCache.delete(storeId);
        return throwError(() => new Error('Failed to fetch transfer stats'));
      }),
    );
    transferStatsCache.set(storeId, observable$);
    return observable$;
  }

  getById(id: number): Observable<StockTransfer> {
    return this.http.get<any>(`${this.apiUrl}/${id}`).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  create(dto: CreateTransferRequest): Observable<StockTransfer> {
    return this.http.post<any>(this.apiUrl, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  createAndComplete(dto: CreateTransferRequest): Observable<StockTransfer> {
    return this.http.post<any>(`${this.apiUrl}/complete`, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  update(id: number, dto: Partial<CreateTransferRequest>): Observable<StockTransfer> {
    return this.http.patch<any>(`${this.apiUrl}/${id}`, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  approve(id: number): Observable<StockTransfer> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/approve`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  complete(id: number, items: CompleteTransferItem[]): Observable<StockTransfer> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/complete`, { items }).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  /** Despacho con conteo de salida por línea (D3). */
  dispatch(
    id: number,
    body: {
      items?: Array<{ id: number; quantity_dispatched: number; batch_id?: number }>;
      notes?: string;
    } = {},
  ): Observable<StockTransfer> {
    return this.http.post<any>(`${this.apiUrl}/${id}/dispatch`, body).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  /** D4 — cierre del pendiente como pérdida (solo tras la fecha límite). */
  closeWithLoss(id: number, body: { reason: string; notes?: string }): Observable<StockTransfer> {
    return this.http.post<any>(`${this.apiUrl}/${id}/close-with-loss`, body).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  cancel(id: number): Observable<StockTransfer> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/cancel`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  searchTransferableProducts(
    search: string,
    fromLocationId: number,
    toLocationId: number,
    limit = 10,
  ): Observable<TransferableProduct[]> {
    const params = new URLSearchParams({
      search,
      from_location_id: fromLocationId.toString(),
      to_location_id: toLocationId.toString(),
      limit: limit.toString(),
    });
    return this.http.get<any>(`${this.apiUrl}/search-products?${params.toString()}`).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  invalidateCache(): void {
    transferStatsCache.clear();
  }

  private extractErrorMessage(error: any): string {
    const msg = error?.error?.message || error?.message || 'Error desconocido';
    return Array.isArray(msg) ? msg.join('. ') : msg;
  }
}
