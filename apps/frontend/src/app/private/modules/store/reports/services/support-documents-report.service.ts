import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  SupportDocumentsListResponse,
  SupportDocumentsReportQuery,
  SupportDocumentsSummary,
} from '../interfaces/support-documents-report.interface';

interface DataEnvelope<T> {
  success?: boolean;
  data: T;
}

/**
 * Cliente HTTP del reporte de documentos soporte
 * (`/store/analytics/support-documents`). Lista, totales y XLSX comparten los
 * mismos parámetros, así que pantalla y archivo leen la misma consulta.
 * Sin caché: son datos vivos con scope de tienda.
 */
@Injectable({ providedIn: 'root' })
export class SupportDocumentsReportService {
  private readonly http = inject(HttpClient);

  private url(endpoint = ''): string {
    const base = `${environment.apiUrl}/store/analytics/support-documents`;
    return endpoint ? `${base}/${endpoint}` : base;
  }

  /** Arrays -> CSV; vacíos, `null`, `undefined` y '' se omiten. */
  buildParams(query: SupportDocumentsReportQuery): HttpParams {
    let params = new HttpParams();
    const set = (key: string, value: string | number | undefined): void => {
      if (value === undefined || value === null || value === '') return;
      params = params.set(key, String(value));
    };

    set('date_preset', query.date_preset);
    set('date_from', query.date_from);
    set('date_to', query.date_to);
    if (query.status?.length) set('status', query.status.join(','));
    if (query.dian_status?.length) {
      set('dian_status', query.dian_status.join(','));
    }
    if (query.invoice_type?.length) {
      set('invoice_type', query.invoice_type.join(','));
    }
    set('supplier_id', query.supplier_id);
    set('page', query.page);
    set('limit', query.limit);
    set('sort_by', query.sort_by);
    set('sort_order', query.sort_order);
    return params;
  }

  getList(
    query: SupportDocumentsReportQuery,
  ): Observable<SupportDocumentsListResponse> {
    return this.http.get<SupportDocumentsListResponse>(this.url(), {
      params: this.buildParams(query),
    });
  }

  getSummary(
    query: SupportDocumentsReportQuery,
  ): Observable<SupportDocumentsSummary> {
    return this.http
      .get<DataEnvelope<SupportDocumentsSummary>>(this.url('summary'), {
        params: this.buildParams(query),
      })
      .pipe(map((res) => res.data));
  }

  /** XLSX del dataset completo: el llamador no envía `page` ni `limit`. */
  exportXlsx(query: SupportDocumentsReportQuery): Observable<Blob> {
    return this.http.get(this.url('export'), {
      params: this.buildParams(query),
      responseType: 'blob',
    });
  }
}
