import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export type WorkflowAuditCategory =
  | 'definition'
  | 'decision'
  | 'document'
  | 'secret'
  | 'export';

/** One row of the immutable audit trail, already presented by the API. */
export interface WorkflowAuditEntry {
  /** bigint on the server, serialized as a string. */
  id: string;
  seq: string;
  created_at: string;
  category: WorkflowAuditCategory;
  category_label: string;
  action: string;
  action_label: string;
  actor: { type: string; id: number | null; name: string };
  target: { type: string; type_label: string; id: string | null };
  definition_id: number | null;
  instance_id: number | null;
  summary: string;
  details: unknown;
  ip_address: string | null;
  user_agent: string | null;
  prev_hash: string | null;
  entry_hash: string;
}

/** Filters shared by the list and the export; dates are store calendar days. */
export interface WorkflowAuditFilters {
  from?: string;
  to?: string;
  category?: WorkflowAuditCategory;
  action?: string;
  actor_id?: number;
  definition_id?: number;
  instance_id?: number;
  search?: string;
}

export interface WorkflowAuditPage {
  items: WorkflowAuditEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface WorkflowAuditVerification {
  valid: boolean;
  count: number;
  broken_at_seq: string | null;
}

interface PaginatedResponse {
  data: WorkflowAuditEntry[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Client of `store/workflows/audit` (P7.2): list, verify and XLSX export. */
@Injectable({ providedIn: 'root' })
export class WorkflowAuditApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/workflows/audit`;

  list(
    filters: WorkflowAuditFilters = {},
    page = 1,
    limit = 25,
  ): Observable<WorkflowAuditPage> {
    return this.http
      .get<PaginatedResponse>(this.baseUrl, {
        params: this.params(filters).set('page', page).set('limit', limit),
      })
      .pipe(
        map((res) => ({
          items: res.data,
          total: res.meta.total,
          page: res.meta.page,
          limit: res.meta.limit,
          totalPages: res.meta.totalPages,
        })),
      );
  }

  verify(): Observable<WorkflowAuditVerification> {
    return this.http
      .get<{ data: WorkflowAuditVerification }>(`${this.baseUrl}/verify`)
      .pipe(map((res) => res.data));
  }

  /** The workbook of the same filters. Asking for it is itself audited. */
  export(filters: WorkflowAuditFilters = {}): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/export`, {
      params: this.params(filters),
      responseType: 'blob',
    });
  }

  private params(filters: WorkflowAuditFilters): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return params;
  }
}
