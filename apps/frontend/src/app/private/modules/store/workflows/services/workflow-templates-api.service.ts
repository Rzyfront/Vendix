import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  WorkflowTemplateActivation,
  WorkflowTemplateSummary,
} from '../interfaces/workflow-templates.interfaces';

interface ApiData<T> {
  data: T;
}

/** Typed client of `/api/store/workflows/templates` (gallery of Administration templates). */
@Injectable({ providedIn: 'root' })
export class WorkflowTemplatesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows/templates`;

  list(): Observable<WorkflowTemplateSummary[]> {
    return this.http
      .get<ApiData<WorkflowTemplateSummary[]>>(this.base)
      .pipe(map((res) => res.data));
  }

  /** Creates the flow in the store and publishes v1 in one call. */
  activate(key: string): Observable<WorkflowTemplateActivation> {
    return this.http
      .post<ApiData<WorkflowTemplateActivation>>(
        `${this.base}/${encodeURIComponent(key)}/activate`,
        {},
      )
      .pipe(map((res) => res.data));
  }
}
