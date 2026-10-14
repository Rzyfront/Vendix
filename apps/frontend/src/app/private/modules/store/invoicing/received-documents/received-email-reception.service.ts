import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiEnvelope } from './received-documents.interface';
import type {
  ActivateReceivedEmailInput, DiscardReceivedEmailInput, ReceivedEmailConfiguration, ReceivedEmailGmailCode,
  ReceivedEmailMessage, ReceivedEmailMessagesPage, ReceivedEmailMessagesQuery, ReceivedEmailRetry,
  ReceivedEmailStatus, RotateReceivedEmailInput, UpdateReceivedEmailInput,
} from './received-email-reception.interface';
import { projectReceivedEmailMessage } from './received-email-reception-projection.util';

/** Stateless, cold/cancellable HTTP. No tenant data or Gmail codes are cached here. */
@Injectable({ providedIn: 'root' })
export class ReceivedEmailReceptionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/invoicing/received-documents/email-reception`;

  status(): Observable<ReceivedEmailStatus> {
    return this.http.get<ApiEnvelope<ReceivedEmailStatus>>(`${this.base}/status`).pipe(map((response) => response.data));
  }
  configuration(): Observable<ReceivedEmailConfiguration> {
    return this.http.get<ApiEnvelope<ReceivedEmailConfiguration>>(`${this.base}/configuration`).pipe(map((response) => response.data));
  }
  gmailCode(): Observable<ReceivedEmailGmailCode> {
    return this.http.get<ApiEnvelope<ReceivedEmailGmailCode>>(`${this.base}/gmail-code`).pipe(map((response) => response.data));
  }
  activate(input: ActivateReceivedEmailInput): Observable<ReceivedEmailConfiguration> {
    return this.http.post<ApiEnvelope<ReceivedEmailConfiguration>>(`${this.base}/activate`, input).pipe(map((response) => response.data));
  }
  update(input: UpdateReceivedEmailInput): Observable<ReceivedEmailConfiguration> {
    return this.http.patch<ApiEnvelope<ReceivedEmailConfiguration>>(`${this.base}/configuration`, input).pipe(map((response) => response.data));
  }
  rotateAddress(input: RotateReceivedEmailInput): Observable<ReceivedEmailConfiguration> {
    return this.http.post<ApiEnvelope<ReceivedEmailConfiguration>>(`${this.base}/rotate-address`, input).pipe(map((response) => response.data));
  }
  messages(query: ReceivedEmailMessagesQuery = {}): Observable<ReceivedEmailMessagesPage> {
    const params = new HttpParams().set('page', String(query.page ?? 1)).set('limit', String(query.limit ?? 25))
      .set('view', query.view ?? 'history').set('archived', String(query.archived ?? false));
    return this.http.get<ReceivedEmailMessagesPage>(`${this.base}/messages`, { params }).pipe(map((response) => ({
      data: response.data.map(projectReceivedEmailMessage), meta: response.meta,
    })));
  }
  message(id: number): Observable<ReceivedEmailMessage> {
    return this.http.get<ApiEnvelope<ReceivedEmailMessage>>(`${this.base}/messages/${id}`).pipe(map((response) => projectReceivedEmailMessage(response.data)));
  }
  discard(id: number, input: DiscardReceivedEmailInput): Observable<ReceivedEmailMessage> {
    return this.http.post<ApiEnvelope<ReceivedEmailMessage>>(`${this.base}/messages/${id}/discard`, input).pipe(map((response) => projectReceivedEmailMessage(response.data)));
  }
  retry(id: number, expectedVersion: number): Observable<ReceivedEmailRetry> {
    return this.http.post<ApiEnvelope<ReceivedEmailRetry>>(`${this.base}/messages/${id}/retry`, { expected_version: expectedVersion }).pipe(map((response) => response.data));
  }
}
