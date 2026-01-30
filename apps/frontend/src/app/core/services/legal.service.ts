import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface LegalDocument {
  id: number;
  title: string;
  content?: string;
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
    return this.http
      .get<{
        success: boolean;
        data: any[];
      }>(`${this.apiUrl}/pending`)
      .pipe(
        map((response) =>
          response.data.map((item) => ({
            id: item.document_id || item.id,
            title: item.title,
            content: item.content,
            content_url: item.content_url,
            version: item.current_version || item.version,
            document_type: item.document_type,
            is_required: true,
          })),
        ),
      );
  }

  /**
   * Accept a specific legal document
   */
  acceptDocument(
    documentId: number,
    context: string = 'onboarding',
  ): Observable<AcceptanceResponse> {
    return this.http
      .post<{ success: boolean; data: any; message: string }>(
        `${this.apiUrl}/${documentId}/accept`,
        {
          accepted: true,
          context,
        },
      )
      .pipe(
        map((response) => ({
          success: response.success,
          message: response.message,
        })),
      );
  }

  /**
   * Check if there are any required acceptances pending
   */
  checkRequiredAcceptances(): Observable<{
    pending: boolean;
    documents: LegalDocument[];
  }> {
    return this.http
      .get<{
        success: boolean;
        data: { pending: boolean; documents: any[] };
      }>(`${this.apiUrl}/check-required`)
      .pipe(
        map((response) => ({
          pending: response.data.pending,
          documents: response.data.documents.map((item) => ({
            id: item.document_id || item.id,
            title: item.title,
            content: item.content,
            version: item.version,
            document_type: item.document_type,
            is_required: item.is_required,
          })),
        })),
      );
  }
}
