import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  PaymentRequest,
  PaymentRequestDetail,
  PaymentRequestPage,
  PaymentRequestStatus,
} from '../interfaces/payment-request.interface';

type Envelope<T> = { data?: T } | T;

/**
 * Admin API of the payment page (`store/payment-requests`). The list endpoint wraps its rows as
 * `{ data: { data: rows, pagination } }`; both that and a flat `{ data: rows, meta }` are accepted.
 */
@Injectable({ providedIn: 'root' })
export class PaymentRequestsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/payment-requests`;

  private unwrap<T>(response: Envelope<T>): T {
    return (response && typeof response === 'object' && 'data' in response ? response.data : response) as T;
  }

  list(status: PaymentRequestStatus, page: number, limit: number): Observable<PaymentRequestPage> {
    const params = new HttpParams().set('status', status).set('page', String(page)).set('limit', String(limit));
    return this.http.get<unknown>(this.base, { params }).pipe(map((response) => this.toPage(response, limit)));
  }

  get(id: number): Observable<PaymentRequestDetail> {
    return this.http.get<Envelope<PaymentRequestDetail>>(`${this.base}/${id}`).pipe(map((r) => this.unwrap(r)));
  }

  confirm(id: number): Observable<unknown> {
    return this.http.post<unknown>(`${this.base}/${id}/confirm`, {});
  }

  reject(id: number, reason: string): Observable<unknown> {
    return this.http.post<unknown>(`${this.base}/${id}/reject`, { reason });
  }

  cancel(id: number): Observable<unknown> {
    return this.http.post<unknown>(`${this.base}/${id}/cancel`, {});
  }

  private toPage(response: unknown, limit: number): PaymentRequestPage {
    const body = (response ?? {}) as {
      data?: PaymentRequest[] | { data?: PaymentRequest[]; pagination?: { total?: number; totalPages?: number } };
      meta?: { total?: number; totalPages?: number };
    };
    const inner = body.data;
    const rows = Array.isArray(inner) ? inner : (inner?.data ?? []);
    const info = Array.isArray(inner) ? body.meta : (inner?.pagination ?? body.meta);
    const total = info?.total ?? rows.length;
    return { data: rows, total, totalPages: info?.totalPages ?? Math.max(1, Math.ceil(total / limit)) };
  }
}
