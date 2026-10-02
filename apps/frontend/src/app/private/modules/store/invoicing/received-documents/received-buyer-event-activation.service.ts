import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiEnvelope, ReceivedDocumentsScope } from './received-documents.interface';
import type { BuyerEventOptionsView, BuyerEventReadinessView, BuyerEventActivationStatusView, RequestBuyerEventActivationInput } from './received-buyer-event-activation.interface';

@Injectable({ providedIn: 'root' })
export class ReceivedBuyerEventActivationService {
  private readonly http = inject(HttpClient);
  private base(scope: ReceivedDocumentsScope): string {
    return `${environment.apiUrl}/${scope}/invoicing/received-documents/buyer-event-enablement`;
  }
  private params(scope: ReceivedDocumentsScope, storeId?: number, paging?: { page: number; limit: number }): HttpParams {
    let params = new HttpParams();
    if (scope === 'organization' && storeId) params = params.set('store_id', storeId);
    if (paging) params = params.set('page', paging.page).set('limit', paging.limit);
    return params;
  }
  getStatus(scope: ReceivedDocumentsScope, storeId?: number): Observable<ApiEnvelope<BuyerEventActivationStatusView>> {
    return this.http.get<ApiEnvelope<BuyerEventActivationStatusView>>(this.base(scope), { params: this.params(scope, storeId) });
  }
  getReadiness(scope: ReceivedDocumentsScope, code: string, storeId?: number): Observable<ApiEnvelope<BuyerEventReadinessView>> {
    return this.http.get<ApiEnvelope<BuyerEventReadinessView>>(`${this.base(scope)}/readiness/${code}`, { params: this.params(scope, storeId) });
  }
  getOptions(scope: ReceivedDocumentsScope, storeId: number | undefined, page: number, limit = 25): Observable<ApiEnvelope<BuyerEventOptionsView>> {
    return this.http.get<ApiEnvelope<BuyerEventOptionsView>>(`${this.base(scope)}/options`, { params: this.params(scope, storeId, { page, limit }) });
  }
  request(scope: ReceivedDocumentsScope, storeId: number | undefined, input: RequestBuyerEventActivationInput): Observable<ApiEnvelope<unknown>> {
    return this.http.post<ApiEnvelope<unknown>>(`${this.base(scope)}/request`, input, { params: this.params(scope, storeId) });
  }
}
