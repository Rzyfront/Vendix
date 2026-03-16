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

  runDianTestSet(config_id: number): Observable<any> {
    return this.http.post(this.getApiUrl(`dian-config/${config_id}/run-test-set`), {});
  }

  getDianTestResults(config_id: number): Observable<any> {
    return this.http.get(this.getApiUrl(`dian-config/${config_id}/test-results`));
  }

  getDianAuditLogs(page = 1, limit = 20, config_id?: number): Observable<any> {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (config_id) params['config_id'] = String(config_id);
    return this.http.get(this.getApiUrl('dian-config/audit-logs'), { params });
  }
}
