import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  PlatformAccountSearchResult,
  PlatformCrmLinkTarget,
  PlatformCrmLinkView,
} from './platform-crm.interface';

interface ApiEnvelope<T> {
  data: T;
}

/** Cliente HTTP de `store/platform-crm/*` (solo tienda de Vendix Platform). */
@Injectable({ providedIn: 'root' })
export class PlatformCrmService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/platform-crm`;

  /** Organizaciones (nombre, slug o NIT) y tiendas (nombre o slug, o los de su org). */
  searchAccounts(q: string): Observable<PlatformAccountSearchResult> {
    const params = new HttpParams().set('q', q);
    return this.http
      .get<ApiEnvelope<PlatformAccountSearchResult>>(`${this.base}/accounts/search`, { params })
      .pipe(map((r) => r.data));
  }

  getLink(customerId: number): Observable<PlatformCrmLinkView> {
    return this.http
      .get<ApiEnvelope<PlatformCrmLinkView>>(`${this.base}/customers/${customerId}/link`)
      .pipe(map((r) => r.data));
  }

  link(
    customerId: number,
    body: PlatformCrmLinkTarget & { note?: string },
  ): Observable<PlatformCrmLinkView> {
    return this.http
      .post<ApiEnvelope<PlatformCrmLinkView>>(`${this.base}/customers/${customerId}/link`, body)
      .pipe(map((r) => r.data));
  }

  unlink(customerId: number, body: { reason?: string } = {}): Observable<PlatformCrmLinkView> {
    return this.http
      .delete<ApiEnvelope<PlatformCrmLinkView>>(`${this.base}/customers/${customerId}/link`, {
        body,
      })
      .pipe(map((r) => r.data));
  }
}
