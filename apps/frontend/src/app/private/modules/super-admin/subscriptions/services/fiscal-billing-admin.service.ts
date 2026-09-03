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
import {
  PlatformDianEvent,
  PlatformInvoiceDeliveryReceipt,
  PlatformInvoiceDetailPayload,
  PlatformInvoicePdfLocation,
} from '../interfaces/platform-invoice-document.interface';

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

  // ─────────────────────────────────────────────────────────
  // Documentos fiscales del riel super-admin
  //
  // UNA SOLA DEFINICIÓN POR CAPACIDAD. Antes el modal de detalle, la página
  // de detalle y este servicio armaban las mismas URLs por separado y
  // divergieron: el modal pedía `invoices/:id?kind=platform` (el controller
  // IGNORA `kind`), `sales-invoices/:id/pdf`, `invoices/:id/deliver` e
  // `invoices/:id/events` — tres de esas rutas no existen en el backend y la
  // cuarta resolvía el documento del otro riel. Cada método de acá cita la
  // ruta real del controller y dice qué espacio de id espera; ver el docblock
  // de `platform-invoice-document.interface.ts` para por qué NO son el mismo
  // número.
  // ─────────────────────────────────────────────────────────

  /**
   * Detalle de una factura SaaS — `GET superadmin/subscriptions/fiscal/invoices/:id`
   * (`subscription-fiscal.controller.ts:429`).
   *
   * `id` = `subscription_invoices.id`, que es el `source_id` de las filas de
   * `GET /transmissions` con `source_type='subscription_invoice'`.
   *
   * El parámetro `?kind=` que enviaba el modal NO existe: el controller no lo
   * lee, así que pedirlo con el id de una transmisión de plataforma devolvía
   * la factura SaaS que casualmente tuviera ese número, o 404.
   */
  getSubscriptionInvoice(id: number): Observable<PlatformInvoiceDetailPayload> {
    return this.http
      .get<
        ApiEnvelope<PlatformInvoiceDetailPayload>
      >(`${this.base}/invoices/${id}`)
      .pipe(map((res) => res.data));
  }

  /**
   * Detalle de una factura de plataforma —
   * `GET superadmin/subscriptions/fiscal/platform-invoices/:id`
   * (`subscription-fiscal.controller.ts:448`).
   *
   * `id` = `fiscal_transmissions.id`. Es una ruta separada a propósito:
   * `subscription_invoices` y `fiscal_transmissions` son secuencias
   * independientes y compartir `/invoices/:id` hacía colisionar los dos
   * documentos.
   */
  getPlatformInvoice(id: number): Observable<PlatformInvoiceDetailPayload> {
    return this.http
      .get<
        ApiEnvelope<PlatformInvoiceDetailPayload>
      >(`${this.base}/platform-invoices/${id}`)
      .pipe(map((res) => res.data));
  }

  /**
   * Ubicación del PDF persistido en S3 —
   * `GET superadmin/subscriptions/fiscal/invoices/:id/pdf`
   * (`platform-invoicing.controller.ts:480`).
   *
   * `id` = `fiscal_transmissions.id` (`PlatformInvoicePdfService.getPdf`).
   * Devuelve `{ key, url }` con la URL FIRMADA; no es un binario, así que se
   * abre con `window.open(url)` y nunca con `responseType:'blob'`.
   *
   * La ruta `sales-invoices/:id/pdf` que usaba el modal no existe.
   */
  getPlatformInvoicePdf(id: number): Observable<PlatformInvoicePdfLocation> {
    return this.http
      .get<
        ApiEnvelope<PlatformInvoicePdfLocation>
      >(`${this.base}/invoices/${id}/pdf`)
      .pipe(map((res) => res.data));
  }

  /**
   * Previsualización del PDF —
   * `POST superadmin/subscriptions/fiscal/invoices/:id/preview-pdf`
   * (`platform-invoicing.controller.ts:461`).
   *
   * `id` = `fiscal_transmissions.id`. Este SÍ responde binario
   * (`res.setHeader('Content-Type','application/pdf')`), por eso pide
   * `responseType: 'blob'`. Un `res.success` sobre esta respuesta es
   * siempre `undefined`: no hay envelope que leer.
   */
  previewPlatformInvoicePdf(id: number): Observable<Blob> {
    return this.http.post(
      `${this.base}/invoices/${id}/preview-pdf`,
      {},
      { responseType: 'blob' },
    );
  }

  /**
   * Regenera el PDF sin reemitir —
   * `POST superadmin/subscriptions/fiscal/invoices/:id/pdf/regenerate`
   * (`platform-invoicing.controller.ts:494`). `id` = `fiscal_transmissions.id`.
   */
  regeneratePlatformInvoicePdf(
    id: number,
  ): Observable<PlatformInvoicePdfLocation> {
    return this.http
      .post<
        ApiEnvelope<PlatformInvoicePdfLocation>
      >(`${this.base}/invoices/${id}/pdf/regenerate`, {})
      .pipe(map((res) => res.data));
  }

  /**
   * XML FIRMADO del documento de plataforma —
   * `GET superadmin/subscriptions/fiscal/platform-invoices/:id/xml`
   * (`subscription-fiscal.controller.ts`). `id` = `fiscal_transmissions.id`.
   *
   * Ruta propia y no un campo del detalle: el XML pesa entre 100 y 500 KB y
   * los dos `select` de detalle lo excluyen a propósito. El backend responde
   * `application/xml` en crudo —sin envelope—, así que se pide
   * `responseType: 'text'`; leer `res.success` sobre esta respuesta daría
   * siempre `undefined`, que es el defecto que tenía la previsualización del
   * PDF antes de arreglarse.
   *
   * Un 404 aquí significa «esta transmisión todavía no tiene XML» (encolada, o
   * error antes de firmar), no «no existe la factura».
   */
  getPlatformInvoiceXml(id: number): Observable<string> {
    return this.http.get(`${this.base}/platform-invoices/${id}/xml`, {
      responseType: 'text',
    });
  }

  saveXmlDocument(xml: string, filename: string): void {
    const url = URL.createObjectURL(
      new Blob([xml], { type: 'application/xml;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Reenvío del documento por correo —
   * `POST superadmin/subscriptions/fiscal/sales-invoices/:id/deliver`
   * (`platform-invoicing.controller.ts:564`). La ruta `invoices/:id/deliver`
   * que usaba el modal no existe.
   */
  deliverPlatformInvoice(
    id: number,
    email: string,
  ): Observable<PlatformInvoiceDeliveryReceipt> {
    return this.http
      .post<
        ApiEnvelope<PlatformInvoiceDeliveryReceipt>
      >(`${this.base}/sales-invoices/${id}/deliver`, { email })
      .pipe(map((res) => res.data));
  }

  /**
   * Eventos RADIAN del documento —
   * `GET superadmin/subscriptions/fiscal/sales-invoices/:id/events`
   * (`platform-invoicing.controller.ts:593`). La ruta `invoices/:id/events`
   * que usaban el modal y este servicio no existe.
   */
  listPlatformDianEvents(id: number): Observable<PlatformDianEvent[]> {
    return this.http
      .get<
        ApiEnvelope<PlatformDianEvent[]>
      >(`${this.base}/sales-invoices/${id}/events`)
      .pipe(map((res) => res.data ?? []));
  }

  /**
   * Registro de un evento RADIAN —
   * `POST superadmin/subscriptions/fiscal/sales-invoices/:id/events`
   * (`platform-invoicing.controller.ts:610`).
   */
  registerPlatformDianEvent(
    id: number,
    dto: { event_code: string },
  ): Observable<PlatformDianEvent> {
    return this.http
      .post<
        ApiEnvelope<PlatformDianEvent>
      >(`${this.base}/sales-invoices/${id}/events`, dto)
      .pipe(map((res) => res.data));
  }
}
