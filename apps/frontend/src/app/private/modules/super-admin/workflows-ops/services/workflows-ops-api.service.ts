import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  WorkflowOpsAlert,
  WorkflowOpsAlertsPage,
  WorkflowOpsMetrics,
} from '../interfaces/workflows-ops.interface';

interface Envelope<T> {
  data: T;
}

interface PaginatedEnvelope<T> extends Envelope<T[]> {
  meta?: { total?: number; page?: number; limit?: number; totalPages?: number };
}

/** Platform-wide Flujos operation figures (SUPER_ADMIN only on the server). */
@Injectable({ providedIn: 'root' })
export class WorkflowsOpsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/superadmin/workflows-ops`;

  getMetrics(): Observable<WorkflowOpsMetrics> {
    return this.http
      .get<Envelope<WorkflowOpsMetrics>>(`${this.baseUrl}/metrics`)
      .pipe(map((r) => r.data));
  }

  getAlerts(page = 1, limit = 10): Observable<WorkflowOpsAlertsPage> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http
      .get<PaginatedEnvelope<WorkflowOpsAlert>>(`${this.baseUrl}/alerts`, { params })
      .pipe(
        map((r) => ({
          alerts: r.data ?? [],
          total: r.meta?.total ?? 0,
          page: r.meta?.page ?? page,
          limit: r.meta?.limit ?? limit,
          totalPages: r.meta?.totalPages ?? 1,
        })),
      );
  }
}
