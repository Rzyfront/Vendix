import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface LegalDocument {
  id: number;
  title: string;
  content_url?: string;
  version: string;
  document_type:
    | 'TERMS_OF_SERVICE'
    | 'PRIVACY_POLICY'
    | 'DATA_PROCESSING_AGREEMENT'
    | 'COOKIES_POLICY'
    | 'ACCEPTABLE_USE_POLICY'
    | 'SLA';
  is_required: boolean;
}

export interface AcceptanceResponse {
  success: boolean;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LegalService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth/legal-acceptances`;

  /**
   * Get all pending terms that the user needs to accept
   */
  getPendingTerms(): Observable<LegalDocument[]> {
    return this.http.get<LegalDocument[]>(`${this.apiUrl}/pending`);
  }

  /**
   * Accept a specific legal document
   */
  acceptDocument(
    documentId: number,
    context: string = 'onboarding',
  ): Observable<AcceptanceResponse> {
    return this.http.post<AcceptanceResponse>(
      `${this.apiUrl}/${documentId}/accept`,
      {
        accepted: true,
        context,
      },
    );
  }

  /**
   * Check if there are any required acceptances pending
   */
  checkRequiredAcceptances(): Observable<{
    pending: boolean;
    documents: LegalDocument[];
  }> {
    return this.http.get<{ pending: boolean; documents: LegalDocument[] }>(
      `${this.apiUrl}/check-required`,
    );
  }
}
