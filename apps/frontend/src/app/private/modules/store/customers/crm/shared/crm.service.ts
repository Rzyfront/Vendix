import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  CompleteCrmTaskMove,
  CrmBoard,
  CrmBoardQuery,
  CrmNote,
  CrmOpenOpportunity,
  CrmOpportunity,
  CrmPerson,
  CrmPipeline,
  CrmStageTemplate,
  CrmTag,
  CrmTask,
  CrmTaskStats,
  CrmTasksPage,
  CrmTasksQuery,
  CrmTasksToday,
  CrmTimelinePage,
  CrmTimelineType,
  CustomerCrmMemberships,
  CustomerCrmProfile,
  SaveCrmOpportunity,
  SaveCrmStageTemplate,
  SaveCrmTag,
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

  // ── Segments of a customer ────────────────────────────────
  /** Segments and tags of a page of customers (at most 100 ids). */
  memberships(customerIds: number[]): Observable<CustomerCrmMemberships[]> {
    return this.http
      .get<ApiResponse<CustomerCrmMemberships[]>>(`${this.base}/crm/memberships`, {
        params: toParams({ customer_ids: customerIds.join(',') }),
      })
      .pipe(map((r) => r.data));
  }

  customerSegments(customerId: number): Observable<CustomerCrmMemberships> {
    return this.http
      .get<ApiResponse<CustomerCrmMemberships>>(`${this.base}/${customerId}/crm/segments`)
      .pipe(map((r) => r.data));
  }

  /** Adds the customer to the segment by hand. */
  addToSegment(customerId: number, segmentId: number): Observable<CustomerCrmMemberships> {
    return this.http
      .put<ApiResponse<CustomerCrmMemberships>>(
        `${this.base}/${customerId}/crm/segments/${segmentId}`,
        {},
      )
      .pipe(map((r) => r.data));
  }

  /** Removes the manual membership; a match by rules stays. */
  removeFromSegment(customerId: number, segmentId: number): Observable<CustomerCrmMemberships> {
    return this.http
      .delete<ApiResponse<CustomerCrmMemberships>>(
        `${this.base}/${customerId}/crm/segments/${segmentId}`,
      )
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

  createTag(body: SaveCrmTag & { name: string }): Observable<CrmTag> {
    return this.http
      .post<ApiResponse<CrmTag>>(`${this.base}/crm/tags`, body)
      .pipe(map((r) => r.data));
  }

  /** Renames, recolors, moves to a group and/or rewrites «cuándo se pone»; its customers keep it. */
  updateTag(id: number, body: SaveCrmTag): Observable<CrmTag> {
    return this.http
      .patch<ApiResponse<CrmTag>>(`${this.base}/crm/tags/${id}`, body)
      .pipe(map((r) => r.data));
  }

  /** Deletes a tag and its assignments; customers are never deleted. */
  deleteTag(id: number): Observable<{ id: number }> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.base}/crm/tags/${id}`)
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

  /** Counters of the same tasks the list shows for `assigned`. */
  taskStats(assigned?: CrmTasksQuery['assigned']): Observable<CrmTaskStats> {
    return this.http
      .get<ApiResponse<CrmTaskStats>>(`${this.base}/crm/tasks/stats`, {
        params: toParams({ assigned }),
      })
      .pipe(map((r) => r.data));
  }

  /**
   * Active staff of the store for the task support picker, by name. Gated by
   * the tasks permission, so a seller without POS access finds them too.
   */
  taskStaff(q: string): Observable<CrmPerson[]> {
    return this.http
      .get<ApiResponse<CrmPerson[]>>(`${this.base}/crm/tasks/staff`, {
        params: toParams({ q: q.trim() }),
      })
      .pipe(map((r) => r.data ?? []));
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

  /**
   * Marks the task done. `move` (only for a task that moves nothing by
   * itself) also moves that open opportunity of its customer to that stage.
   */
  completeTask(id: number, move?: CompleteCrmTaskMove): Observable<CrmTask> {
    return this.http
      .post<ApiResponse<CrmTask>>(`${this.base}/crm/tasks/${id}/complete`, move ?? {})
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

  /**
   * Open opportunities of one customer the viewer sees (task form).
   * `includeId`, the opportunity of the task being edited, always comes back
   * while it is open, even past the first page.
   */
  openOpportunities(customerId: number, includeId?: number): Observable<CrmOpenOpportunity[]> {
    return this.http
      .get<ApiResponse<CrmOpenOpportunity[]>>(`${this.base}/crm/opportunities/open`, {
        params: toParams({ customer_id: customerId, include_id: includeId }),
      })
      .pipe(map((r) => r.data ?? []));
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

  deleteOpportunity(id: number): Observable<{ id: number }> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.base}/crm/opportunities/${id}`)
      .pipe(map((r) => r.data));
  }

  // ── Stage templates ───────────────────────────────────────
  listStageTemplates(): Observable<CrmStageTemplate[]> {
    return this.http
      .get<ApiResponse<CrmStageTemplate[]>>(`${this.base}/crm/stage-templates`)
      .pipe(map((r) => r.data));
  }

  createStageTemplate(
    body: Required<SaveCrmStageTemplate>,
  ): Observable<CrmStageTemplate> {
    return this.http
      .post<ApiResponse<CrmStageTemplate>>(`${this.base}/crm/stage-templates`, body)
      .pipe(map((r) => r.data));
  }

  updateStageTemplate(id: number, body: SaveCrmStageTemplate): Observable<CrmStageTemplate> {
    return this.http
      .patch<ApiResponse<CrmStageTemplate>>(`${this.base}/crm/stage-templates/${id}`, body)
      .pipe(map((r) => r.data));
  }

  deleteStageTemplate(id: number): Observable<{ id: number }> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.base}/crm/stage-templates/${id}`)
      .pipe(map((r) => r.data));
  }

  createPipeline(body: { name: string; template_id: number }): Observable<CrmPipeline> {
    return this.http
      .post<ApiResponse<CrmPipeline>>(`${this.base}/crm/pipelines`, body)
      .pipe(map((r) => r.data));
  }

  applyStageTemplate(pipelineId: number, templateId: number): Observable<CrmPipeline> {
    return this.http
      .post<ApiResponse<CrmPipeline>>(`${this.base}/crm/pipelines/${pipelineId}/apply-template`, {
        template_id: templateId,
      })
      .pipe(map((r) => r.data));
  }
}
