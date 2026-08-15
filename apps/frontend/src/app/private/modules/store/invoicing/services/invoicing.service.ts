import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { DianConfigApiService } from '../../../../../shared/services/dian';
import {
  Invoice,
  InvoiceResolution,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  CreateCreditNoteDto,
  CreateDebitNoteDto,
  CreateResolutionDto,
  UpdateResolutionDto,
  QueryInvoiceDto,
  InvoiceStats,
  InvoiceListResponse,
  ApiResponse,
  DianEmissionStatus,
  DianDocumentEvent,
  InvoicePdfResult,
  InvoicePdfUrl,
  PosUvtThreshold,
} from '../interfaces/invoice.interface';

@Injectable({
  providedIn: 'root',
})
export class InvoicingService {
  private http = inject(HttpClient);

  /**
   * Los métodos DIAN viven en un servicio con base inyectable para que el panel
   * de super admin reutilice el wizard apuntando a otro tenant. Aquí quedan solo
   * como delegación: POS, Ajustes y los effects siguen inyectando este servicio.
   */
  private readonly dianApi = inject(DianConfigApiService);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/invoicing${endpoint ? '/' + endpoint : ''}`;
  }

  // ── Invoices ──────────────────────────────────────────────

  getInvoices(query: QueryInvoiceDto): Observable<InvoiceListResponse> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<InvoiceListResponse>(this.getApiUrl(''), { params });
  }

  /**
   * 5 UVT ceiling for the POS equivalent document. Read once per POS session:
   * the value only changes when the DIAN publishes a new UVT (yearly) or the
   * merchant activates electronic invoicing.
   */
  getPosUvtThreshold(): Observable<ApiResponse<PosUvtThreshold>> {
    return this.http.get<ApiResponse<PosUvtThreshold>>(
      this.getApiUrl('uvt-threshold'),
    );
  }

  getInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.get<ApiResponse<Invoice>>(this.getApiUrl(`${id}`));
  }

  createInvoice(dto: CreateInvoiceDto): Observable<ApiResponse<Invoice>> {
    return this.http.post<ApiResponse<Invoice>>(this.getApiUrl(''), dto);
  }

  createFromOrder(orderId: number): Observable<ApiResponse<Invoice>> {
    return this.http.post<ApiResponse<Invoice>>(
      this.getApiUrl(`from-order/${orderId}`),
      {},
    );
  }

  createFromSalesOrder(salesOrderId: number): Observable<ApiResponse<Invoice>> {
    return this.http.post<ApiResponse<Invoice>>(
      this.getApiUrl(`from-sales-order/${salesOrderId}`),
      {},
    );
  }

  updateInvoice(id: number, dto: UpdateInvoiceDto): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(this.getApiUrl(`${id}`), dto);
  }

  deleteInvoice(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(`${id}`));
  }

  validateInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(
      this.getApiUrl(`${id}/validate`),
      {},
    );
  }

  sendInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(
      this.getApiUrl(`${id}/send`),
      {},
    );
  }

  acceptInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(
      this.getApiUrl(`${id}/accept`),
      {},
    );
  }

  rejectInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(
      this.getApiUrl(`${id}/reject`),
      {},
    );
  }

  cancelInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(
      this.getApiUrl(`${id}/cancel`),
      {},
    );
  }

  voidInvoice(id: number): Observable<ApiResponse<Invoice>> {
    return this.http.patch<ApiResponse<Invoice>>(
      this.getApiUrl(`${id}/void`),
      {},
    );
  }

  // ── Documento electrónico: PDF y eventos RADIAN ───────────

  /**
   * URL FIRMADA del PDF de la factura (`GET :id/pdf`, verificado en
   * `invoicing.controller.ts:178`).
   *
   * NO se abre `invoice.pdf_url` directamente: esa columna guarda la LLAVE S3,
   * no una URL (`invoice-pdf.service.ts` → `generatePdf` persiste `s3_key`).
   * Este endpoint la firma; y si la factura aún no tiene PDF, lo genera en el
   * momento y devuelve la URL del recién creado.
   */
  getInvoicePdfUrl(id: number): Observable<ApiResponse<InvoicePdfUrl>> {
    return this.http.get<ApiResponse<InvoicePdfUrl>>(
      this.getApiUrl(`${id}/pdf`),
    );
  }

  /**
   * Vuelve a construir el PDF y lo sube a S3 pisando el anterior
   * (`POST :id/pdf/regenerate`, verificado en `invoicing.controller.ts:185`).
   *
   * Es la salida cuando el PDF guardado quedó viejo respecto del documento —
   * p. ej. se generó antes de que la DIAN devolviera el CUFE y el QR.
   */
  regenerateInvoicePdf(id: number): Observable<ApiResponse<InvoicePdfResult>> {
    return this.http.post<ApiResponse<InvoicePdfResult>>(
      this.getApiUrl(`${id}/pdf/regenerate`),
      {},
    );
  }

  /**
   * Eventos RADIAN registrados contra la factura (`GET :id/events`, verificado
   * en `invoicing.controller.ts:196`). El backend los devuelve del más nuevo al
   * más viejo (`orderBy: { id: 'desc' }`).
   */
  getDianEvents(id: number): Observable<ApiResponse<DianDocumentEvent[]>> {
    return this.http.get<ApiResponse<DianDocumentEvent[]>>(
      this.getApiUrl(`${id}/events`),
    );
  }

  // ── Credit / Debit Notes ──────────────────────────────────

  createCreditNote(dto: CreateCreditNoteDto): Observable<ApiResponse<Invoice>> {
    return this.http.post<ApiResponse<Invoice>>(
      this.getApiUrl('credit-notes'),
      dto,
    );
  }

  createDebitNote(dto: CreateDebitNoteDto): Observable<ApiResponse<Invoice>> {
    return this.http.post<ApiResponse<Invoice>>(
      this.getApiUrl('debit-notes'),
      dto,
    );
  }

  // ── Resolutions ───────────────────────────────────────────

  getResolutions(): Observable<ApiResponse<InvoiceResolution[]>> {
    return this.dianApi.getResolutions();
  }

  createResolution(dto: CreateResolutionDto): Observable<ApiResponse<InvoiceResolution>> {
    return this.http.post<ApiResponse<InvoiceResolution>>(
      this.getApiUrl('resolutions'),
      dto,
    );
  }

  updateResolution(
    id: number,
    dto: UpdateResolutionDto,
  ): Observable<ApiResponse<InvoiceResolution>> {
    return this.http.patch<ApiResponse<InvoiceResolution>>(
      this.getApiUrl(`resolutions/${id}`),
      dto,
    );
  }

  deleteResolution(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`resolutions/${id}`),
    );
  }

  // ── Stats ─────────────────────────────────────────────────

  getStats(): Observable<ApiResponse<InvoiceStats>> {
    return this.http.get<ApiResponse<InvoiceStats>>(this.getApiUrl('stats'));
  }

  // ── PDF preview ───────────────────────────────────────────

  /**
   * Sample invoice PDF in the given paper format. Built from fabricated document
   * data on the backend, so previewing never consumes resolution numbering.
   */
  previewInvoicePdf(format: string): Observable<Blob> {
    return this.http.get(this.getApiUrl('pdf-preview'), {
      params: { format },
      responseType: 'blob',
    });
  }

  // ── DIAN Config (delegado en DianConfigApiService) ────────

  getDianDashboard(): Observable<any> {
    return this.dianApi.getDianDashboard();
  }

  getDianConfigs(): Observable<any> {
    return this.dianApi.getDianConfigs();
  }

  getDianConfigById(id: number): Observable<any> {
    return this.dianApi.getDianConfigById(id);
  }

  createDianConfig(data: any): Observable<any> {
    return this.dianApi.createDianConfig(data);
  }

  updateDianConfig(id: number, data: any): Observable<any> {
    return this.dianApi.updateDianConfig(id, data);
  }

  deleteDianConfig(id: number): Observable<any> {
    return this.dianApi.deleteDianConfig(id);
  }

  setDefaultDianConfig(id: number): Observable<any> {
    return this.dianApi.setDefaultDianConfig(id);
  }

  uploadDianCertificate(config_id: number, file: File, password: string): Observable<any> {
    return this.dianApi.uploadDianCertificate(config_id, file, password);
  }

  testDianConnection(config_id: number): Observable<any> {
    return this.dianApi.testDianConnection(config_id);
  }

  runDianTestSet(config_id: number, resolution_id: number): Observable<any> {
    return this.dianApi.runDianTestSet(config_id, resolution_id);
  }

  getDianTestSetJob(config_id: number, job_id: string): Observable<any> {
    return this.dianApi.getDianTestSetJob(config_id, job_id);
  }

  getDianTestResults(config_id: number): Observable<any> {
    return this.dianApi.getDianTestResults(config_id);
  }

  checkDianTestSetStatus(config_id: number): Observable<any> {
    return this.dianApi.checkDianTestSetStatus(config_id);
  }

  getDianTestSetDocuments(config_id: number): Observable<any> {
    return this.dianApi.getDianTestSetDocuments(config_id);
  }

  abandonDianTestSet(config_id: number): Observable<any> {
    return this.dianApi.abandonDianTestSet(config_id);
  }

  getDianProductionReadiness(config_id: number): Observable<any> {
    return this.dianApi.getDianProductionReadiness(config_id);
  }

  getDianEmissionStatus(): Observable<ApiResponse<DianEmissionStatus>> {
    return this.dianApi.getDianEmissionStatus();
  }

  promoteDianToProduction(config_id: number): Observable<any> {
    return this.dianApi.promoteDianToProduction(config_id);
  }

  getDianAuditLogs(page = 1, limit = 20, config_id?: number): Observable<any> {
    return this.dianApi.getDianAuditLogs(page, limit, config_id);
  }
}
