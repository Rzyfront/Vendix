import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import { AsyncJobStatus } from '../../../../../core/utils/async-job-poll.util';
// El reporte de readiness es EL MISMO que el del riel de tiendas: el backend
// delega en su implementación bajo contexto de plataforma. Reusar el tipo evita
// que una copia se desvíe de la otra.
import { DianProductionReadiness } from '../../../store/invoicing/interfaces/invoice.interface';
import {
  ApiEnvelope,
  CreatePlatformResolutionDto,
  ListPlatformResolutionsQuery,
  MaskedDianConfiguration,
  PaginatedEnvelope,
  PatchVendorSupportFiscalConfigDto,
  PlatformResolution,
  SubscriptionFiscalLastTestResult,
  SubscriptionFiscalQuery,
  SubscriptionFiscalStatus,
  SubscriptionFiscalTransmission,
  UpdatePlatformResolutionDto,
  UpsertSubscriptionFiscalConfigDto,
  VendorSupportFiscalConfig,
  VendorSupportFiscalQuery,
  VendorSupportFiscalTransmission,
} from '../interfaces/fiscal-billing.interface';

@Injectable({ providedIn: 'root' })
export class FiscalBillingAdminService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;
  private inboundBase = `${environment.apiUrl}/super-admin/fiscal/invoicing/inbound`;

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

  /**
   * Qué falta para que la PLATAFORMA emita en producción.
   *
   * Tipado con `DianProductionReadiness` —el del riel de tiendas— a propósito: el
   * backend delega en la MISMA implementación bajo contexto de plataforma, así que
   * un segundo tipo solo podría desviarse del real. Este endpoint no existía, y su
   * ausencia era la razón por la que el paso a producción de la plataforma no
   * comprobaba que la DIAN hubiera aprobado su set de habilitación.
   *
   * Solo lectura: se puede consultar en cualquier estado y no muta nada.
   */
  getProductionReadiness(): Observable<DianProductionReadiness> {
    return this.http
      .get<ApiEnvelope<DianProductionReadiness>>(
        `${this.base}/production-readiness`,
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Pasa la plataforma a producción. ÚNICA vía: `saveConfig` rechaza con 400
   * cualquier `environment: 'production'`.
   *
   * Responde 412 con la lista de faltantes si el readiness no está listo, así que
   * la UI no tiene que adivinar por qué se negó — puede pintar la misma lista que
   * muestra el reporte.
   */
  promoteToProduction(): Observable<{
    promoted: MaskedDianConfiguration;
    status: SubscriptionFiscalStatus;
  }> {
    return this.http
      .post<
        ApiEnvelope<{
          promoted: MaskedDianConfiguration;
          status: SubscriptionFiscalStatus;
        }>
      >(`${this.base}/promote-to-production`, {})
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

  // ─────────────────────────────────────────────────────────
  // DIAN test set (habilitación) for the platform's own NIT
  //
  // Vendix has to pass the same 50-document test set as any other obligado
  // before DIAN enables it for production. These four calls mirror the
  // store-level flow (send / re-poll / diagnose per document / discard).
  // ─────────────────────────────────────────────────────────

  /**
   * Encola el envío. Responde 202 con `job_id`, no con el resultado: construir,
   * firmar y subir 50 documentos toma ~74 s y nginx corta el request a los 60 s.
   * El resultado se obtiene con `getTestSetJobStatus`.
   */
  runTestSet(): Observable<{ job_id: string }> {
    return this.http
      .post<ApiEnvelope<{ job_id: string }>>(`${this.base}/test-set`, {})
      .pipe(map((res) => res.data));
  }

  getTestSetJobStatus(jobId: string): Observable<AsyncJobStatus> {
    return this.http
      .get<ApiEnvelope<AsyncJobStatus>>(`${this.base}/test-set/job/${jobId}`)
      .pipe(map((res) => res.data));
  }

  checkTestSetStatus(): Observable<unknown> {
    return this.http
      .get<ApiEnvelope<unknown>>(`${this.base}/test-set/status`)
      .pipe(map((res) => res.data));
  }

  getTestSetDocuments(sampleSize?: number): Observable<unknown> {
    let params = new HttpParams();
    if (sampleSize) params = params.set('sample_size', String(sampleSize));
    return this.http
      .get<ApiEnvelope<unknown>>(`${this.base}/test-set/documents`, { params })
      .pipe(map((res) => res.data));
  }

  abandonTestSet(): Observable<unknown> {
    return this.http
      .post<ApiEnvelope<unknown>>(`${this.base}/test-set/abandon`, {})
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

  // ─────────────────────────────────────────────────────────
  // Platform DIAN resolutions
  // ─────────────────────────────────────────────────────────

  listResolutions(
    query: ListPlatformResolutionsQuery = {},
  ): Observable<PlatformResolution[]> {
    let params = new HttpParams();
    if (query.document_type) {
      params = params.set('document_type', query.document_type);
    }
    if (query.environment) {
      params = params.set('environment', query.environment);
    }
    if (query.is_active !== undefined) {
      params = params.set('is_active', String(query.is_active));
    }
    return this.http
      .get<ApiEnvelope<PlatformResolution[]>>(`${this.base}/resolutions`, {
        params,
      })
      .pipe(map((res) => res.data ?? []));
  }

  createResolution(
    dto: CreatePlatformResolutionDto,
  ): Observable<PlatformResolution> {
    return this.http
      .post<ApiEnvelope<PlatformResolution>>(
        `${this.base}/resolutions`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  updateResolution(
    id: number,
    dto: UpdatePlatformResolutionDto,
  ): Observable<PlatformResolution> {
    return this.http
      .patch<ApiEnvelope<PlatformResolution>>(
        `${this.base}/resolutions/${id}`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  deleteResolution(id: number): Observable<{ id: number; deleted: boolean }> {
    return this.http
      .delete<ApiEnvelope<{ id: number; deleted: boolean }>>(
        `${this.base}/resolutions/${id}`,
      )
      .pipe(map((res) => res.data));
  }

  // ─────────────────────────────────────────────────────────
  // Vendor Support Document fiscal (documento soporte)
  // ─────────────────────────────────────────────────────────

  getVendorSupportFiscalConfig(): Observable<VendorSupportFiscalConfig> {
    return this.http
      .get<ApiEnvelope<VendorSupportFiscalConfig>>(
        `${this.inboundBase}/fiscal/config`,
      )
      .pipe(map((res) => res.data));
  }

  patchVendorSupportFiscalConfig(
    dto: PatchVendorSupportFiscalConfigDto,
  ): Observable<VendorSupportFiscalConfig> {
    return this.http
      .patch<ApiEnvelope<VendorSupportFiscalConfig>>(
        `${this.inboundBase}/fiscal/config`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  listVendorSupportTransmissions(
    query: VendorSupportFiscalQuery = {},
  ): Observable<PaginatedEnvelope<VendorSupportFiscalTransmission>> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', String(query.page));
    if (query.limit) params = params.set('limit', String(query.limit));
    if (query.status) params = params.set('status', query.status);
    if (query.environment) {
      params = params.set('environment', query.environment);
    }
    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }
    return this.http.get<PaginatedEnvelope<VendorSupportFiscalTransmission>>(
      `${this.inboundBase}/transmissions`,
      { params },
    );
  }

  retryVendorSupportTransmission(
    transmissionId: number,
  ): Observable<VendorSupportFiscalTransmission> {
    return this.http
      .post<ApiEnvelope<VendorSupportFiscalTransmission>>(
        `${this.inboundBase}/transmissions/${transmissionId}/retry`,
        {},
      )
      .pipe(map((res) => res.data));
  }
}
