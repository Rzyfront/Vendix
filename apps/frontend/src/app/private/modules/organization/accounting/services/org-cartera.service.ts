import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AccountReceivable,
  AccountPayable,
  ArQueryParams,
  ApQueryParams,
  RegisterArPaymentDto,
  RegisterApPaymentDto,
  ScheduleApPaymentDto,
  CreatePaymentAgreementDto,
  CarteraDashboard,
  AgingReport,
  PaginatedResponse,
} from '../../../store/accounting/interfaces/cartera.interface';

/**
 * Organization-scoped cartera service.
 *
 * Mirrors the store-level `CarteraService` (same method names and return
 * shapes) but consumes the consolidated `/organization/accounts-receivable/*`
 * and `/organization/accounts-payable/*` endpoints exposed when the
 * organization owns the fiscal scope.
 *
 * Every read/write threads an optional `store_id` so the org accounting shell
 * can scope a consolidated view down to a single store via `?store_id`.
 */
@Injectable({ providedIn: 'root' })
export class OrgCarteraService {
  private readonly http = inject(HttpClient);
  private readonly ar_url = `${environment.apiUrl}/organization/accounts-receivable`;
  private readonly ap_url = `${environment.apiUrl}/organization/accounts-payable`;

  // ===== ACCOUNTS RECEIVABLE =====

  getReceivables(
    query: ArQueryParams = {},
    storeId?: number | string | null,
  ): Observable<PaginatedResponse<AccountReceivable>> {
    return this.http.get<PaginatedResponse<AccountReceivable>>(this.ar_url, {
      params: this.toParams({ ...query, store_id: storeId }),
    });
  }

  getReceivable(
    id: number,
    storeId?: number | string | null,
  ): Observable<{ data: AccountReceivable }> {
    return this.http.get<{ data: AccountReceivable }>(`${this.ar_url}/${id}`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  getArDashboard(storeId?: number | string | null): Observable<{ data: CarteraDashboard }> {
    return this.http.get<{ data: CarteraDashboard }>(`${this.ar_url}/dashboard`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  getArAging(storeId?: number | string | null): Observable<{ data: AgingReport }> {
    return this.http.get<{ data: AgingReport }>(`${this.ar_url}/aging`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  getArUpcoming(
    days = 7,
    storeId?: number | string | null,
  ): Observable<{ data: AccountReceivable[] }> {
    return this.http.get<{ data: AccountReceivable[] }>(`${this.ar_url}/upcoming`, {
      params: this.toParams({ days, store_id: storeId }),
    });
  }

  getArOverdueByCustomer(
    storeId?: number | string | null,
  ): Observable<{ data: AccountReceivable[] }> {
    return this.http.get<{ data: AccountReceivable[] }>(`${this.ar_url}/overdue-by-customer`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  registerArPayment(
    id: number,
    dto: RegisterArPaymentDto,
    storeId?: number | string | null,
  ): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ar_url}/${id}/payment`, dto, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  createArAgreement(
    id: number,
    dto: CreatePaymentAgreementDto,
    storeId?: number | string | null,
  ): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ar_url}/${id}/agreement`, dto, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  writeOffAr(id: number, storeId?: number | string | null): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(
      `${this.ar_url}/${id}/write-off`,
      {},
      { params: this.toParams({ store_id: storeId }) },
    );
  }

  // ===== ACCOUNTS PAYABLE =====

  getPayables(
    query: ApQueryParams = {},
    storeId?: number | string | null,
  ): Observable<PaginatedResponse<AccountPayable>> {
    return this.http.get<PaginatedResponse<AccountPayable>>(this.ap_url, {
      params: this.toParams({ ...query, store_id: storeId }),
    });
  }

  getPayable(
    id: number,
    storeId?: number | string | null,
  ): Observable<{ data: AccountPayable }> {
    return this.http.get<{ data: AccountPayable }>(`${this.ap_url}/${id}`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  getApDashboard(storeId?: number | string | null): Observable<{ data: CarteraDashboard }> {
    return this.http.get<{ data: CarteraDashboard }>(`${this.ap_url}/dashboard`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  getApAging(storeId?: number | string | null): Observable<{ data: AgingReport }> {
    return this.http.get<{ data: AgingReport }>(`${this.ap_url}/aging`, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  getApUpcoming(
    days = 7,
    storeId?: number | string | null,
  ): Observable<{ data: AccountPayable[] }> {
    return this.http.get<{ data: AccountPayable[] }>(`${this.ap_url}/upcoming`, {
      params: this.toParams({ days, store_id: storeId }),
    });
  }

  registerApPayment(
    id: number,
    dto: RegisterApPaymentDto,
    storeId?: number | string | null,
  ): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ap_url}/${id}/payment`, dto, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  scheduleApPayment(
    id: number,
    dto: ScheduleApPaymentDto,
    storeId?: number | string | null,
  ): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ap_url}/${id}/schedule`, dto, {
      params: this.toParams({ store_id: storeId }),
    });
  }

  cancelApSchedule(
    scheduleId: number,
    storeId?: number | string | null,
  ): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(
      `${this.ap_url}/schedules/${scheduleId}/cancel`,
      {},
      { params: this.toParams({ store_id: storeId }) },
    );
  }

  writeOffAp(id: number, storeId?: number | string | null): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(
      `${this.ap_url}/${id}/write-off`,
      {},
      { params: this.toParams({ store_id: storeId }) },
    );
  }

  batchExportAp(
    filters?: { supplier_ids?: number[]; date_from?: string; date_to?: string },
    storeId?: number | string | null,
  ): Observable<Blob> {
    return this.http.post(`${this.ap_url}/batch-export`, filters || {}, {
      params: this.toParams({ store_id: storeId }),
      responseType: 'blob',
    });
  }

  // ===== UTILS =====

  private toParams(query?: Record<string, any>): HttpParams {
    let params = new HttpParams();
    if (!query) return params;
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        params = params.set(k, String(v));
      }
    }
    return params;
  }
}
