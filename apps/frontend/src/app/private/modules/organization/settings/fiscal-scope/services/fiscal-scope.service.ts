import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';

export type FiscalScopeValue = 'STORE' | 'ORGANIZATION';
export type OperatingScopeValue = 'STORE' | 'ORGANIZATION';
export type FiscalScopeDirection = 'NOOP' | 'UP' | 'DOWN';

export interface FiscalScopeAuditLogEntry {
  id: number;
  previous_value: FiscalScopeValue | null;
  new_value: FiscalScopeValue;
  changed_by_user_id: number | null;
  changed_at: string;
  reason: string | null;
  blocker_snapshot?: unknown;
}

export interface FiscalScopeCurrentState {
  current: FiscalScopeValue;
  operating_scope: OperatingScopeValue;
  account_type: string | null;
  audit_log_recent: FiscalScopeAuditLogEntry[];
  editable: boolean;
  invalid_combination?: boolean;
}

export interface FiscalScopeBlocker {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface FiscalScopePreview {
  organization_id: number;
  current_fiscal_scope: FiscalScopeValue;
  target_fiscal_scope: FiscalScopeValue;
  current_operating_scope: OperatingScopeValue;
  direction: FiscalScopeDirection;
  can_apply: boolean;
  warnings: string[];
  blockers: FiscalScopeBlocker[];
}

export interface FiscalScopeApplyResult {
  organization_id: number;
  previous_fiscal_scope: FiscalScopeValue;
  new_fiscal_scope: FiscalScopeValue;
  audit_log_id: number;
  applied_at: string;
  forced?: boolean;
}

export interface ApplyFiscalScopeDto {
  target_scope: FiscalScopeValue;
  reason?: string;
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FiscalScopeWizardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/organization/settings/fiscal-scope`;

  private readonly _state = signal<FiscalScopeCurrentState | null>(null);
  readonly state = this._state.asReadonly();

  getCurrent(): Observable<FiscalScopeCurrentState> {
    return this.http
      .get<FiscalScopeCurrentState>(this.baseUrl)
      .pipe(tap((value) => this._state.set(value)));
  }

  preview(
    target_scope: FiscalScopeValue,
    reason?: string,
  ): Observable<FiscalScopePreview> {
    return this.http.post<FiscalScopePreview>(`${this.baseUrl}/preview`, {
      target_scope,
      reason: reason?.trim() || undefined,
    });
  }

  apply(
    target_scope: FiscalScopeValue,
    reason?: string,
    force = false,
  ): Observable<FiscalScopeApplyResult> {
    const body: ApplyFiscalScopeDto = {
      target_scope,
      reason: reason?.trim() || undefined,
    };
    if (force === true) body.force = true;
    return this.http.post<FiscalScopeApplyResult>(`${this.baseUrl}/apply`, body);
  }
}
