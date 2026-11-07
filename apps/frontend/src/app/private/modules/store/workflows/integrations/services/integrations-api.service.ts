import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  ApiResponse,
  PaginatedApiResponse,
} from '../../interfaces/workflow.interfaces';
import {
  ApiKeyCreated,
  ApiKeyRow,
  CreateApiKeyBody,
  CreateWebhookBody,
  UpdateWebhookBody,
  WebhookDeliveriesQuery,
  WebhookDeliveryRow,
  WebhookRow,
  WebhookWithSecret,
} from '../interfaces/integrations.interfaces';

/**
 * Typed client of `store/integrations/api-keys` and `store/integrations/webhooks`.
 * Both are JWT-only and need `store:integrations:api_keys`.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationsApiService {
  private readonly http = inject(HttpClient);
  private readonly keysBase = `${environment.apiUrl}/store/integrations/api-keys`;
  private readonly hooksBase = `${environment.apiUrl}/store/integrations/webhooks`;

  // ─── API keys ────────────────────────────────────────────────────────

  listApiKeys(): Observable<ApiKeyRow[]> {
    return this.http
      .get<ApiResponse<ApiKeyRow[]>>(this.keysBase)
      .pipe(map((res) => res.data ?? []));
  }

  createApiKey(body: CreateApiKeyBody): Observable<ApiKeyCreated> {
    return this.http
      .post<ApiResponse<ApiKeyCreated>>(this.keysBase, body)
      .pipe(map((res) => res.data));
  }

  revokeApiKey(id: number): Observable<ApiKeyRow> {
    return this.http
      .delete<ApiResponse<ApiKeyRow>>(`${this.keysBase}/${id}`)
      .pipe(map((res) => res.data));
  }

  // ─── Webhooks ────────────────────────────────────────────────────────

  listWebhooks(): Observable<WebhookRow[]> {
    return this.http
      .get<ApiResponse<WebhookRow[]>>(this.hooksBase)
      .pipe(map((res) => res.data ?? []));
  }

  createWebhook(body: CreateWebhookBody): Observable<WebhookWithSecret> {
    return this.http
      .post<ApiResponse<WebhookWithSecret>>(this.hooksBase, body)
      .pipe(map((res) => res.data));
  }

  updateWebhook(id: number, body: UpdateWebhookBody): Observable<WebhookRow> {
    return this.http
      .patch<ApiResponse<WebhookRow>>(`${this.hooksBase}/${id}`, body)
      .pipe(map((res) => res.data));
  }

  deactivateWebhook(id: number): Observable<WebhookRow> {
    return this.http
      .delete<ApiResponse<WebhookRow>>(`${this.hooksBase}/${id}`)
      .pipe(map((res) => res.data));
  }

  rotateWebhookSecret(id: number): Observable<WebhookWithSecret> {
    return this.http
      .post<ApiResponse<WebhookWithSecret>>(`${this.hooksBase}/${id}/rotate-secret`, {})
      .pipe(map((res) => res.data));
  }

  testWebhook(id: number): Observable<{ delivery_id: number; event_id: string }> {
    return this.http
      .post<ApiResponse<{ delivery_id: number; event_id: string }>>(
        `${this.hooksBase}/${id}/test`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  listDeliveries(
    id: number,
    query: WebhookDeliveriesQuery = {},
  ): Observable<PaginatedApiResponse<WebhookDeliveryRow>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params = params.set(key, String(value));
    }
    return this.http.get<PaginatedApiResponse<WebhookDeliveryRow>>(
      `${this.hooksBase}/${id}/deliveries`,
      { params },
    );
  }

  retryDelivery(deliveryId: number): Observable<{ delivery_id: number; status: string }> {
    return this.http
      .post<ApiResponse<{ delivery_id: number; status: string }>>(
        `${this.hooksBase}/deliveries/${deliveryId}/retry`,
        {},
      )
      .pipe(map((res) => res.data));
  }
}
