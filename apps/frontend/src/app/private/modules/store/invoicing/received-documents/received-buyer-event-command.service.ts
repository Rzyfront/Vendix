import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiEnvelope, ReceivedDocumentsScope } from './received-documents.interface';
import type { BuyerEventCommandInput, BuyerEventCommandResult } from './received-buyer-event-command.interface';

@Injectable({ providedIn: 'root' })
export class ReceivedBuyerEventCommandService {
  private readonly http = inject(HttpClient);
  emit(scope: ReceivedDocumentsScope, id: number, input: BuyerEventCommandInput, storeId?: number): Observable<ApiEnvelope<BuyerEventCommandResult>> {
    let params = new HttpParams();
    if (scope === 'organization' && storeId) params = params.set('store_id', storeId);
    return this.http.post<ApiEnvelope<BuyerEventCommandResult>>(`${environment.apiUrl}/${scope}/invoicing/received-documents/${id}/buyer-events`, input, { params });
  }
}
