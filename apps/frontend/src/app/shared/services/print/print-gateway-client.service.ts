import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import {
  PrintFormatType,
  StorePrintFormatSummary,
  StorePrintFormatDetail,
  PrintPreviewResponse,
  RenderPrintDocumentResponse,
  PrintTemplate,
  PrintRecentDocument,
} from '../../../core/models/print-formats.model';

@Injectable({
  providedIn: 'root',
})
export class PrintGatewayClientService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/print-formats`;

  listFormats(): Observable<StorePrintFormatSummary[]> {
    return this.http
      .get<{ success: boolean; data: StorePrintFormatSummary[] }>(this.baseUrl)
      .pipe(map((res) => res.data));
  }

  getFormatDetail(formatType: PrintFormatType): Observable<StorePrintFormatDetail> {
    return this.http
      .get<{ success: boolean; data: StorePrintFormatDetail }>(
        `${this.baseUrl}/${formatType}`,
      )
      .pipe(map((res) => res.data));
  }

  updateFormat(
    formatType: PrintFormatType,
    dto: {
      is_active?: boolean;
      gateway_enabled?: boolean;
      template_id?: number | null;
      overrides?: Record<string, any>;
    },
  ): Observable<StorePrintFormatDetail> {
    return this.http
      .put<{ success: boolean; data: StorePrintFormatDetail }>(
        `${this.baseUrl}/${formatType}`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  resetFormat(formatType: PrintFormatType): Observable<{ success: boolean; message: string }> {
    return this.http
      .delete<{ success: boolean; data: { success: boolean; message: string } }>(
        `${this.baseUrl}/${formatType}`,
      )
      .pipe(map((res) => res.data));
  }

  /**
   * [print-editor-dsk P3.3] — Recent documents picker.
   * Returns up to `limit` most recent real documents for the format so the
   * merchant can preview the layout against real data instead of fabricated
   * sample data. Backed by `GET /store/print-formats/:formatType/documents`.
   */
  getRecentDocuments(
    formatType: PrintFormatType,
    limit: number = 20,
  ): Observable<PrintRecentDocument[]> {
    const params = new HttpParams().set('limit', String(limit));
    return this.http
      .get<{ success: boolean; data: PrintRecentDocument[] }>(
        `${this.baseUrl}/${formatType}/documents`,
        { params },
      )
      .pipe(map((res) => res.data));
  }

  previewFormat(
    formatType: PrintFormatType,
    overrides?: Record<string, any>,
    sampleDocumentId?: number,
    renderMode?: 'dummy' | 'tokenized' | 'real',
  ): Observable<PrintPreviewResponse> {
    return this.http
      .post<{ success: boolean; data: PrintPreviewResponse }>(
        `${this.baseUrl}/${formatType}/preview`,
        {
          overrides,
          sample_document_id: sampleDocumentId,
          render_mode: renderMode,
        },
      )
      .pipe(map((res) => res.data));
  }

  activateGateway(formatType: PrintFormatType): Observable<{ format_type: PrintFormatType; gateway_enabled: boolean }> {
    return this.http
      .post<{ success: boolean; data: { format_type: PrintFormatType; gateway_enabled: boolean } }>(
        `${this.baseUrl}/${formatType}/activate`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  deactivateGateway(formatType: PrintFormatType): Observable<{ format_type: PrintFormatType; gateway_enabled: boolean }> {
    return this.http
      .post<{ success: boolean; data: { format_type: PrintFormatType; gateway_enabled: boolean } }>(
        `${this.baseUrl}/${formatType}/deactivate`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  renderDocument(
    formatType: PrintFormatType,
    documentId: number | string,
    engine: 'html' | 'pdf' = 'html',
  ): Observable<RenderPrintDocumentResponse> {
    return this.http
      .post<{ success: boolean; data: RenderPrintDocumentResponse }>(
        `${this.baseUrl}/render`,
        { format_type: formatType, document_id: documentId, engine },
      )
      .pipe(map((res) => res.data));
  }

  // ============================================
  // ORGANIZATIONAL TEMPLATE LIBRARY
  // ============================================

  listLibraryTemplates(formatType?: PrintFormatType): Observable<PrintTemplate[]> {
    let params = new HttpParams();
    if (formatType) {
      params = params.set('formatType', formatType);
    }
    return this.http
      .get<{ success: boolean; data: PrintTemplate[] }>(
        `${this.baseUrl}/library`,
        { params },
      )
      .pipe(map((res) => res.data));
  }

  createLibraryTemplate(dto: {
    format_type: PrintFormatType;
    name: string;
    description?: string;
    definition: Record<string, any>;
    is_shared?: boolean;
  }): Observable<PrintTemplate> {
    return this.http
      .post<{ success: boolean; data: PrintTemplate }>(
        `${this.baseUrl}/library`,
        dto,
      )
      .pipe(map((res) => res.data));
  }

  cloneLibraryTemplate(templateId: number): Observable<StorePrintFormatDetail> {
    return this.http
      .post<{ success: boolean; data: StorePrintFormatDetail }>(
        `${this.baseUrl}/library/${templateId}/clone`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  updateTemplateShare(templateId: number, isShared: boolean): Observable<PrintTemplate> {
    return this.http
      .put<{ success: boolean; data: PrintTemplate }>(
        `${this.baseUrl}/library/${templateId}/share`,
        { is_shared: isShared },
      )
      .pipe(map((res) => res.data));
  }
}
