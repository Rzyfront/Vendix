import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/workflow.interfaces';
import {
  InboundHookPatch,
  InboundHookState,
  InboundHookWithSecret,
  MailboxState,
} from './workflow-inbound.interfaces';

/** Typed client of `store/workflows/definitions/:id/{inbound-hook,mailbox}` (`store:workflows:design`). */
@Injectable({ providedIn: 'root' })
export class WorkflowInboundApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows/definitions`;

  hook(definitionId: number): Observable<InboundHookState | null> {
    return this.http
      .get<ApiResponse<InboundHookState | null>>(`${this.base}/${definitionId}/inbound-hook`)
      .pipe(map((res) => res.data ?? null));
  }

  activateHook(definitionId: number): Observable<InboundHookWithSecret> {
    return this.http
      .post<ApiResponse<InboundHookWithSecret>>(`${this.base}/${definitionId}/inbound-hook`, {})
      .pipe(map((res) => res.data));
  }

  rotateHook(definitionId: number): Observable<InboundHookWithSecret> {
    return this.http
      .post<ApiResponse<InboundHookWithSecret>>(`${this.base}/${definitionId}/inbound-hook/rotate`, {})
      .pipe(map((res) => res.data));
  }

  updateHook(definitionId: number, patch: InboundHookPatch): Observable<InboundHookState> {
    return this.http
      .patch<ApiResponse<InboundHookState>>(`${this.base}/${definitionId}/inbound-hook`, patch)
      .pipe(map((res) => res.data));
  }

  mailbox(definitionId: number): Observable<MailboxState | null> {
    return this.http
      .get<ApiResponse<MailboxState | null>>(`${this.base}/${definitionId}/mailbox`)
      .pipe(map((res) => res.data ?? null));
  }

  activateMailbox(definitionId: number): Observable<MailboxState> {
    return this.http
      .post<ApiResponse<MailboxState>>(`${this.base}/${definitionId}/mailbox`, {})
      .pipe(map((res) => res.data));
  }

  updateMailbox(definitionId: number, isActive: boolean): Observable<MailboxState> {
    return this.http
      .patch<ApiResponse<MailboxState>>(`${this.base}/${definitionId}/mailbox`, { is_active: isActive })
      .pipe(map((res) => res.data));
  }
}
