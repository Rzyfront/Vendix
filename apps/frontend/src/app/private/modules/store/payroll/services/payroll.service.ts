import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
  PayrollSettlement,
  SettlementStats,
  CreateSettlementDto,
  EmployeeAdvance,
  AdvanceStats,
  CreateAdvanceDto,
  AdvanceApproveDto,
  AdvanceManualPaymentDto,
  EmployeeAdvanceSummary,
  BankExportResult,
} from '../interfaces/payroll.interface';
import {
  BulkEmployeeAnalysisResult,
  BulkEmployeeUploadResult,
} from '../interfaces/bulk-employee-analysis.interface';

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

  // ─── Bulk Upload (Session-based) ──────────────────────

  getBulkEmployeeTemplate(): Observable<Blob> {
    return this.http.get(this.getApiUrl('employees/bulk/template/download'), { responseType: 'blob' });
  }

  analyzeBulkEmployees(file: File): Observable<BulkEmployeeAnalysisResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<ApiResponse<BulkEmployeeAnalysisResult>>(
        this.getApiUrl('employees/bulk/analyze'),
        formData,
      )
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  uploadBulkEmployeesFromSession(
    sessionId: string,
  ): Observable<BulkEmployeeUploadResult> {
    return this.http
      .post<ApiResponse<BulkEmployeeUploadResult>>(
        this.getApiUrl('employees/bulk/upload-session'),
        { session_id: sessionId },
      )
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  cancelBulkEmployeeSession(sessionId: string): Observable<void> {
    return this.http
      .delete<void>(
        this.getApiUrl(`employees/bulk/session/${sessionId}`),
      )
      .pipe(catchError(this.handleError));
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

  // ─── Settlements ───────────────────────────────────────

  getSettlements(query: Record<string, any> = {}): Observable<{ data: PayrollSettlement[]; meta: any }> {
    const params = this.buildParams(query);
    return this.http.get<{ data: PayrollSettlement[]; meta: any }>(this.getApiUrl('settlements'), { params });
  }

  getSettlement(id: number): Observable<ApiResponse<PayrollSettlement>> {
    return this.http.get<ApiResponse<PayrollSettlement>>(this.getApiUrl(`settlements/${id}`));
  }

  getSettlementStats(): Observable<ApiResponse<SettlementStats>> {
    return this.http.get<ApiResponse<SettlementStats>>(this.getApiUrl('settlements/stats'));
  }

  createSettlement(dto: CreateSettlementDto): Observable<ApiResponse<PayrollSettlement>> {
    return this.http.post<ApiResponse<PayrollSettlement>>(this.getApiUrl('settlements'), dto);
  }

  recalculateSettlement(id: number): Observable<ApiResponse<PayrollSettlement>> {
    return this.http.post<ApiResponse<PayrollSettlement>>(this.getApiUrl(`settlements/${id}/recalculate`), {});
  }

  approveSettlement(id: number, notes?: string): Observable<ApiResponse<PayrollSettlement>> {
    return this.http.patch<ApiResponse<PayrollSettlement>>(this.getApiUrl(`settlements/${id}/approve`), { notes });
  }

  paySettlement(id: number): Observable<ApiResponse<PayrollSettlement>> {
    return this.http.patch<ApiResponse<PayrollSettlement>>(this.getApiUrl(`settlements/${id}/pay`), {});
  }

  cancelSettlement(id: number): Observable<ApiResponse<PayrollSettlement>> {
    return this.http.patch<ApiResponse<PayrollSettlement>>(this.getApiUrl(`settlements/${id}/cancel`), {});
  }

  getSettlementPayslip(id: number): Observable<Blob> {
    return this.http.get(this.getApiUrl(`settlements/${id}/payslip`), { responseType: 'blob' });
  }

  // ─── Advances ─────────────────────────────────────────

  getAdvances(query: Record<string, any> = {}): Observable<{ data: EmployeeAdvance[]; meta: any }> {
    const params = this.buildParams(query);
    return this.http.get<{ data: EmployeeAdvance[]; meta: any }>(this.getApiUrl('advances'), { params });
  }

  getAdvance(id: number): Observable<ApiResponse<EmployeeAdvance>> {
    return this.http.get<ApiResponse<EmployeeAdvance>>(this.getApiUrl(`advances/${id}`));
  }

  getAdvanceStats(): Observable<ApiResponse<AdvanceStats>> {
    return this.http.get<ApiResponse<AdvanceStats>>(this.getApiUrl('advances/stats'));
  }

  createAdvance(dto: CreateAdvanceDto): Observable<ApiResponse<EmployeeAdvance>> {
    return this.http.post<ApiResponse<EmployeeAdvance>>(this.getApiUrl('advances'), dto);
  }

  approveAdvance(id: number, dto?: AdvanceApproveDto): Observable<ApiResponse<EmployeeAdvance>> {
    return this.http.patch<ApiResponse<EmployeeAdvance>>(this.getApiUrl(`advances/${id}/approve`), dto || {});
  }

  rejectAdvance(id: number): Observable<ApiResponse<EmployeeAdvance>> {
    return this.http.patch<ApiResponse<EmployeeAdvance>>(this.getApiUrl(`advances/${id}/reject`), {});
  }

  cancelAdvance(id: number): Observable<ApiResponse<EmployeeAdvance>> {
    return this.http.patch<ApiResponse<EmployeeAdvance>>(this.getApiUrl(`advances/${id}/cancel`), {});
  }

  registerAdvancePayment(id: number, dto: AdvanceManualPaymentDto): Observable<ApiResponse<EmployeeAdvance>> {
    return this.http.post<ApiResponse<EmployeeAdvance>>(this.getApiUrl(`advances/${id}/pay`), dto);
  }

  getEmployeeAdvanceSummary(employeeId: number): Observable<ApiResponse<EmployeeAdvanceSummary>> {
    return this.http.get<ApiResponse<EmployeeAdvanceSummary>>(this.getApiUrl(`advances/employee/${employeeId}/summary`));
  }

  // ─── Paystubs & ACH ───────────────────────────────────

  getPayslip(itemId: number): Observable<Blob> {
    return this.http.get(this.getApiUrl(`items/${itemId}/payslip`), { responseType: 'blob' });
  }

  generateBulkPayslips(runId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(this.getApiUrl(`runs/${runId}/generate-payslips`), {});
  }

  exportAch(runId: number, bank: string): Observable<Blob> {
    return this.http.post(this.getApiUrl(`runs/${runId}/export-ach`), null, {
      params: { bank },
      responseType: 'blob',
    });
  }

  validateBankData(runId: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(this.getApiUrl(`runs/${runId}/validate-bank-data`));
  }

  // ─── Helpers ──────────────────────────────────────────

  private buildParams(query: Record<string, any>): Record<string, any> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return params;
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

  private handleError(error: any): Observable<never> {
    console.error('PayrollService Error:', error);
    let errorMessage = 'Ocurrió un error';
    if (error.error?.message) {
      errorMessage = error.error.message;
    } else if (error.status === 400) {
      errorMessage = 'Datos inválidos proporcionados';
    } else if (error.status === 401) {
      errorMessage = 'Acceso no autorizado';
    } else if (error.status === 403) {
      errorMessage = 'Acceso prohibido';
    } else if (error.status === 404) {
      errorMessage = 'Recurso no encontrado';
    } else if (error.status === 0) {
      errorMessage = 'Error de conexión con el servidor';
    }
    return throwError(() => errorMessage);
  }
}
