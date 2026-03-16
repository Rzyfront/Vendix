import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  StockTransfer,
  TransferQuery,
  TransferStats,
  CreateTransferRequest,
  CompleteTransferItem,
  TransferableProduct,
} from '../interfaces';

let transferStatsCache: { observable: Observable<TransferStats>; lastFetch: number } | null = null;

@Injectable({
  providedIn: 'root',
})
export class TransfersService {
  private readonly apiUrl = `${environment.apiUrl}/store/stock-transfers`;
  private readonly CACHE_TTL = 30000;

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
    const now = Date.now();
    if (transferStatsCache && now - transferStatsCache.lastFetch < this.CACHE_TTL) {
      return transferStatsCache.observable;
    }
    const observable$ = this.http.get<any>(`${this.apiUrl}/stats`).pipe(
      map((r) => r.data || r),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (transferStatsCache) transferStatsCache.lastFetch = Date.now();
      }),
      catchError((error) => {
        transferStatsCache = null;
        return throwError(() => new Error('Failed to fetch transfer stats'));
      }),
    );
    transferStatsCache = { observable: observable$, lastFetch: now };
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
    transferStatsCache = null;
  }

  private extractErrorMessage(error: any): string {
    return error?.error?.message || error?.message || 'Error desconocido';
  }
}
