import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';

/**
 * Operating scope wizard service. After Phase 4 of the operating-scope
 * consolidation every endpoint lives under
 * `/api/organization/settings/operating-scope` (DomainScopeGuard rejects any
 * cross-domain call).
 *
 * Endpoints consumed:
 *   - GET    /            → current state, partner flag, recent audit log
 *   - POST   /preview     → dry-run validation (blockers + warnings)
 *   - POST   /apply       → atomic migration with audit log
 */

export type OperatingScopeValue = 'STORE' | 'ORGANIZATION';
export type OperatingScopeDirection = 'NOOP' | 'UP' | 'DOWN';

export interface OperatingScopeAuditLogEntry {
  id: number;
  previous_value: OperatingScopeValue | null;
  new_value: OperatingScopeValue;
  changed_by_user_id: number | null;
  changed_at: string;
  reason: string | null;
}

export interface OperatingScopeCurrentState {
  current: OperatingScopeValue;
  is_partner: boolean;
  account_type: string | null;
  audit_log_recent: OperatingScopeAuditLogEntry[];
  editable: boolean;
}

/**
 * Server-authoritative blocker codes returned by `/preview` and (when not
 * forced) by `/apply` 409 responses. Plan P4.5 §6.5.4 defines the four
 * downgrade-specific blockers; the rest are kept for backward compatibility
 * with existing wizard flow (partner lock, accounting prerequisites, etc.).
 */
export type OperatingScopeBlockerCode =
  | 'PARTNER_LOCKED'
  | 'NOT_ENOUGH_STORES'
  | 'NO_ACTIVE_STORES'
  // ----- P4.5 server-authoritative downgrade blockers ----------------------
  | 'OPEN_POS_TO_CENTRAL'
  | 'OPEN_PURCHASE_ORDERS'
  | 'OPEN_CROSS_STORE_TRANSFERS'
  | 'STOCK_AT_CENTRAL'
  | 'ACTIVE_RESERVATIONS_AT_CENTRAL'
  | (string & {}); // tolerant fallback for any new server-side codes.

export interface OperatingScopeBlockerDetails {
  count?: number;
  remediation_link?: string | null;
  // Other details (purchase_order_ids, transfer_ids, etc.) come through
  // untyped — they are surfaced as-is in the wizard tooltip.
  [extra: string]: any;
}

export interface OperatingScopeBlocker {
  code: OperatingScopeBlockerCode;
  message: string;
  details?: OperatingScopeBlockerDetails;
}

export interface OperatingScopePreview {
  organization_id: number;
  current_scope: OperatingScopeValue;
  target_scope: OperatingScopeValue;
  is_partner: boolean;
  direction: OperatingScopeDirection;
  can_apply: boolean;
  warnings: string[];
  blockers: OperatingScopeBlocker[];
}

export interface OperatingScopeApplyResult {
  organization_id: number;
  previous_scope: OperatingScopeValue;
  new_scope: OperatingScopeValue;
  audit_log_id: number;
  applied_at: string;
  /**
   * `true` when the apply call bypassed downgrade blockers via the
   * server-authoritative `force=true` flag. Plan P4.5 §13 #3.
   */
  forced?: boolean;
}

/**
 * Payload for `POST /apply`. Mirrors the backend `ChangeOperatingScopeDto`:
 *   - `target_scope` is required.
 *   - `reason` is optional, becomes REQUIRED (≥10 chars) when `force=true`.
 *   - `force` defaults to `false`. Only meaningful on DOWN migrations.
 */
export interface ApplyOperatingScopeDto {
  target_scope: OperatingScopeValue;
  reason?: string;
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class OperatingScopeWizardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/organization/settings/operating-scope`;

  // Local signal state. Components can read it after a getCurrent() call so
  // they avoid re-fetching across navigations within the same session.
  private readonly _state = signal<OperatingScopeCurrentState | null>(null);
  readonly state = this._state.asReadonly();

  /** Fetch the current operating scope, partner flag, and recent audit log. */
  getCurrent(): Observable<OperatingScopeCurrentState> {
    return this.http
      .get<OperatingScopeCurrentState>(this.baseUrl)
      .pipe(tap((value) => this._state.set(value)));
  }

  /** Dry-run validation. Returns blockers + warnings without mutating data. */
  preview(
    target_scope: OperatingScopeValue,
    reason?: string,
  ): Observable<OperatingScopePreview> {
    return this.http.post<OperatingScopePreview>(`${this.baseUrl}/preview`, {
      target_scope,
      reason: reason?.trim() || undefined,
    });
  }

  /**
   * Apply the migration atomically. When `force=true` the backend bypasses
   * the four server-authoritative downgrade blockers and persists both the
   * override and the blocker snapshot in `audit_logs`. Plan P4.5 §13 #3.
   */
  apply(
    target_scope: OperatingScopeValue,
    reason?: string,
    force = false,
  ): Observable<OperatingScopeApplyResult> {
    const body: ApplyOperatingScopeDto = {
      target_scope,
      reason: reason?.trim() || undefined,
    };
    if (force === true) {
      body.force = true;
    }
    return this.http.post<OperatingScopeApplyResult>(
      `${this.baseUrl}/apply`,
      body,
    );
  }
}
