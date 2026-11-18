import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { LandingPreviewContext } from '../../apps/landing-builder/landing-preview';
import { CrmApiResponse, CrmLandingState } from '../models/crm.model';

/**
 * HTTP service for the store CRM module.
 * Path base: `${environment.apiUrl}/store/crm` (admin panel surface).
 */
/**
 * Resume key of the AI landing generation (QUI-1020): the CRM page and the
 * landing builder wait on the same job.
 */
export const CRM_LANDING_RESUME_KEY = 'crm_landing:generation';

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

  /** POST that enqueues the AI generation; answers `data.job_id` (QUI-1020). */
  readonly activateUrl = `${this.apiUrl}/activate`;

  /** Status endpoint of the `crm-landing` queue, for `AiScanJobService`. */
  generationStatusUrl(jobId: string): string {
    return `${this.apiUrl}/generation/${jobId}`;
  }

  /** F6-A: real store data the landing preview shows (products, store link). */
  getPreviewContext(): Observable<CrmApiResponse<LandingPreviewContext>> {
    return this.http.get<CrmApiResponse<LandingPreviewContext>>(`${this.apiUrl}/landing/preview-context`);
  }
}
