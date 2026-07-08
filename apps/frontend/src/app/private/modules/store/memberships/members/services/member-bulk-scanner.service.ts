import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  CommitMemberRosterDto,
  CommitMemberRosterResult,
  MemberRosterAnalysis,
  RosterScanResult,
} from '../interfaces/member-bulk-scanner.interface';

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

  /**
   * Upload the source document (image or PDF, max 10MB) for AI extraction.
   *
   * Returns the raw OCR-shaped JSON (`RosterScanResult`) including the
   * detected document type, plans, members, and confidence. No analysis
   * or reconciliation happens at this stage.
   */
  scanRoster(file: File): Observable<ApiResponse<RosterScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ApiResponse<RosterScanResult>>(`${this.apiUrl}`, formData);
  }

  /**
   * Run reconciliation: fuzzy-match detected plans against existing store
   * plans, detect already-onboarded customers, classify each member row as
   * ready/warning/error and resolve status + period dates.
   *
   * This is a pure analysis call — it does not mutate the store.
   */
  analyzeRoster(scan: RosterScanResult): Observable<ApiResponse<MemberRosterAnalysis>> {
    return this.http.post<ApiResponse<MemberRosterAnalysis>>(
      `${this.apiUrl}/analyze`,
      { scan },
    );
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
}
