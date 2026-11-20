import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  PlatformAccountSearchResult,
  PlatformCrmLinkList,
  PlatformCrmLinkTarget,
  PlatformCrmLinkView,
  PlatformStoreActivityView,
  SubscriptionMovementsQuery,
  SubscriptionMovementsView,
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

  /** Todas las cuentas Vendix enlazadas del cliente. */
  getLinks(customerId: number): Observable<PlatformCrmLinkList> {
    return this.http
      .get<ApiEnvelope<PlatformCrmLinkList>>(`${this.base}/customers/${customerId}/links`)
      .pipe(map((r) => r.data));
  }

  /** Desenlaza UNA cuenta; responde con las que le quedan al cliente. */
  unlinkById(
    customerId: number,
    linkId: number,
    body: { reason?: string } = {},
  ): Observable<PlatformCrmLinkList> {
    return this.http
      .delete<ApiEnvelope<PlatformCrmLinkList>>(
        `${this.base}/customers/${customerId}/links/${linkId}`,
        { body },
      )
      .pipe(map((r) => r.data));
  }

  /** Facturas, pagos y cambios de la suscripción de las cuentas enlazadas, con métricas. */
  getSubscriptionMovements(
    customerId: number,
    query: SubscriptionMovementsQuery = {},
  ): Observable<SubscriptionMovementsView> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http
      .get<ApiEnvelope<SubscriptionMovementsView>>(
        `${this.base}/customers/${customerId}/subscription-movements`,
        { params },
      )
      .pipe(map((r) => r.data));
  }

  /** Gráfica de actividad de un comercio enlazado (`from`/`to` en `YYYY-MM-DD`). */
  getStoreActivity(
    customerId: number,
    storeId: number,
    range: { from?: string; to?: string } = {},
  ): Observable<PlatformStoreActivityView> {
    let params = new HttpParams();
    if (range.from) params = params.set('from', range.from);
    if (range.to) params = params.set('to', range.to);
    return this.http
      .get<ApiEnvelope<PlatformStoreActivityView>>(
        `${this.base}/customers/${customerId}/stores/${storeId}/activity`,
        { params },
      )
      .pipe(map((r) => r.data));
  }

  /** @deprecated Un solo enlace (el más antiguo). Usar {@link getLinks}. */
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

  /** @deprecated Falla si el cliente tiene varias cuentas. Usar {@link unlinkById}. */
  unlink(customerId: number, body: { reason?: string } = {}): Observable<PlatformCrmLinkView> {
    return this.http
      .delete<ApiEnvelope<PlatformCrmLinkView>>(`${this.base}/customers/${customerId}/link`, {
        body,
      })
      .pipe(map((r) => r.data));
  }
}
