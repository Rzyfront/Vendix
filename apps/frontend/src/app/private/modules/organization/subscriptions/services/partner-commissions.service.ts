import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  CommissionEntry,
  CommissionSummary,
  PayoutEntry,
  ApiResponse,
} from '../interfaces/org-subscription.interface';

@Injectable({ providedIn: 'root' })
export class PartnerCommissionsService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/organization/reseller/commissions${endpoint ? '/' + endpoint : ''}`;
  }

  getCommissions(params?: Record<string, any>): Observable<ApiResponse<CommissionEntry[]>> {
    return this.http.get<ApiResponse<CommissionEntry[]>>(this.getApiUrl(''), { params });
  }

  getCommissionsSummary(): Observable<ApiResponse<CommissionSummary>> {
    return this.http.get<ApiResponse<CommissionSummary>>(this.getApiUrl('summary'));
  }

  getPayouts(params?: Record<string, any>): Observable<ApiResponse<PayoutEntry[]>> {
    return this.http.get<ApiResponse<PayoutEntry[]>>(this.getApiUrl('payouts'), { params });
  }
}
