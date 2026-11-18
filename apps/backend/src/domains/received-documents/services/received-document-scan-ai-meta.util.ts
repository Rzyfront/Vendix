import type { Queue } from 'bullmq';
import type { AiJobMonitorService } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import type { ReceivedDocumentScanJob } from '../interfaces/received-document-scan-job.interface';
import { receivedDocumentScanOwner } from './received-document-scan.processor';

/**
 * QUI-1020: adds the additive AI-job meta (progress, timestamps, stall,
 * failure class) to a received-document scan status. Call it only after
 * `ReceivedDocumentScanQueueService.getStatus` validated the tenant, so it
 * never widens access. Without queue or monitor (manual construction in
 * specs) the status is returned untouched.
 */
export async function withReceivedScanAiMeta<T extends { status: string }>(
  status: T,
  jobId: string,
  queue: Queue<ReceivedDocumentScanJob> | undefined,
  monitor: AiJobMonitorService | undefined,
) {
  if (!queue || !monitor) return status;
  const job = await queue.getJob(jobId);
  if (!job) return status;
  const state = await job.getState();
  // A failed job's `error` carries the Vendix error CODE (what the web client
  // classifies and maps to a message); `error_code` is kept untouched.
  const failedCode =
    status.status === 'failed' ? job.failedReason?.trim() : undefined;
  return {
    ...status,
    ...(failedCode ? { error: failedCode } : {}),
    ...(await monitor.describe(
      job,
      state,
      LEGACY_AI_SOURCES.receivedDocumentScan,
      receivedDocumentScanOwner(job),
      queue,
    )),
  };
}
