import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Employee,
  PayrollRun,
  PayrollRules,
  PayrollRulesYearsResponse,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  QueryEmployeeDto,
  CreatePayrollRunDto,
  QueryPayrollRunDto,
  EmployeeListResponse,
  PayrollListResponse,
  PayrollStats,
  EmployeeStats,
  ApiResponse,
  AvailableUser,
} from '../interfaces/payroll.interface';

@Injectable({
  providedIn: 'root',
})
export class PayrollService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/payroll${endpoint ? '/' + endpoint : ''}`;
  }

  // ─── Employees ──────────────────────────────────────────

  getEmployees(query: QueryEmployeeDto): Observable<EmployeeListResponse> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<EmployeeListResponse>(this.getApiUrl('employees'), { params });
  }

  getEmployee(id: number): Observable<ApiResponse<Employee>> {
    return this.http.get<ApiResponse<Employee>>(this.getApiUrl(`employees/${id}`));
  }

  createEmployee(dto: CreateEmployeeDto): Observable<ApiResponse<Employee>> {
    return this.http.post<ApiResponse<Employee>>(this.getApiUrl('employees'), dto);
  }

  updateEmployee(id: number, dto: UpdateEmployeeDto): Observable<ApiResponse<Employee>> {
    return this.http.patch<ApiResponse<Employee>>(this.getApiUrl(`employees/${id}`), dto);
  }

  terminateEmployee(id: number): Observable<ApiResponse<Employee>> {
    return this.http.patch<ApiResponse<Employee>>(this.getApiUrl(`employees/${id}/terminate`), {});
  }

  getEmployeeStats(): Observable<ApiResponse<EmployeeStats>> {
    return this.http.get<ApiResponse<EmployeeStats>>(this.getApiUrl('employees/stats'));
  }

  getAvailableUsers(): Observable<ApiResponse<AvailableUser[]>> {
    return this.http.get<ApiResponse<AvailableUser[]>>(this.getApiUrl('employees/available-users'));
  }

  // ─── Payroll Runs ───────────────────────────────────────

  getPayrollRuns(query: QueryPayrollRunDto): Observable<PayrollListResponse> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<PayrollListResponse>(this.getApiUrl('runs'), { params });
  }

  getPayrollRun(id: number): Observable<ApiResponse<PayrollRun>> {
    return this.http.get<ApiResponse<PayrollRun>>(this.getApiUrl(`runs/${id}`)).pipe(
      map((res) => ({
        ...res,
        data: this.mapPayrollRun(res.data),
      })),
    );
  }

  createPayrollRun(dto: CreatePayrollRunDto): Observable<ApiResponse<PayrollRun>> {
    return this.http.post<ApiResponse<PayrollRun>>(this.getApiUrl('runs'), dto);
  }

  calculatePayrollRun(id: number): Observable<ApiResponse<PayrollRun>> {
    return this.http.post<ApiResponse<PayrollRun>>(this.getApiUrl(`runs/${id}/calculate`), {}).pipe(
      map((res) => ({ ...res, data: this.mapPayrollRun(res.data) })),
    );
  }

  approvePayrollRun(id: number): Observable<ApiResponse<PayrollRun>> {
    return this.http.patch<ApiResponse<PayrollRun>>(this.getApiUrl(`runs/${id}/approve`), {}).pipe(
      map((res) => ({ ...res, data: this.mapPayrollRun(res.data) })),
    );
  }

  sendPayrollRun(id: number): Observable<ApiResponse<PayrollRun>> {
    return this.http.patch<ApiResponse<PayrollRun>>(this.getApiUrl(`runs/${id}/send`), {}).pipe(
      map((res) => ({ ...res, data: this.mapPayrollRun(res.data) })),
    );
  }

  payPayrollRun(id: number): Observable<ApiResponse<PayrollRun>> {
    return this.http.patch<ApiResponse<PayrollRun>>(this.getApiUrl(`runs/${id}/pay`), {}).pipe(
      map((res) => ({ ...res, data: this.mapPayrollRun(res.data) })),
    );
  }

  cancelPayrollRun(id: number): Observable<ApiResponse<PayrollRun>> {
    return this.http.patch<ApiResponse<PayrollRun>>(this.getApiUrl(`runs/${id}/cancel`), {}).pipe(
      map((res) => ({ ...res, data: this.mapPayrollRun(res.data) })),
    );
  }

  getPayrollRunStats(): Observable<ApiResponse<PayrollStats>> {
    return this.http.get<ApiResponse<PayrollStats>>(this.getApiUrl('runs/stats'));
  }

  // ─── Payroll Rules ─────────────────────────────────────

  getConfiguredYears(): Observable<ApiResponse<PayrollRulesYearsResponse>> {
    return this.http.get<ApiResponse<PayrollRulesYearsResponse>>(this.getApiUrl('rules'));
  }

  getPayrollRules(year: number): Observable<ApiResponse<PayrollRules>> {
    return this.http.get<ApiResponse<PayrollRules>>(this.getApiUrl(`rules/${year}`));
  }

  updatePayrollRules(year: number, rules: Partial<PayrollRules>): Observable<ApiResponse<PayrollRules>> {
    return this.http.patch<ApiResponse<PayrollRules>>(this.getApiUrl(`rules/${year}`), rules);
  }

  /** Map backend payroll_items field to frontend items field */
  private mapPayrollRun(run: any): PayrollRun {
    if (!run) return run;
    const { payroll_items, ...rest } = run;
    return {
      ...rest,
      items: payroll_items || rest.items,
    };
  }
}
