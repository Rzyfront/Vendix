import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { CrmApiResponse, CrmLandingState } from '../models/crm.model';

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
}
