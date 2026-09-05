import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  CrmApiResponse,
  CrmLandingState,
  CrmLead,
  CrmLeadStatus,
  CrmLeadsData,
} from '../models/crm.model';

/**
 * HTTP service for the store CRM module.
 * Path base: `${environment.apiUrl}/store/crm` (admin panel surface).
 */
@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/crm`;

  getLanding(): Observable<CrmApiResponse<CrmLandingState>> {
    return this.http.get<CrmApiResponse<CrmLandingState>>(
      `${this.apiUrl}/landing`,
    );
  }

  activate(): Observable<CrmApiResponse<CrmLandingState>> {
    return this.http.post<CrmApiResponse<CrmLandingState>>(
      `${this.apiUrl}/activate`,
      {},
    );
  }

  deactivate(): Observable<CrmApiResponse<CrmLandingState>> {
    return this.http.post<CrmApiResponse<CrmLandingState>>(
      `${this.apiUrl}/deactivate`,
      {},
    );
  }

  saveDraft(content_json: unknown): Observable<CrmApiResponse<CrmLandingState>> {
    return this.http.put<CrmApiResponse<CrmLandingState>>(
      `${this.apiUrl}/landing`,
      { content_json },
    );
  }

  publish(): Observable<CrmApiResponse<CrmLandingState>> {
    return this.http.post<CrmApiResponse<CrmLandingState>>(
      `${this.apiUrl}/publish`,
      {},
    );
  }

  getGenerationJobStatus(
    jobId: string,
  ): Observable<CrmApiResponse<{ status: string; error?: string }>> {
    return this.http.get<
      CrmApiResponse<{ status: string; error?: string }>
    >(`${this.apiUrl}/generation/${jobId}`);
  }

  getLeads(status?: string): Observable<CrmApiResponse<CrmLeadsData>> {
    const params: Record<string, string> = {};
    if (status && status !== 'all') params['status'] = status;
    return this.http.get<CrmApiResponse<CrmLeadsData>>(`${this.apiUrl}/leads`, {
      params,
    });
  }

  updateLeadStatus(
    id: number,
    status: CrmLeadStatus,
  ): Observable<CrmApiResponse<CrmLead>> {
    return this.http.patch<CrmApiResponse<CrmLead>>(
      `${this.apiUrl}/leads/${id}/status`,
      { status },
    );
  }
}
