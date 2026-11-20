import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  AiScanJobOptions,
  AiScanJobService,
} from '../../../../../../core/services/ai-scan-job.service';
import {
  CommitMemberRosterDto,
  CommitMemberRosterResult,
  CommitPlanDto,
  MemberRosterAnalysis,
  RosterScanResult,
} from '../interfaces/member-bulk-scanner.interface';

/** Members per `analyze` request (backend cap, ia-cargas F2). */
export const MEMBER_ANALYZE_CHUNK = 200;
/** Members per `commit` request: each one creates customer + membership. */
export const MEMBER_COMMIT_CHUNK = 100;

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Service for the member-roster AI bulk-import flow.
 *
 * Mirrors the backend controller `MemberBulkScannerController` exposed under
 * `/store/memberships/bulk-scan` and follows the same 3-phase shape as
 * `InvoiceScannerService`:
 *   1. `scanRoster(file)`     — POST multipart, returns OCR extraction.
 *   2. `analyzeRoster(scan)`  — POST JSON, returns plan match + row status.
 *   3. `commitRoster(dto)`    — POST JSON, performs best-effort creation.
 *
 * Phase 1 must be called before phase 2 (the analyze endpoint validates the
 * scan shape). Phase 2 can be called repeatedly (each call is idempotent on
 * the input scan and pure on the store) but is typically invoked once.
 *
 * Permission enforcement is server-side via `@Permissions('store:memberships:bulk_import')`.
 */
@Injectable({ providedIn: 'root' })
export class MemberBulkScannerService {
  private readonly apiUrl = `${environment.apiUrl}/store/memberships/bulk-scan`;
  private readonly http = inject(HttpClient);
  private readonly aiScanJobs = inject(AiScanJobService);

