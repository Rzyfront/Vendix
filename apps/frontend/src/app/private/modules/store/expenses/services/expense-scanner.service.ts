import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AiScanJobOptions,
  AiScanJobService,
} from '../../../../../core/services/ai-scan-job.service';
import { ExpenseScanResponse } from '../interfaces/expense-scanner.interface';

/** Remembers the running scan so a reload re-attaches to it (QUI-1020). */
const RESUME_KEY = 'expense_scan';

type ExpenseScanProgress = Pick<AiScanJobOptions, 'progress' | 'onStall'>;

/**
 * Expense invoice scan (`expense-scan` queue). The enqueue / wait / resume
 * cycle (backoff polling, progress bar, failure categories) lives in
 * `AiScanJobService`; this service only knows the URLs.
 */
@Injectable({
  providedIn: 'root',
})
export class ExpenseScannerService {
  private readonly aiScanJobs = inject(AiScanJobService);

  private readonly statusUrl = (jobId: string): string =>
    `${environment.apiUrl}/store/expenses/scan/${jobId}`;

  /**
   * Scans an expense invoice with AI: enqueues the job and waits for it,
   * emitting the final `ExpenseScanResponse` (`{ scan, matched_category }`)
   * once. Fails with `AiScanJobError` (document / Vendix / AI service).
   */
  scanInvoiceAsync(
    file: File,
    opts?: ExpenseScanProgress,
  ): Observable<ExpenseScanResponse> {
    const fd = new FormData();
    fd.append('file', file);
    return this.aiScanJobs.enqueueAndWait<ExpenseScanResponse>(
      `${environment.apiUrl}/store/expenses/scan`,
      fd,
      { ...opts, statusUrl: this.statusUrl, resumeKey: RESUME_KEY },
    );
  }

  /** Re-attaches to a scan started before a reload; `null` if none. */
  resumeScan(
    opts?: ExpenseScanProgress,
  ): Observable<ExpenseScanResponse> | null {
    return this.aiScanJobs.resume<ExpenseScanResponse>(RESUME_KEY, {
      ...opts,
      statusUrl: this.statusUrl,
    });
  }

  /** Forgets the remembered scan (the user discarded it). */
  forgetScan(): void {
    this.aiScanJobs.forget(RESUME_KEY);
  }
}
