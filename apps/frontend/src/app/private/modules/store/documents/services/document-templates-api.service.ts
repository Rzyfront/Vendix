import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../../workflows/interfaces/workflow.interfaces';
import {
  BasePdfBody,
  BasePdfPage,
  BlocksBody,
  IssuedDocument,
  PublishResult,
  TemplateDetail,
  TemplateKind,
  TemplateRow,
  TemplateStatus,
  TemplateVersionRow,
} from '../interfaces/document-template.interfaces';

/** Typed client of `/api/store/documents/templates` and `/api/store/documents/issued`. */
@Injectable({ providedIn: 'root' })
export class DocumentTemplatesApiService {
  private readonly http = inject(HttpClient);
  private readonly templates = `${environment.apiUrl}/store/documents/templates`;
  private readonly issued = `${environment.apiUrl}/store/documents/issued`;

  list(query: { status?: TemplateStatus; kind?: TemplateKind; search?: string } = {}): Observable<TemplateRow[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params = params.set(key, value);
    }
    return this.http.get<ApiResponse<TemplateRow[]>>(this.templates, { params }).pipe(map((r) => r.data));
  }

  create(input: { key: string; name: string; category?: string; kind: TemplateKind }): Observable<TemplateDetail> {
    return this.http.post<ApiResponse<TemplateDetail>>(this.templates, input).pipe(map((r) => r.data));
  }

  get(id: number): Observable<TemplateDetail> {
    return this.http.get<ApiResponse<TemplateDetail>>(`${this.templates}/${id}`).pipe(map((r) => r.data));
  }

  saveDraft(
    id: number,
    input: { name?: string; category?: string; body?: BlocksBody | BasePdfBody },
  ): Observable<TemplateDetail> {
    return this.http.patch<ApiResponse<TemplateDetail>>(`${this.templates}/${id}`, input).pipe(map((r) => r.data));
  }

  uploadBasePdf(id: number, file: File): Observable<TemplateDetail & { page_count: number }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http
      .post<ApiResponse<TemplateDetail & { page_count: number }>>(`${this.templates}/${id}/base-pdf`, form)
      .pipe(map((r) => r.data));
  }

  basePages(id: number): Observable<BasePdfPage[]> {
    return this.http.get<ApiResponse<BasePdfPage[]>>(`${this.templates}/${id}/base-pages`).pipe(map((r) => r.data));
  }

  /** PDF of the draft with example data and the "VISTA PREVIA" watermark. */
  preview(id: number): Observable<Blob> {
    return this.http.get(`${this.templates}/${id}/preview`, { responseType: 'blob' });
  }

  publish(id: number): Observable<PublishResult> {
    return this.http.post<ApiResponse<PublishResult>>(`${this.templates}/${id}/publish`, {}).pipe(map((r) => r.data));
  }

  versions(id: number): Observable<TemplateVersionRow[]> {
    return this.http.get<ApiResponse<TemplateVersionRow[]>>(`${this.templates}/${id}/versions`).pipe(map((r) => r.data));
  }

  archive(id: number): Observable<TemplateRow> {
    return this.http.post<ApiResponse<TemplateRow>>(`${this.templates}/${id}/archive`, {}).pipe(map((r) => r.data));
  }

  // ---- Issued documents -------------------------------------------------

  listIssued(query: { instance_id?: number; dossier_id?: number }): Observable<IssuedDocument[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params = params.set(key, String(value));
    }
    return this.http.get<ApiResponse<IssuedDocument[]>>(this.issued, { params }).pipe(map((r) => r.data));
  }

  emit(input: {
    instance_id: number;
    template_key?: string;
    requirement_key?: string;
    title?: string;
  }): Observable<IssuedDocument> {
    return this.http.post<ApiResponse<IssuedDocument>>(`${this.issued}/emit`, input).pipe(map((r) => r.data));
  }

  reissue(id: number): Observable<IssuedDocument> {
    return this.http.post<ApiResponse<IssuedDocument>>(`${this.issued}/${id}/reissue`, {}).pipe(map((r) => r.data));
  }

  voidIssued(id: number, reason: string): Observable<IssuedDocument> {
    return this.http.post<ApiResponse<IssuedDocument>>(`${this.issued}/${id}/void`, { reason }).pipe(map((r) => r.data));
  }
}
