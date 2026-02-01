import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  LegalDocument,
  CreateSystemDocumentDto,
  UpdateSystemDocumentDto,
  DocumentStats,
} from '../interfaces/legal-document.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LegalDocumentsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/legal-documents`;

  getSystemDocuments(filters?: {
    document_type?: string;
  }): Observable<LegalDocument[]> {
    let params = new HttpParams();
    if (filters?.document_type) {
      params = params.set('document_type', filters.document_type);
    }
    return this.http
      .get<ApiResponse<LegalDocument[]>>(this.apiUrl, { params })
      .pipe(map((res) => res.data));
  }

  getSystemDocument(id: number): Observable<LegalDocument> {
    return this.http
      .get<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}`)
      .pipe(map((res) => res.data));
  }

  createSystemDocument(
    dto: CreateSystemDocumentDto,
  ): Observable<LegalDocument> {
    return this.http
      .post<ApiResponse<LegalDocument>>(this.apiUrl, dto)
      .pipe(map((res) => res.data));
  }

  updateSystemDocument(
    id: number,
    dto: UpdateSystemDocumentDto,
  ): Observable<LegalDocument> {
    return this.http
      .patch<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  activateDocument(id: number): Observable<LegalDocument> {
    return this.http
      .patch<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}/activate`, {})
      .pipe(map((res) => res.data));
  }

  deactivateDocument(id: number): Observable<LegalDocument> {
    return this.http
      .patch<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}/deactivate`, {})
      .pipe(map((res) => res.data));
  }

  getDocumentHistory(documentType: string): Observable<LegalDocument[]> {
    return this.http
      .get<
        ApiResponse<LegalDocument[]>
      >(`${this.apiUrl}/history/${documentType}`)
      .pipe(map((res) => res.data));
  }

  getAcceptanceStats(id: number): Observable<DocumentStats> {
    return this.http
      .get<ApiResponse<DocumentStats>>(`${this.apiUrl}/${id}/stats`)
      .pipe(map((res) => res.data));
  }
}
