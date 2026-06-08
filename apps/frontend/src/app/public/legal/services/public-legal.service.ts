import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

/**
 * Legal document types served by the public legal endpoint.
 * Mirrors the backend `:documentType` path param contract.
 */
export type LegalDocumentType =
  | 'TERMS_OF_SERVICE'
  | 'PRIVACY_POLICY'
  | 'COOKIES_POLICY';

/**
 * Active legal document returned by GET /api/public/legal/:documentType.
 * `content` is HTML/markdown rendered client-side with marked + DomSanitizer.
 */
export interface LegalDocument {
  id: number;
  document_type: string;
  title: string;
  version: string;
  content: string;
  effective_date: string;
  description: string;
}

interface LegalDocumentResponse {
  success: boolean;
  data: LegalDocument;
  message?: string;
}

/**
 * Public (no-auth, no-tenant) access to the active version of a legal document.
 *
 * The backend responds 404 when there is no active version; callers should map
 * that to a "documento no disponible" empty state.
 */
@Injectable({ providedIn: 'root' })
export class PublicLegalService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/public/legal`;

  getDocument(documentType: LegalDocumentType): Observable<LegalDocument> {
    return this.http
      .get<LegalDocumentResponse>(`${this.apiUrl}/${documentType}`)
      .pipe(map((response) => response.data));
  }
}
