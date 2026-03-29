import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  DispatchNote,
  DispatchNoteQuery,
  PaginatedDispatchNotesResponse,
  DispatchNoteStats,
  CreateDispatchNoteDto,
} from '../interfaces/dispatch-note.interface';

let dispatchNoteStatsCache: { observable: Observable<any>; lastFetch: number } | null = null;

@Injectable({
  providedIn: 'root',
})
export class DispatchNotesService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000;

  constructor(private http: HttpClient) {}

  getDispatchNotes(query: DispatchNoteQuery = {}): Observable<PaginatedDispatchNotesResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });
    const url = `${this.apiUrl}/store/dispatch-notes?${params.toString()}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching dispatch notes:', error);
        return throwError(() => new Error(this.extractErrorMessage(error)));
      }),
    );
  }

  getStats(): Observable<DispatchNoteStats> {
    const now = Date.now();
    if (dispatchNoteStatsCache && now - dispatchNoteStatsCache.lastFetch < this.CACHE_TTL) {
      return dispatchNoteStatsCache.observable;
    }
    const url = `${this.apiUrl}/store/dispatch-notes/stats`;
    const observable$ = this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (dispatchNoteStatsCache) dispatchNoteStatsCache.lastFetch = Date.now();
      }),
      catchError((error) => {
        console.error('Error fetching dispatch note stats:', error);
        return throwError(() => new Error('Failed to fetch dispatch note stats'));
      }),
    );
    dispatchNoteStatsCache = { observable: observable$, lastFetch: now };
    return observable$;
  }

  getDispatchNote(id: number): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/${id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  create(dto: CreateDispatchNoteDto): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  createFromSalesOrder(sales_order_id: number, dto: any): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/from-sales-order/${sales_order_id}`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  update(id: number, dto: Partial<CreateDispatchNoteDto>): Observable<DispatchNote> {
    const url = `${this.apiUrl}/store/dispatch-notes/${id}`;
    return this.http.patch<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  remove(id: number): Observable<void> {
    const url = `${this.apiUrl}/store/dispatch-notes/${id}`;
    return this.http.delete<void>(url).pipe(
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  confirm(id: number): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/confirm`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  deliver(id: number, dto?: any): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/deliver`, dto || {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  void(id: number, dto: { void_reason: string }): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/void`, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  invoice(id: number): Observable<DispatchNote> {
    return this.http.post<any>(`${this.apiUrl}/store/dispatch-notes/${id}/invoice`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  getBySalesOrder(sales_order_id: number): Observable<DispatchNote[]> {
    const url = `${this.apiUrl}/store/dispatch-notes/by-sales-order/${sales_order_id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  invalidateCache(): void {
    dispatchNoteStatsCache = null;
  }

  private extractErrorMessage(error: any): string {
    return error?.error?.message || error?.message || 'Error desconocido';
  }
}
