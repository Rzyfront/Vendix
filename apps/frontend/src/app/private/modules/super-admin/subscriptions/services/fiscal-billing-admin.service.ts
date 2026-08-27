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
  ClonePlatformProfilePayload,
  CreatePlatformProfilePayload,
  CreatePlatformResolutionDto,
  ListPlatformProfilesQuery,
  ListPlatformResolutionsQuery,
  MaskedDianConfiguration,
  PaginatedEnvelope,
  PatchVendorSupportFiscalConfigDto,
  PlatformInvoiceProfileCatalogEntry,
  PlatformInvoiceProfileDetail,
  PlatformInvoiceProfileVersionSummary,
  PlatformInvoiceProfileVersion,
  PlatformProfilePageMeta,
  PlatformProfilePreviewResult,
  PlatformResolution,
  PreviewPlatformProfilePayload,
  SubscriptionFiscalLastTestResult,
  SubscriptionFiscalQuery,
  SubscriptionFiscalStatus,
  SubscriptionFiscalTransmission,
  UpdatePlatformProfilePayload,
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

  // ─────────────────────────────────────────────────────────
  // Platform Invoice Profiles
  // ─────────────────────────────────────────────────────────

  /**
   * Listado paginado de perfiles — `GET /profiles?limit=&page=&search=&operation_type=&state=`.
   *
   * La respuesta preserva el envelope de paginación del backend con su `meta` para
   * que el store pueda reusar `PlatformProfilePageMeta` sin redefinirla.
   */
  listProfiles(
    query: ListPlatformProfilesQuery = {},
  ): Observable<{ data: import('../interfaces/fiscal-billing.interface').PlatformInvoiceProfile[]; meta: PlatformProfilePageMeta }> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', String(query.page));
    if (query.limit) params = params.set('limit', String(query.limit));
    if (query.search?.trim()) params = params.set('search', query.search.trim());
    if (query.operation_type) params = params.set('operation_type', query.operation_type);
    if (query.state) params = params.set('state', query.state);

    return this.http
      .get<{ success: boolean; data: import('../interfaces/fiscal-billing.interface').PlatformInvoiceProfile[]; meta: PlatformProfilePageMeta }>(
        `${this.base}/profiles`,
        { params },
      );
  }

  /** Catálogo de perfiles activos para el selector del wizard — `GET /profiles/catalog`. */
  getProfileCatalog(): Observable<PlatformInvoiceProfileCatalogEntry[]> {
    return this.http
      .get<ApiEnvelope<PlatformInvoiceProfileCatalogEntry[]>>(
        `${this.base}/profiles/catalog`,
      )
      .pipe(map((res) => res.data ?? []));
  }

  /** Plantillas DIAN disponibles — `GET /profiles/templates`. */
  getProfileTemplates(): Observable<{ success: boolean; data: unknown }> {
    return this.http
      .get<{ success: boolean; data: unknown }>(
        `${this.base}/profiles/templates`,
      );
  }

  /** Detalle de un perfil — `GET /profiles/:id`. */
  getProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .get<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles/${id}`,
      )
      .pipe(map((res) => res.data));
  }

  /** Historial de versiones — `GET /profiles/:id/versions?limit=`. */
  getProfileVersions(
    id: number,
    limit = 20,
  ): Observable<{ data: PlatformInvoiceProfileVersionSummary[]; meta: PlatformProfilePageMeta }> {
    const params = new HttpParams().set('limit', String(limit));
    return this.http
      .get<{ success: boolean; data: PlatformInvoiceProfileVersionSummary[]; meta: PlatformProfilePageMeta }>(
        `${this.base}/profiles/${id}/versions`,
        { params },
      );
  }

  /** Detalle de una versión concreta — `GET /profiles/:id/versions/:version`. */
  getProfileVersion(
    id: number,
    version: number,
  ): Observable<PlatformInvoiceProfileVersion> {
    return this.http
      .get<ApiEnvelope<PlatformInvoiceProfileVersion>>(
        `${this.base}/profiles/${id}/versions/${version}`,
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Crear perfil — `POST /profiles`.
   *
   * Devuelve 201 con `PlatformInvoiceProfileDetail`.
   */
  createProfile(
    dto: CreatePlatformProfilePayload,
  ): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .post<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Actualizar perfil — `PATCH /profiles/:id`.
   *
   * IMPORTANTE: usa PATCH, no PUT. El endpoint PUT no existe y usar PUT contra
   * él produce 404. El editor de tienda ya tiene este bug; este servicio lo evita.
   */
  updateProfile(
    id: number,
    dto: UpdatePlatformProfilePayload,
  ): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .patch<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles/${id}`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  /** Clonar perfil — `POST /profiles/:id/clone`. */
  cloneProfile(
    id: number,
    dto: ClonePlatformProfilePayload,
  ): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .post<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles/${id}/clone`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  /** Activar perfil — `POST /profiles/:id/activate`. */
  activateProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .post<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles/${id}/activate`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  /** Desactivar perfil — `POST /profiles/:id/deactivate`. */
  deactivateProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .post<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles/${id}/deactivate`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  /** Marcar como predeterminado — `POST /profiles/:id/set-default`. */
  setDefaultProfile(id: number): Observable<PlatformInvoiceProfileDetail> {
    return this.http
      .post<ApiEnvelope<PlatformInvoiceProfileDetail>>(
        `${this.base}/profiles/${id}/set-default`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Previsualizar perfil — `POST /profiles/:id/preview`.
   *
   * Devuelve `not_performed: { numbering_reserved: false, … }` cuando realmente
   * no se reservó numeración, para que la UI pueda afirmar que no se quemó
   * consecutivo sin tener que ir a la base.
   */
  previewProfile(
    id: number,
    dto: PreviewPlatformProfilePayload,
  ): Observable<PlatformProfilePreviewResult> {
    return this.http
      .post<ApiEnvelope<PlatformProfilePreviewResult>>(
        `${this.base}/profiles/${id}/preview`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  /** Eliminar perfil — `DELETE /profiles/:id`. */
  deleteProfile(id: number): Observable<{ id: number; deleted: boolean }> {
    return this.http
      .delete<ApiEnvelope<{ id: number; deleted: boolean }>>(
        `${this.base}/profiles/${id}`,
      )
      .pipe(map((res) => res.data));
  }
}
