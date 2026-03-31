import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
} from '../interfaces/cartera.interface';

@Injectable({ providedIn: 'root' })
export class CarteraService {
  private http = inject(HttpClient);
  private ar_url = `${environment.apiUrl}/store/accounts-receivable`;
  private ap_url = `${environment.apiUrl}/store/accounts-payable`;

  // ===== ACCOUNTS RECEIVABLE =====

  getReceivables(query: ArQueryParams = {}): Observable<PaginatedResponse<AccountReceivable>> {
    const params = this.buildParams(query);
    return this.http.get<PaginatedResponse<AccountReceivable>>(this.ar_url, { params });
  }

  getReceivable(id: number): Observable<{ data: AccountReceivable }> {
    return this.http.get<{ data: AccountReceivable }>(`${this.ar_url}/${id}`);
  }

  getArDashboard(): Observable<{ data: CarteraDashboard }> {
    return this.http.get<{ data: CarteraDashboard }>(`${this.ar_url}/dashboard`);
  }

  getArAging(): Observable<{ data: AgingReport }> {
    return this.http.get<{ data: AgingReport }>(`${this.ar_url}/aging`);
  }

  getArUpcoming(days = 7): Observable<{ data: AccountReceivable[] }> {
    return this.http.get<{ data: AccountReceivable[] }>(`${this.ar_url}/upcoming`, {
      params: { days: days.toString() },
    });
  }

  registerArPayment(id: number, dto: RegisterArPaymentDto): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ar_url}/${id}/payment`, dto);
  }

  createArAgreement(id: number, dto: CreatePaymentAgreementDto): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ar_url}/${id}/agreement`, dto);
  }

  writeOffAr(id: number): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ar_url}/${id}/write-off`, {});
  }

  // ===== ACCOUNTS PAYABLE =====

  getPayables(query: ApQueryParams = {}): Observable<PaginatedResponse<AccountPayable>> {
    const params = this.buildParams(query);
    return this.http.get<PaginatedResponse<AccountPayable>>(this.ap_url, { params });
  }

  getPayable(id: number): Observable<{ data: AccountPayable }> {
    return this.http.get<{ data: AccountPayable }>(`${this.ap_url}/${id}`);
  }

  getApDashboard(): Observable<{ data: CarteraDashboard }> {
    return this.http.get<{ data: CarteraDashboard }>(`${this.ap_url}/dashboard`);
  }

  getApAging(): Observable<{ data: AgingReport }> {
    return this.http.get<{ data: AgingReport }>(`${this.ap_url}/aging`);
  }

  getApUpcoming(days = 7): Observable<{ data: AccountPayable[] }> {
    return this.http.get<{ data: AccountPayable[] }>(`${this.ap_url}/upcoming`, {
      params: { days: days.toString() },
    });
  }

  registerApPayment(id: number, dto: RegisterApPaymentDto): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ap_url}/${id}/payment`, dto);
  }

  scheduleApPayment(id: number, dto: ScheduleApPaymentDto): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ap_url}/${id}/schedule`, dto);
  }

  writeOffAp(id: number): Observable<{ data: any }> {
    return this.http.post<{ data: any }>(`${this.ap_url}/${id}/write-off`, {});
  }

  batchExportAp(filters?: { supplier_ids?: number[]; date_from?: string; date_to?: string }): Observable<Blob> {
    return this.http.post(`${this.ap_url}/batch-export`, filters || {}, {
      responseType: 'blob',
    });
  }

  // ===== UTILS =====

  private buildParams(query: Record<string, any>): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = String(value);
      }
    }
    return params;
  }
}
