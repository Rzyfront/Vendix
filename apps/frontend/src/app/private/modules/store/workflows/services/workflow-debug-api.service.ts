import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ActionTestBody,
  ActionTestResult,
  InstanceDebug,
} from '../interfaces/workflow-debug.interfaces';
import { ApiResponse } from '../interfaces/workflow.interfaces';

/** Debugger of instances and "Probar esta acción" (P5.2). */
@Injectable({ providedIn: 'root' })
export class WorkflowDebugApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows`;

  /** `GET instances/:id/debug`: events with the variables captured at each one. */
  instanceDebug(instanceId: number): Observable<InstanceDebug> {
    return this.http
      .get<ApiResponse<InstanceDebug>>(`${this.base}/instances/${instanceId}/debug`)
      .pipe(map((res) => res.data));
  }

  /** `POST actions/test`: real for HTTP and connectors, a preview for the rest. */
  testAction(body: ActionTestBody): Observable<ActionTestResult> {
    return this.http
      .post<ApiResponse<ActionTestResult>>(`${this.base}/actions/test`, body)
      .pipe(map((res) => res.data));
  }
}
