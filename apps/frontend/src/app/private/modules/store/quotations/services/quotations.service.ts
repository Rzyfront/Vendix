import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Quotation,
  QuotationQuery,
  PaginatedQuotationsResponse,
  QuotationStats,
  CreateQuotationDto,
} from '../interfaces/quotation.interface';

let quotationStatsCache: { observable: Observable<any>; lastFetch: number } | null = null;

@Injectable({
  providedIn: 'root',
})
export class QuotationsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000;

  constructor(private http: HttpClient) {}

  getQuotations(query: QuotationQuery = {}): Observable<PaginatedQuotationsResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });
    const url = `${this.apiUrl}/store/quotations?${params.toString()}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching quotations:', error);
        return throwError(() => new Error(this.extractErrorMessage(error)));
      }),
    );
  }

  getQuotationStats(): Observable<QuotationStats> {
    const now = Date.now();
    if (quotationStatsCache && now - quotationStatsCache.lastFetch < this.CACHE_TTL) {
      return quotationStatsCache.observable;
    }
    const url = `${this.apiUrl}/store/quotations/stats`;
    const observable$ = this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (quotationStatsCache) quotationStatsCache.lastFetch = Date.now();
      }),
      catchError((error) => {
        console.error('Error fetching quotation stats:', error);
        return throwError(() => new Error('Failed to fetch quotation stats'));
      }),
    );
    quotationStatsCache = { observable: observable$, lastFetch: now };
    return observable$;
  }

  getQuotationById(id: number): Observable<Quotation> {
    const url = `${this.apiUrl}/store/quotations/${id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  createQuotation(dto: CreateQuotationDto): Observable<Quotation> {
    const url = `${this.apiUrl}/store/quotations`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  updateQuotation(id: number, dto: Partial<CreateQuotationDto>): Observable<Quotation> {
    const url = `${this.apiUrl}/store/quotations/${id}`;
    return this.http.patch<any>(url, dto).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  deleteQuotation(id: number): Observable<void> {
    const url = `${this.apiUrl}/store/quotations/${id}`;
    return this.http.delete<void>(url).pipe(
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  sendQuotation(id: number): Observable<Quotation> {
    return this.http.post<any>(`${this.apiUrl}/store/quotations/${id}/send`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  acceptQuotation(id: number): Observable<Quotation> {
    return this.http.post<any>(`${this.apiUrl}/store/quotations/${id}/accept`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  rejectQuotation(id: number): Observable<Quotation> {
    return this.http.post<any>(`${this.apiUrl}/store/quotations/${id}/reject`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  cancelQuotation(id: number): Observable<Quotation> {
    return this.http.post<any>(`${this.apiUrl}/store/quotations/${id}/cancel`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  convertToOrder(id: number): Observable<Quotation> {
    return this.http.post<any>(`${this.apiUrl}/store/quotations/${id}/convert`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  duplicateQuotation(id: number): Observable<Quotation> {
    return this.http.post<any>(`${this.apiUrl}/store/quotations/${id}/duplicate`, {}).pipe(
      map((r) => r.data || r),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(this.extractErrorMessage(error)))),
    );
  }

  invalidateCache(): void {
    quotationStatsCache = null;
  }

  private extractErrorMessage(error: any): string {
    return error?.error?.message || error?.message || 'Error desconocido';
  }
}
