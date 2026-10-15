import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
export interface HolderChangeOperation {
  id: number;
  phase: string;
  run_status: string;
  original_order_id: number;
  original_invoice_id: number;
  credit_note_id?: number | null;
  new_invoice_id?: number | null;
  target_customer_id?: number | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  can_retry: boolean;
  fiscal_completed?: boolean;
  accounting_pending?: boolean;
}
export interface HolderChangeContext {
  eligible: boolean;
  reason?: string;
  operation?: HolderChangeOperation | null;
  can_remake: boolean;
  can_release: boolean;
}
export type HolderChangeCommand =
  | { kind: 'remake'; invoiceId: number; reason: string }
  | { kind: 'release'; invoiceId: number; reason: string }
  | {
      kind: 'customer';
      operationId: number;
      customer: { customer_id?: number; snapshot?: Record<string, unknown> };
    }
  | { kind: 'resume'; operationId: number };
@Injectable({ providedIn: 'root' })
export class InvoiceHolderChangeService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/invoicing`;
  context(id: number): Observable<HolderChangeContext> {
    return this.http
      .get<{
        data: HolderChangeContext;
      }>(`${this.base}/${id}/holder-change-context`)
      .pipe(map((r) => r.data));
  }
  operation(id: number): Observable<HolderChangeOperation> {
    return this.http
      .get<{
        data: HolderChangeOperation;
      }>(`${this.base}/holder-changes/${encodeURIComponent(String(id))}`)
      .pipe(map((r) => r.data));
  }
  execute(command: HolderChangeCommand): Observable<HolderChangeOperation> {
    let url: string;
    let body: unknown = {};
    if (command.kind === 'remake' || command.kind === 'release') {
      url = `${this.base}/${command.invoiceId}/${command.kind === 'release' ? 'release-order' : 'remake'}`;
      body = { reason: command.reason };
    } else {
      url = `${this.base}/holder-changes/${encodeURIComponent(String(command.operationId))}/${command.kind}`;
      if (command.kind === 'customer') body = command.customer;
    }
    return this.http
      .post<{ data: HolderChangeOperation }>(url, body)
      .pipe(map((r) => r.data));
  }
}
