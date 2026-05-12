import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    total_pages?: number;
  };
}

export interface OrgInvoiceSummary {
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  store_id: number | null;
  invoice_count: number;
  subtotal_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  by_status: Array<{ status: string; count: number; total_amount: number }>;
  by_store: Array<{
    store_id: number | null;
    store_name: string | null;
    count: number;
    total_amount: number;
  }>;
}

export interface OrgInvoiceRow {
  id: number;
  invoice_number: string;
  invoice_type: string;
  status: string;
  customer_name?: string | null;
  customer_tax_id?: string | null;
  total_amount: string | number;
  tax_amount: string | number;
  issue_date: string;
  store?: { id: number; name: string; slug: string } | null;
  resolution?: {
    id: number;
    prefix: string;
    resolution_number: string;
  } | null;
}

export interface OrgResolutionRow {
  id: number;
  resolution_number: string;
  resolution_date?: string;
  prefix: string;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  technical_key?: string | null;
  store_id?: number | null;
  store?: { id: number; name: string; slug: string } | null;
  _count?: { invoices: number };
}

export interface OrgResolutionPayload {
  store_id?: number | null;
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  is_active?: boolean;
  technical_key?: string | null;
}

export interface OrgDianConfigRow {
  id: number;
  name: string;
  nit: string;
  nit_dv?: string | null;
  store_id?: number | null;
  store?: { id: number; name: string; slug?: string | null } | null;
  configuration_type?: 'invoicing' | 'payroll';
  environment: string;
  enablement_status: string;
  is_default: boolean;
  certificate_expiry?: string | null;
}

@Injectable({ providedIn: 'root' })
export class OrgInvoicingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getSummary(query?: Record<string, any>): Observable<ApiResponse<OrgInvoiceSummary>> {
    return this.http.get<ApiResponse<OrgInvoiceSummary>>(
      `${this.apiUrl}/organization/invoicing/summary`,
      { params: this.toParams(query) },
    );
  }

  getInvoices(query?: Record<string, any>): Observable<ApiResponse<OrgInvoiceRow[]>> {
    return this.http.get<ApiResponse<OrgInvoiceRow[]>>(
      `${this.apiUrl}/organization/invoicing/invoices`,
      { params: this.toParams(query) },
    );
  }

  getInvoice(id: number, query?: Record<string, any>): Observable<ApiResponse<OrgInvoiceRow>> {
    return this.http.get<ApiResponse<OrgInvoiceRow>>(
      `${this.apiUrl}/organization/invoicing/invoices/${id}`,
      { params: this.toParams(query) },
    );
  }

  getResolutions(query?: Record<string, any>): Observable<ApiResponse<OrgResolutionRow[]>> {
    return this.http.get<ApiResponse<OrgResolutionRow[]>>(
      `${this.apiUrl}/organization/invoicing/resolutions`,
      { params: this.toParams(query) },
    );
  }

  createResolution(payload: OrgResolutionPayload): Observable<ApiResponse<OrgResolutionRow>> {
    return this.http.post<ApiResponse<OrgResolutionRow>>(
      `${this.apiUrl}/organization/invoicing/resolutions`,
      payload,
    );
  }

  updateResolution(
    id: number,
    payload: Partial<OrgResolutionPayload>,
  ): Observable<ApiResponse<OrgResolutionRow>> {
    return this.http.patch<ApiResponse<OrgResolutionRow>>(
      `${this.apiUrl}/organization/invoicing/resolutions/${id}`,
      payload,
    );
  }

  deleteResolution(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      `${this.apiUrl}/organization/invoicing/resolutions/${id}`,
    );
  }

  getDianConfigs(query?: Record<string, any>): Observable<ApiResponse<OrgDianConfigRow[]>> {
    return this.http.get<ApiResponse<OrgDianConfigRow[]>>(
      `${this.apiUrl}/organization/invoicing/dian-config`,
      { params: this.toParams(query) },
    );
  }

  private toParams(query?: Record<string, any>): HttpParams {
    let params = new HttpParams();
    if (!query) return params;
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return params;
  }
}
