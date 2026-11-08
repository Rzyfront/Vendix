import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

interface DataResponse<T> {
  data: T;
}

/** The four plan limits of Flujos (P7.1). */
export type WorkflowUsageMetricKey =
  | 'monthly_instances'
  | 'monthly_http_calls'
  | 'storage_bytes'
  | 'monthly_ai_tokens';

/**
 * `ok` < 80 %, `warning` from 80 %, `blocked` at 100 %, `unlimited` when the
 * plan sets no cap, `unavailable` when the plan does not include the feature.
 */
export type WorkflowUsageState = 'ok' | 'warning' | 'blocked' | 'unlimited' | 'unavailable';

export interface WorkflowUsageMetric {
  key: WorkflowUsageMetricKey;
  used: number;
  /** `null` = unlimited or unavailable. */
  cap: number | null;
  /** 0–100, `null` when there is no cap. */
  percent: number | null;
  state: WorkflowUsageState;
}

export interface WorkflowUsageSnapshot {
  /** Current UTC month, `YYYY-MM`. */
  period: string;
  metrics: WorkflowUsageMetric[];
}

/** Client of `GET store/workflows/usage` (plan usage of Flujos, P7.1). */
@Injectable({ providedIn: 'root' })
export class WorkflowLimitsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows`;

  usage(): Observable<WorkflowUsageSnapshot> {
    return this.http
      .get<DataResponse<WorkflowUsageSnapshot>>(`${this.base}/usage`)
      .pipe(map((res) => res.data));
  }
}
