import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/workflow.interfaces';
import { PublicLinkStatus } from '../interfaces/workflow-ops.interfaces';

export type WorkflowGateStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface WorkflowLinkGate {
  id: number;
  operation: string;
  operation_label: string;
  status: WorkflowGateStatus;
  reason: string | null;
  amount: string | null;
  created_at: string;
  resolved_at: string | null;
  instance: { id: number; reference: string; status: string; stage_name: string | null } | null;
}

export interface WorkflowLinkInstance {
  id: number;
  reference: string;
  status: string;
  stage_name: string | null;
  definition_name: string;
}

export interface WorkflowLinks {
  pending: boolean;
  gates: WorkflowLinkGate[];
  instances: WorkflowLinkInstance[];
}

/** Settings of the active public link of a flow (P3.4). */
export type PublicLinkSettingsStatus = PublicLinkStatus & { captcha_required: boolean };

export interface PublicLinkSettingsInput {
  captcha_required?: boolean;
  /** ISO date-time, or `null` to clear the expiry. */
  expires_at?: string | null;
}

export type TrackingLinkState = 'active' | 'revoked' | 'expired';

/** Tracking link of the external requester of one request (never carries the token). */
export interface TrackingLinkRow {
  id: number;
  contact_name: string | null;
  contact_email: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  state: TrackingLinkState;
}

/** Requests and approval gates linked to a Vendix record (`/store/workflow-links`). */
@Injectable({ providedIn: 'root' })
export class WorkflowLinksApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflow-links`;

  getLinks(entityType: string, entityId: number | string): Observable<WorkflowLinks> {
    const params = new HttpParams()
      .set('entity_type', entityType)
      .set('entity_id', String(entityId));
    return this.http
      .get<ApiResponse<WorkflowLinks>>(this.base, { params })
      .pipe(map((res) => res.data));
  }

  private readonly workflowsBase = `${environment.apiUrl}/store/workflows`;

  /** Expiry and captcha of the active public link of a flow. */
  updatePublicLinkSettings(
    definitionId: number,
    body: PublicLinkSettingsInput,
  ): Observable<PublicLinkSettingsStatus> {
    return this.http
      .patch<ApiResponse<PublicLinkSettingsStatus>>(
        `${this.workflowsBase}/definitions/${definitionId}/public-link`,
        body,
      )
      .pipe(map((res) => res.data));
  }

  listTrackingLinks(instanceId: number): Observable<TrackingLinkRow[]> {
    return this.http
      .get<ApiResponse<TrackingLinkRow[]>>(
        `${this.workflowsBase}/instances/${instanceId}/tracking-links`,
      )
      .pipe(map((res) => res.data));
  }

  revokeTrackingLink(instanceId: number, linkId: number): Observable<unknown> {
    return this.http.post(
      `${this.workflowsBase}/instances/${instanceId}/tracking-links/${linkId}/revoke`,
      {},
    );
  }
}
