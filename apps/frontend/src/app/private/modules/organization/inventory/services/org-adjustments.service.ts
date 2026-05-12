import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  CreateOrgAdjustmentBulkRequest,
  CreateOrgAdjustmentRequest,
  OrgAdjustment,
  OrgAdjustmentQuery,
} from '../interfaces/org-adjustment.interface';

interface PaginatedAdjustments {
  data: OrgAdjustment[];
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    total_pages?: number;
  };
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    total_pages?: number;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Org-level adjustments client. Hits `/api/organization/inventory/adjustments`.
 * Backend permissions follow the `organization:inventory:adjustments:*` namespace
 * — the UI gates buttons by those permissions but every call still relies on
 * the backend `PermissionsGuard` for actual enforcement.
 */
@Injectable({ providedIn: 'root' })
export class OrgAdjustmentsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/organization/inventory/adjustments`;

  list(query: OrgAdjustmentQuery = {}): Observable<PaginatedAdjustments> {
    const params = this.toParams(query);
    return this.http
      .get<any>(this.baseUrl, { params })
      .pipe(
        map((r) => this.normalizeListResponse(r)),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  findOne(id: number): Observable<OrgAdjustment> {
    return this.http
      .get<ApiResponse<OrgAdjustment>>(`${this.baseUrl}/${id}`)
      .pipe(
        map((r) => r.data),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  create(dto: CreateOrgAdjustmentRequest): Observable<OrgAdjustment> {
    return this.http
      .post<ApiResponse<OrgAdjustment>>(this.baseUrl, dto)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  createBulk(
    dto: CreateOrgAdjustmentBulkRequest,
  ): Observable<OrgAdjustment[]> {
    return this.http
      .post<ApiResponse<OrgAdjustment[]>>(`${this.baseUrl}/bulk`, dto)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  approve(id: number): Observable<OrgAdjustment> {
    return this.http
      .post<ApiResponse<OrgAdjustment>>(`${this.baseUrl}/${id}/approve`, {})
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  /**
   * Backend exposes `DELETE /:id` as the cancel/delete operation (returns the
   * cancelled row in the response body). UI uses this for both pending and
   * approved adjustments — service layer enforces business rules.
   */
  cancel(id: number): Observable<OrgAdjustment> {
    return this.http
      .delete<ApiResponse<OrgAdjustment>>(`${this.baseUrl}/${id}`)
      .pipe(
        map((r) => r.data),
        tap(() => this.invalidateCache()),
        catchError((err) => throwError(() => this.normalizeError(err))),
      );
  }

  /**
   * No internal cache today — kept for symmetry with the store-side service.
   * Reserved for future shareReplay caches on stats / counters.
   */
  invalidateCache(): void {
    /* no-op (no shareReplay caches yet) */
  }

  private normalizeListResponse(r: any): PaginatedAdjustments {
    if (!r) return { data: [], meta: { total: 0 } };
    if (Array.isArray(r)) return { data: r, meta: { total: r.length } };
    const data = Array.isArray(r.data) ? r.data : [];
    return {
      data,
      meta: r.meta ?? r.pagination ?? { total: data.length },
      pagination: r.pagination,
    };
  }

  private toParams(query: Record<string, unknown> | object | undefined): HttpParams {
    let params = new HttpParams();
    if (!query) return params;
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      params = params.set(k, String(v));
    }
    return params;
  }

  private normalizeError(error: any): Error {
    const msg =
      error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      'Error desconocido';
    return new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}
