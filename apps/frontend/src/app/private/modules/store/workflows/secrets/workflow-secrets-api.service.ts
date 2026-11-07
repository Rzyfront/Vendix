import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/workflow.interfaces';
import {
  CreateWorkflowSecretBody,
  UpdateWorkflowSecretBody,
  WorkflowSecretRow,
} from './workflow-secrets.interfaces';

/** Typed client of `store/workflows/secrets` (values go up, never come back). */
@Injectable({ providedIn: 'root' })
export class WorkflowSecretsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows/secrets`;

  list(): Observable<WorkflowSecretRow[]> {
    return this.http.get<ApiResponse<WorkflowSecretRow[]>>(this.base).pipe(map((res) => res.data ?? []));
  }

  create(body: CreateWorkflowSecretBody): Observable<WorkflowSecretRow> {
    return this.http.post<ApiResponse<WorkflowSecretRow>>(this.base, body).pipe(map((res) => res.data));
  }

  replace(id: number, body: UpdateWorkflowSecretBody): Observable<WorkflowSecretRow> {
    return this.http.put<ApiResponse<WorkflowSecretRow>>(`${this.base}/${id}`, body).pipe(map((res) => res.data));
  }

  remove(id: number): Observable<{ id: number }> {
    return this.http.delete<ApiResponse<{ id: number }>>(`${this.base}/${id}`).pipe(map((res) => res.data));
  }
}