  /**
   * Upload the source document (image or PDF, max 10MB) for AI extraction.
   *
   * Returns the raw OCR-shaped JSON (`RosterScanResult`) including the
   * detected document type, plans, members, and confidence. No analysis
   * or reconciliation happens at this stage.
   */
  scanRoster(
    file: File,
    opts?: AiScanJobOptions,
  ): Observable<ApiResponse<RosterScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    // Encola en `bulk-scan/async` y sondea el job; el `result` se adapta a
    // `{ success, data }`. Errores sin envolver (Error | HttpErrorResponse).
    return this.aiScanJobs
      .enqueueAndWait<RosterScanResult>(`${this.apiUrl}/async`, formData, opts)
      .pipe(map((result) => ({ success: true, data: result })));
  }

  /** Re-attaches to a scan started before a reload; `null` if none (QUI-1020). */
  resumeScan(
    resumeKey: string,
    opts?: Parameters<AiScanJobService['resume']>[1],
  ): Observable<ApiResponse<RosterScanResult>> | null {
    return (
      this.aiScanJobs
        .resume<RosterScanResult>(resumeKey, opts)
        ?.pipe(map((result) => ({ success: true, data: result }))) ?? null
    );
  }

  /**
   * Run reconciliation: fuzzy-match detected plans against existing store
   * plans, detect already-onboarded customers, classify each member row as
   * ready/warning/error and resolve status + period dates.
   *
   * This is a pure analysis call — it does not mutate the store.
   */
  analyzeRoster(
    scan: RosterScanResult,
    rowOffset = 0,
  ): Observable<ApiResponse<MemberRosterAnalysis>> {
    return this.http.post<ApiResponse<MemberRosterAnalysis>>(
      `${this.apiUrl}/analyze`,
      rowOffset ? { scan, row_offset: rowOffset } : { scan },
    );
  }

  /**
   * ia-cargas F2 — a sheet may bring up to 5.000 members; the backend
   * analyzes 200 per request. Same plans in every chunk (their match is
   * deterministic), members numbered across chunks with `row_offset`.
   */
  async analyzeRosterInChunks(
    scan: RosterScanResult,
    onProgress?: (done: number, total: number) => void,
  ): Promise<MemberRosterAnalysis> {
    const total = scan.members.length;
    if (total <= MEMBER_ANALYZE_CHUNK) {
      const res = await firstValueFrom(this.analyzeRoster(scan));
      if (!res?.success || !res.data) {
        throw new Error(res?.message || 'Error al analizar el documento');
      }
      return res.data;
    }
    const parts: MemberRosterAnalysis[] = [];
    for (let start = 0; start < total; start += MEMBER_ANALYZE_CHUNK) {
      onProgress?.(start, total);
      const chunk: RosterScanResult = {
        ...scan,
        members: scan.members.slice(start, start + MEMBER_ANALYZE_CHUNK),
        // Sent once is enough; the per-row data travels on each member.
        skipped: undefined,
        row_issues: undefined,
      };
      const res = await firstValueFrom(this.analyzeRoster(chunk, start));
      if (!res?.success || !res.data) {
        throw new Error(res?.message || 'Error al analizar el documento');
      }
      parts.push(res.data);
    }
    onProgress?.(total, total);
    // Plans and global warnings are the same in every chunk.
    return {
      ...parts[0],
      members: parts.flatMap((p) => p.members),
      ready_count: parts.reduce((n, p) => n + p.ready_count, 0),
      with_warnings_count: parts.reduce((n, p) => n + p.with_warnings_count, 0),
      with_errors_count: parts.reduce((n, p) => n + p.with_errors_count, 0),
    };
  }

  /**
   * Commit the user-edited plan decisions + member rows. Best-effort:
   * plans are created first (aborts before member creation if any plan
   * fails); members are then iterated per-row, capturing per-row errors
   * and returning them in `results[]`.
   */
  commitRoster(
    dto: CommitMemberRosterDto,
  ): Observable<ApiResponse<CommitMemberRosterResult>> {
    return this.http.post<ApiResponse<CommitMemberRosterResult>>(
      `${this.apiUrl}/commit`,
      dto,
    );
  }

  /**
   * ia-cargas F2 — commit in chunks of {@link MEMBER_COMMIT_CHUNK} members
   * (each request stays far from the 60 s proxy limit). The first chunk
   * creates the new plans; the next ones send them as `existing` with the
   * ids the backend returned, so no plan is created twice. One `session_id`
   * keeps ONE row in the upload log. A plan error stops before any member.
   */
  async commitRosterInChunks(
    dto: CommitMemberRosterDto,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CommitMemberRosterResult> {
    const total = dto.members.length;
    if (total <= MEMBER_COMMIT_CHUNK) {
      const res = await firstValueFrom(this.commitRoster(dto));
      if (!res?.data) throw new Error('Respuesta inesperada del servidor');
      return res.data;
    }
    const sessionId = `members-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let plans: CommitPlanDto[] = dto.plans;
    const merged: CommitMemberRosterResult = {
      ready: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      plan_errors: [],
    };
    for (let start = 0; start < total; start += MEMBER_COMMIT_CHUNK) {
      onProgress?.(start, total);
      const res = await firstValueFrom(
        this.commitRoster({
          ...dto,
          plans,
          members: dto.members.slice(start, start + MEMBER_COMMIT_CHUNK),
          session_id: sessionId,
          total_members: total,
        }),
      );
      const data = res?.data;
      if (!data) throw new Error('Respuesta inesperada del servidor');
      if (data.plan_errors?.length) {
        return { ...merged, plan_errors: data.plan_errors };
      }
      merged.ready += data.ready;
      merged.succeeded += data.succeeded;
      merged.failed += data.failed;
      merged.results.push(...data.results);
      if (start === 0) {
        const ids = new Map(
          (data.plans_resolved ?? []).map((p) => [p.ref_index, p.plan_id]),
        );
        if (plans.some((p) => p.status === 'new' && !ids.has(p.ref_index))) {
          throw new Error(
            'No se pudo confirmar el plan creado; recarga la página antes de seguir para no duplicarlo.',
          );
        }
        plans = plans.map((p) =>
          ids.has(p.ref_index)
            ? { ref_index: p.ref_index, status: 'existing', plan_id: ids.get(p.ref_index) }
            : p,
        );
      }
    }
    onProgress?.(total, total);
    return merged;
  }
}
