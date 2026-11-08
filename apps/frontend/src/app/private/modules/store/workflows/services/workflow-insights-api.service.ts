import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  WorkflowAiUsage,
  WorkflowSummariesList,
  WorkflowSummary,
} from '../interfaces/workflow-insights.interfaces';

interface DataResponse<T> {
  data: T;
}

/** Client of the AI consumption and weekly summaries of Flujos (P6). */
@Injectable({ providedIn: 'root' })
export class WorkflowInsightsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows`;

  /** Consumption of one month (`YYYY-MM`); omitted means the current month. */
  getAiUsage(month?: string): Observable<WorkflowAiUsage> {
    const params = month ? new HttpParams().set('month', month) : undefined;
    return this.http
      .get<DataResponse<WorkflowAiUsage>>(`${this.base}/ai-usage`, { params })
      .pipe(map((res) => res.data));
  }

  listSummaries(limit = 12): Observable<WorkflowSummariesList> {
    return this.http
      .get<DataResponse<WorkflowSummariesList>>(`${this.base}/insights/summaries`, {
        params: new HttpParams().set('limit', String(limit)),
      })
      .pipe(map((res) => res.data));
  }

  /** On-demand summary; the API allows one per hour per store (429 otherwise). */
  generateSummary(): Observable<WorkflowSummary> {
    return this.http
      .post<DataResponse<WorkflowSummary>>(`${this.base}/insights/summaries/generate`, {})
      .pipe(map((res) => res.data));
  }
}
