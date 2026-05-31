import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import {
  ApiEnvelope,
  MaskedDianConfiguration,
  PaginatedEnvelope,
  SubscriptionFiscalLastTestResult,
  SubscriptionFiscalQuery,
  SubscriptionFiscalStatus,
  SubscriptionFiscalTransmission,
  UpsertSubscriptionFiscalConfigDto,
} from '../interfaces/fiscal-billing.interface';

@Injectable({ providedIn: 'root' })
export class FiscalBillingAdminService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;

  getStatus(): Observable<SubscriptionFiscalStatus> {
    return this.http
      .get<ApiEnvelope<SubscriptionFiscalStatus>>(`${this.base}/status`)
      .pipe(map((res) => res.data));
  }

  saveConfig(
    dto: UpsertSubscriptionFiscalConfigDto,
  ): Observable<SubscriptionFiscalStatus> {
    return this.http
      .patch<ApiEnvelope<SubscriptionFiscalStatus>>(`${this.base}/config`, dto)
      .pipe(map((res) => res.data));
  }

  uploadCertificate(
    file: File,
    password: string,
  ): Observable<MaskedDianConfiguration> {
    const formData = new FormData();
    formData.append('certificate', file);
    formData.append('password', password);
    return this.http
      .post<ApiEnvelope<MaskedDianConfiguration>>(
        `${this.base}/certificate`,
        formData,
      )
      .pipe(map((res) => res.data));
  }

  testConnection(): Observable<SubscriptionFiscalLastTestResult> {
    return this.http
      .post<ApiEnvelope<SubscriptionFiscalLastTestResult>>(
        `${this.base}/test`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  listTransmissions(
    query: SubscriptionFiscalQuery,
  ): Observable<PaginatedEnvelope<SubscriptionFiscalTransmission>> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', String(query.page));
    if (query.limit) params = params.set('limit', String(query.limit));
    if (query.status) params = params.set('status', query.status);
    if (query.environment) {
      params = params.set('environment', query.environment);
    }
    if (query.search?.trim()) params = params.set('search', query.search.trim());

    return this.http.get<PaginatedEnvelope<SubscriptionFiscalTransmission>>(
      `${this.base}/transmissions`,
      { params },
    );
  }

  issueInvoice(
    invoiceId: number,
  ): Observable<SubscriptionFiscalTransmission | { skipped: true; reason: string }> {
    return this.http
      .post<
        ApiEnvelope<SubscriptionFiscalTransmission | { skipped: true; reason: string }>
      >(`${this.base}/invoices/${invoiceId}/issue`, {})
      .pipe(map((res) => res.data));
  }

  retryTransmission(
    transmissionId: number,
  ): Observable<SubscriptionFiscalTransmission> {
    return this.http
      .post<ApiEnvelope<SubscriptionFiscalTransmission>>(
        `${this.base}/transmissions/${transmissionId}/retry`,
        {},
      )
      .pipe(map((res) => res.data));
  }
}
