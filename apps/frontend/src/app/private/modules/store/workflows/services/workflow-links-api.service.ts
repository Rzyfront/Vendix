import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/workflow.interfaces';

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
}
