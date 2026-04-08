import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  PayrollSystemDefault,
  CreatePayrollDefaultDto,
  UpdatePayrollDefaultDto,
  PayrollDefaultsListResponse,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class PayrollDefaultsApiService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getAll(): Observable<PayrollDefaultsListResponse> {
    return this.http.get<PayrollDefaultsListResponse>(
      `${this.apiUrl}/superadmin/payroll-defaults`,
    );
  }

  getOne(year: number): Observable<PayrollSystemDefault> {
    return this.http.get<PayrollSystemDefault>(
      `${this.apiUrl}/superadmin/payroll-defaults/${year}`,
    );
  }

  create(dto: CreatePayrollDefaultDto): Observable<PayrollSystemDefault> {
    return this.http.post<PayrollSystemDefault>(
      `${this.apiUrl}/superadmin/payroll-defaults`,
      dto,
    );
  }

  update(year: number, dto: UpdatePayrollDefaultDto): Observable<PayrollSystemDefault> {
    return this.http.patch<PayrollSystemDefault>(
      `${this.apiUrl}/superadmin/payroll-defaults/${year}`,
      dto,
    );
  }

  publish(year: number): Observable<PayrollSystemDefault> {
    return this.http.post<PayrollSystemDefault>(
      `${this.apiUrl}/superadmin/payroll-defaults/${year}/publish`,
      {},
    );
  }

  unpublish(year: number): Observable<PayrollSystemDefault> {
    return this.http.post<PayrollSystemDefault>(
      `${this.apiUrl}/superadmin/payroll-defaults/${year}/unpublish`,
      {},
    );
  }
}
