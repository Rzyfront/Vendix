import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  CrmBoard,
  CrmBoardQuery,
  CrmNote,
  CrmOpportunity,
  CrmPipeline,
  CrmTag,
  CrmTask,
  CrmTaskStats,
  CrmTasksPage,
  CrmTasksQuery,
  CrmTasksToday,
  CrmTimelinePage,
  CrmTimelineType,
  CustomerCrmProfile,
  SaveCrmOpportunity,
  SaveCrmTask,
  UpdateCustomerCrmProfile,
} from './crm.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

/** HTTP client of the store CRM: customer 360, tags, tasks and pipeline. */
@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/customers`;

  // ── Customer 360 ──────────────────────────────────────────
  profile(customerId: number): Observable<CustomerCrmProfile> {
    return this.http
      .get<ApiResponse<CustomerCrmProfile>>(`${this.base}/${customerId}/crm/profile`)
      .pipe(map((r) => r.data));
  }

  updateProfile(
    customerId: number,
    body: UpdateCustomerCrmProfile,
  ): Observable<CustomerCrmProfile> {
    return this.http
      .patch<ApiResponse<CustomerCrmProfile>>(
        `${this.base}/${customerId}/crm/profile`,
        body,
      )
      .pipe(map((r) => r.data));
  }

  timeline(
    customerId: number,
    query: { types?: CrmTimelineType[]; before?: string | null; limit?: number },
  ): Observable<CrmTimelinePage> {
    const params = toParams({
      types: query.types?.length ? query.types.join(',') : undefined,
      before: query.before ?? undefined,
      limit: query.limit,
    });
    return this.http
      .get<ApiResponse<CrmTimelinePage>>(`${this.base}/${customerId}/crm/timeline`, {
        params,
      })
      .pipe(map((r) => r.data));
  }

  setTags(customerId: number, tagIds: number[]): Observable<CrmTag[]> {
    return this.http
      .put<ApiResponse<CrmTag[]>>(`${this.base}/${customerId}/crm/tags`, {
        tag_ids: tagIds,
      })
      .pipe(map((r) => r.data));
  }

  notes(customerId: number): Observable<CrmNote[]> {
    return this.http
      .get<ApiResponse<CrmNote[]>>(`${this.base}/${customerId}/crm/notes`, {
        params: toParams({ limit: 50 }),
      })
      .pipe(map((r) => r.data));
  }

  createNote(
    customerId: number,
    body: { body: string; is_pinned?: boolean },
  ): Observable<CrmNote> {
    return this.http
      .post<ApiResponse<CrmNote>>(`${this.base}/${customerId}/crm/notes`, body)
      .pipe(map((r) => r.data));
  }

  updateNote(
    customerId: number,
    noteId: number,
    body: { body?: string; is_pinned?: boolean },
  ): Observable<CrmNote> {
    return this.http
      .patch<ApiResponse<CrmNote>>(
        `${this.base}/${customerId}/crm/notes/${noteId}`,
        body,
      )
      .pipe(map((r) => r.data));
  }

  // ── Tags ──────────────────────────────────────────────────
  tags(): Observable<CrmTag[]> {
    return this.http
      .get<ApiResponse<CrmTag[]>>(`${this.base}/crm/tags`)
      .pipe(map((r) => r.data));
  }

  createTag(body: { name: string; color?: string | null }): Observable<CrmTag> {
    return this.http
      .post<ApiResponse<CrmTag>>(`${this.base}/crm/tags`, body)
      .pipe(map((r) => r.data));
  }

  // ── Tasks ─────────────────────────────────────────────────
  tasks(query: CrmTasksQuery): Observable<CrmTasksPage> {
    return this.http
      .get<ApiResponse<CrmTask[]>>(`${this.base}/crm/tasks`, {
        params: toParams(query),
      })
      .pipe(
        map((r) => {
          const meta = (r.meta ?? {}) as { total?: number; page?: number; totalPages?: number };
          return {
            data: r.data,
            total: meta.total ?? r.data.length,
            page: meta.page ?? 1,
            totalPages: meta.totalPages ?? 1,
          };
        }),
      );
  }

  tasksToday(): Observable<CrmTasksToday> {
    return this.http
      .get<ApiResponse<CrmTasksToday>>(`${this.base}/crm/tasks/today`)
      .pipe(map((r) => r.data));
  }

  taskStats(): Observable<CrmTaskStats> {
    return this.http
      .get<ApiResponse<CrmTaskStats>>(`${this.base}/crm/tasks/stats`)
      .pipe(map((r) => r.data));
  }

  createTask(body: SaveCrmTask): Observable<CrmTask> {
    return this.http
      .post<ApiResponse<CrmTask>>(`${this.base}/crm/tasks`, body)
      .pipe(map((r) => r.data));
  }

  updateTask(id: number, body: SaveCrmTask): Observable<CrmTask> {
    return this.http
      .patch<ApiResponse<CrmTask>>(`${this.base}/crm/tasks/${id}`, body)
      .pipe(map((r) => r.data));
  }

  completeTask(id: number): Observable<CrmTask> {
    return this.http
      .post<ApiResponse<CrmTask>>(`${this.base}/crm/tasks/${id}/complete`, {})
      .pipe(map((r) => r.data));
  }

  reopenTask(id: number): Observable<CrmTask> {
    return this.http
      .post<ApiResponse<CrmTask>>(`${this.base}/crm/tasks/${id}/reopen`, {})
      .pipe(map((r) => r.data));
  }

  /** Quotations of one customer, to link an opportunity (`quotations:read`). */
  customerQuotations(
    customerId: number,
  ): Observable<{ id: number; quotation_number: string; status: string; grand_total: string }[]> {
    return this.http
      .get<
        ApiResponse<{
          data: { id: number; quotation_number: string; status: string; grand_total: string }[];
        }>
      >(`${environment.apiUrl}/store/quotations`, {
        params: toParams({ customer_id: customerId, limit: 50 }),
      })
      .pipe(map((r) => r.data?.data ?? []));
  }

  // ── Pipeline ──────────────────────────────────────────────
  pipelines(): Observable<CrmPipeline[]> {
    return this.http
      .get<ApiResponse<CrmPipeline[]>>(`${this.base}/crm/pipelines`)
      .pipe(map((r) => r.data));
  }

  board(query: CrmBoardQuery): Observable<CrmBoard> {
    return this.http
      .get<ApiResponse<CrmBoard>>(`${this.base}/crm/opportunities`, {
        params: toParams(query),
      })
      .pipe(map((r) => r.data));
  }

  createOpportunity(body: SaveCrmOpportunity): Observable<CrmOpportunity> {
    return this.http
      .post<ApiResponse<CrmOpportunity>>(`${this.base}/crm/opportunities`, body)
      .pipe(map((r) => r.data));
  }

  updateOpportunity(id: number, body: SaveCrmOpportunity): Observable<CrmOpportunity> {
    return this.http
      .patch<ApiResponse<CrmOpportunity>>(`${this.base}/crm/opportunities/${id}`, body)
      .pipe(map((r) => r.data));
  }

  moveOpportunity(
    id: number,
    body: { stage_id: number; sort_order?: number; lost_reason?: string },
  ): Observable<CrmOpportunity> {
    return this.http
      .post<ApiResponse<CrmOpportunity>>(
        `${this.base}/crm/opportunities/${id}/move`,
        body,
      )
      .pipe(map((r) => r.data));
  }

  winOpportunity(id: number): Observable<CrmOpportunity> {
    return this.http
      .post<ApiResponse<CrmOpportunity>>(`${this.base}/crm/opportunities/${id}/win`, {})
      .pipe(map((r) => r.data));
  }

  loseOpportunity(id: number, lostReason: string): Observable<CrmOpportunity> {
    return this.http
      .post<ApiResponse<CrmOpportunity>>(`${this.base}/crm/opportunities/${id}/lose`, {
        lost_reason: lostReason,
      })
      .pipe(map((r) => r.data));
  }
}
