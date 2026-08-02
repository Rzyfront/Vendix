import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
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
} from '../interfaces/invoice.interface';

@Injectable({
  providedIn: 'root',
})
export class InvoicingService {
  private http = inject(HttpClient);

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
    return this.http.get<ApiResponse<InvoiceResolution[]>>(
      this.getApiUrl('resolutions'),
    );
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

  // ── DIAN Config ─────────────────────────────────────────

  getDianDashboard(): Observable<any> {
    return this.http.get(this.getApiUrl('dian-config/dashboard'));
  }

  getDianConfigs(): Observable<any> {
    return this.http.get(this.getApiUrl('dian-config'));
  }

  getDianConfigById(id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${id}`));
  }

  createDianConfig(data: any): Observable<any> {
    return this.http.post(this.getApiUrl('dian-config'), data);
  }

  updateDianConfig(id: number, data: any): Observable<any> {
    return this.http.patch(this.getApiUrl(`dian-config/${id}`), data);
  }

  deleteDianConfig(id: number): Observable<any> {
    return this.http.delete(this.getApiUrl(`dian-config/${id}`));
  }

  setDefaultDianConfig(id: number): Observable<any> {
    return this.http.patch(this.getApiUrl(`dian-config/${id}/set-default`), {});
  }

  uploadDianCertificate(config_id: number, file: File, password: string): Observable<any> {
    const form_data = new FormData();
    form_data.append('certificate', file);
    form_data.append('password', password);
    form_data.append('config_id', String(config_id));
    return this.http.post(this.getApiUrl('dian-config/upload-certificate'), form_data);
  }

  testDianConnection(config_id: number): Observable<any> {
    return this.http.post(this.getApiUrl(`dian-config/${config_id}/test-connection`), {});
  }

  runDianTestSet(config_id: number, resolution_id: number): Observable<any> {
    return this.http.post(this.getApiUrl(`dian-config/${config_id}/run-test-set`), { resolution_id });
  }

  getDianTestResults(config_id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${config_id}/test-results`));
  }

  /**
   * Re-polls DIAN for the verdict of the ALREADY SUBMITTED test set, using the
   * stored ZipKey. Safe to call repeatedly — it never re-sends the 50 documents,
   * so it does not burn resolution numbers.
   */
  checkDianTestSetStatus(config_id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${config_id}/test-set-status`));
  }

  /**
   * Asks DIAN document by document whether the submitted batch reached its
   * records. Answers what the ZipKey cannot: whether the batch is queued or was
   * never classified at all. Read-only, never re-sends.
   */
  getDianTestSetDocuments(config_id: number): Observable<any> {
    return this.http.get(
      this.getApiUrl(`dian-config/${config_id}/test-set-documents`),
    );
  }

  /**
   * Discards a batch DIAN never judged, releasing the re-send guard so a new
   * test set can be submitted.
   */
  abandonDianTestSet(config_id: number): Observable<any> {
    return this.http.post(
      this.getApiUrl(`dian-config/${config_id}/abandon-test-set`),
      {},
    );
  }

  /** Read-only checklist of what is still missing before emitting real invoices. */
  getDianProductionReadiness(config_id: number): Observable<any> {
    return this.http.get(
      this.getApiUrl(`dian-config/${config_id}/production-readiness`),
    );
  }

  /**
   * Whether this store is really issuing electronic invoices right now.
   *
   * The settings UI must not decide this from `fiscal_status.invoicing.state`:
   * that flag only says the fiscal wizard was completed, so a store still in the
   * DIAN test set would be told it is live and would stop offering sale
   * receipts — which is exactly what it must keep emitting until production.
   */
  getDianEmissionStatus(): Observable<ApiResponse<DianEmissionStatus>> {
    return this.http.get<ApiResponse<DianEmissionStatus>>(
      this.getApiUrl('dian-config/emission-status'),
    );
  }

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

  /** Switches the config to environment=production + enablement_status=enabled. */
  promoteDianToProduction(config_id: number): Observable<any> {
    return this.http.post(
      this.getApiUrl(`dian-config/${config_id}/promote-to-production`),
      {},
    );
  }

  getDianAuditLogs(page = 1, limit = 20, config_id?: number): Observable<any> {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (config_id) params['config_id'] = String(config_id);
    return this.http.get(this.getApiUrl('dian-config/audit-logs'), { params });
  }
}
