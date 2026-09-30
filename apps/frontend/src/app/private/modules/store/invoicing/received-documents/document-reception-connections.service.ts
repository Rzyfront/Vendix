import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ReceivedDocumentsScope } from './received-documents.interface';
import type {
  CreateDocumentReceptionConnectionInput,
  DocumentReceptionConnection,
  DocumentReceptionRun,
  ReceptionConnectionEnvelope,
  ReceptionConnectionPage,
  UpdateDocumentReceptionConnectionInput,
} from './document-reception-connections.interface';

const PAGE_LIMIT = 25;

@Injectable({ providedIn: 'root' })
export class DocumentReceptionConnectionsService {
  private readonly http = inject(HttpClient);

  list(scope: ReceivedDocumentsScope, page: number, storeId?: number): Observable<ReceptionConnectionPage<DocumentReceptionConnection>> {
    return this.http.get<ReceptionConnectionPage<DocumentReceptionConnection>>(`${this.base(scope)}`, {
      params: this.params(scope, storeId, page),
    });
  }

  getOne(scope: ReceivedDocumentsScope, id: number, storeId?: number): Observable<ReceptionConnectionEnvelope<DocumentReceptionConnection>> {
    return this.http.get<ReceptionConnectionEnvelope<DocumentReceptionConnection>>(`${this.base(scope)}/${id}`, {
      params: this.params(scope, storeId),
    });
  }

  listRuns(scope: ReceivedDocumentsScope, id: number, page: number, storeId?: number): Observable<ReceptionConnectionPage<DocumentReceptionRun>> {
    return this.http.get<ReceptionConnectionPage<DocumentReceptionRun>>(`${this.base(scope)}/${id}/runs`, {
      params: this.params(scope, storeId, page),
    });
  }

  create(scope: ReceivedDocumentsScope, input: CreateDocumentReceptionConnectionInput, storeId?: number): Observable<ReceptionConnectionEnvelope<DocumentReceptionConnection>> {
    return this.http.post<ReceptionConnectionEnvelope<DocumentReceptionConnection>>(this.base(scope), input, {
      params: this.params(scope, storeId),
    });
  }

  update(scope: ReceivedDocumentsScope, id: number, input: UpdateDocumentReceptionConnectionInput, storeId?: number): Observable<ReceptionConnectionEnvelope<DocumentReceptionConnection>> {
    return this.http.patch<ReceptionConnectionEnvelope<DocumentReceptionConnection>>(`${this.base(scope)}/${id}`, input, {
      params: this.params(scope, storeId),
    });
  }

  private base(scope: ReceivedDocumentsScope): string {
    return `${environment.apiUrl}/${scope}/invoicing/received-documents/connections`;
  }

  private params(scope: ReceivedDocumentsScope, storeId?: number, page?: number): HttpParams {
    let params = new HttpParams();
    if (page !== undefined) params = params.set('page', String(page)).set('limit', String(PAGE_LIMIT));
    // Store scope always derives its tenant from auth context; only organization
    // administration may choose an operational store for these connections.
    if (scope === 'organization' && Number.isSafeInteger(storeId) && (storeId ?? 0) > 0) {
      params = params.set('store_id', String(storeId));
    }
    return params;
  }
}
