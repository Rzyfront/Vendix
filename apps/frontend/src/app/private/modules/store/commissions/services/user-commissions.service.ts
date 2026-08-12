import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

/**
 * Tipos del feature de comisiones dueño/mecánico (QUI-678).
 */
export type CommissionStatus = 'pending' | 'accrued' | 'paid' | 'declined' | 'reversed';

export interface UserCommission {
  id: number;
  store_id: number;
  organization_id: number;
  employee_id: number;
  provider_id: number | null;
  booking_id: number | null;
  order_id: number | null;
  payment_id: number | null;
  product_id: number;
  base_amount: string;        // Decimal del backend
  commission_pct: string;
  commission_amount: string;
  currency: string;
  status: CommissionStatus;
  declined_reason: string | null;
  declined_at: string | null;
  declined_by_user_id: number | null;
  paid_at: string | null;
  paid_by_user_id: number | null;
  payment_reference: string | null;
  accounting_journal_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joins del backend
  product?: { id: number; name: string };
  booking?: { id: number; booking_number: string; date: string };
}

export interface EmployeeCommissionSummary {
  pending_amount: number;
  pending_count: number;
  accrued_amount: number;
  accrued_count: number;
  paid_amount: number;
  paid_count: number;
  declined_amount: number;
  declined_count: number;
  reversed_count: number;
}

export interface PaginatedCommissionsResponse {
  data: UserCommission[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Service del feature de comisiones (QUI-678).
 *
 * Endpoints:
 *   GET    /store/users/:id/commissions
 *   GET    /store/users/:id/commissions/summary
 *   POST   /store/commissions/:id/decline
 *   POST   /store/commissions/:id/mark-paid
 *   POST   /store/commissions/:id/reopen
 */
@Injectable({ providedIn: 'root' })
export class UserCommissionsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store`;

  listByEmployee(params: {
    employeeId: number;
    status?: CommissionStatus[];
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }): Observable<PaginatedCommissionsResponse> {
    let httpParams = new HttpParams();
    if (params.status && params.status.length) {
      httpParams = httpParams.set('status', params.status.join(','));
    }
    if (params.dateFrom) httpParams = httpParams.set('date_from', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('date_to', params.dateTo);
    if (params.page) httpParams = httpParams.set('page', String(params.page));
    if (params.limit) httpParams = httpParams.set('limit', String(params.limit));

    return this.http
      .get<any>(`${this.apiUrl}/users/${params.employeeId}/commissions`, { params: httpParams })
      .pipe(map((res) => res.data ?? res));
  }

  getSummary(employeeId: number): Observable<EmployeeCommissionSummary> {
    return this.http
      .get<any>(`${this.apiUrl}/users/${employeeId}/commissions/summary`)
      .pipe(map((res) => res.data ?? res));
  }

  decline(accrualId: number, reason: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/commissions/${accrualId}/decline`, { reason });
  }

  markPaid(accrualId: number, paymentReference?: string, notes?: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/commissions/${accrualId}/mark-paid`, {
      payment_reference: paymentReference,
      notes,
    });
  }

  reopen(accrualId: number): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/commissions/${accrualId}/reopen`, {});
  }
}