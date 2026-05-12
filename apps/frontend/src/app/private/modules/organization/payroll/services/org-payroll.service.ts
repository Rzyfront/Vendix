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

export interface OrgPayrollSummaryRow {
  period: string;
  payroll_number: string;
  frequency: string;
  status: string;
  send_status?: string | null;
  store?: { id: number; name: string; slug?: string | null } | null;
  store_id?: number | null;
  total_earnings: number;
  total_deductions: number;
  employer_costs: number;
  net_pay: number;
  employee_count: number;
  payment_date: string | null;
}

export interface OrgPayrollEmployeeRow {
  employee_name: string;
  position: string;
  department: string;
  payroll_period: string;
  store?: { id: number; name: string; slug?: string | null } | null;
  store_id?: number | null;
  base_salary: number;
  worked_days: number;
  earnings: number;
  deductions: number;
  net_pay: number;
}

export interface OrgPayrollProvisionRow {
  employee_name: string;
  hire_date: string;
  base_salary: number;
  severance: number;
  severance_interest: number;
  vacation: number;
  bonus: number;
  total_provisions: number;
}

export interface OrgPayrollSettings {
  payment_frequency: string;
  withholding_enabled: boolean;
  parafiscales: Record<string, boolean>;
  pila_operator?: string;
  is_default: boolean;
}

@Injectable({ providedIn: 'root' })
export class OrgPayrollService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getSummary(query?: Record<string, any>): Observable<ApiResponse<OrgPayrollSummaryRow[]>> {
    return this.http.get<ApiResponse<OrgPayrollSummaryRow[]>>(
      `${this.apiUrl}/organization/reports/payroll/summary`,
      { params: this.toParams(query) },
    );
  }

  getByEmployee(query?: Record<string, any>): Observable<ApiResponse<OrgPayrollEmployeeRow[]>> {
    return this.http.get<ApiResponse<OrgPayrollEmployeeRow[]>>(
      `${this.apiUrl}/organization/reports/payroll/by-employee`,
      { params: this.toParams(query) },
    );
  }

  getProvisions(query?: Record<string, any>): Observable<ApiResponse<OrgPayrollProvisionRow[]>> {
    return this.http.get<ApiResponse<OrgPayrollProvisionRow[]>>(
      `${this.apiUrl}/organization/reports/payroll/provisions`,
      { params: this.toParams(query) },
    );
  }

  getSettings(query?: Record<string, any>): Observable<ApiResponse<OrgPayrollSettings>> {
    return this.http.get<ApiResponse<OrgPayrollSettings>>(
      `${this.apiUrl}/organization/payroll/settings`,
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
