import { withJobOrigin } from '../queue/job-origin';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  AiScanFile,
  AiScanJob,
  AiScanJobContext,
  AiScanJobStatus,
  AiScanKind,
} from './interfaces/ai-scan-job.interface';
import { AiJobMonitorService } from './ai-job-monitor.service';
import { aiScanSource } from './ai-scan-sources';

type EnqueueFile = Express.Multer.File | AiScanFile;

/** Completed results stay 2 h: enough to re-attach after a reload. */
export const AI_SCAN_KEEP_COMPLETED_SECONDS = 2 * 60 * 60;
/** Failures stay a day: the user (and support) can still read why. */
export const AI_SCAN_KEEP_FAILED_SECONDS = 24 * 60 * 60;

@Injectable()
export class AiScanJobService {
  private readonly logger = new Logger(AiScanJobService.name);

  constructor(
    @InjectQueue('ai-scan') private readonly queue: Queue,
    private readonly s3Service: S3Service,
    private readonly monitor: AiJobMonitorService,
  ) {}

  async enqueue(
    kind: AiScanKind,
    files: EnqueueFile[] = [],
    params: Record<string, unknown> = {},
  ): Promise<{ job_id: string }> {
    const rc = RequestContextService.getContext();
    const context: AiScanJobContext = {
      store_id: rc?.store_id ?? null,
      organization_id: rc?.organization_id ?? null,
      user_id: rc?.user_id ?? null,
      is_super_admin: !!rc?.is_super_admin,
      request_id: rc?.request_id ?? `queue-${randomUUID()}`,
    };

    const prefix = `ai-scans/${context.organization_id ?? 'platform'}/${
      context.store_id ? 'store-' + context.store_id : 'org'
    }/${kind}`;

    const file_keys: string[] = [];
    try {
      for (const file of files) {
        const original =
          (file as Express.Multer.File).originalname ??
          (file as AiScanFile).originalName ??
          '';
        const mime =
          (file as Express.Multer.File).mimetype ??
          (file as AiScanFile).mimeType ??
          'application/octet-stream';
        const safeName =
          original
            .split(/[\\/]/)
            .pop()!
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/\.{2,}/g, '.')
            .slice(0, 120) || 'scan';
        const key = await this.s3Service.uploadFile(
          file.buffer,
          `${prefix}/${Date.now()}-${safeName}`,
          mime,
        );
        file_keys.push(key);
      }
    } catch (err: any) {
      this.logger.error(
        `[AiScan] kind=${kind} S3 upload failed: ${err?.message ?? err}`,
      );
      throw new VendixHttpException(ErrorCodes.UPLOAD_FAILED_001);
    }

    const job: AiScanJob = { kind, context, file_keys, params };
    const added = await this.queue.add(kind, withJobOrigin(job, `http:escaneo-ia/${kind}`), {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      // QUI-1020: the web re-attaches to the job after a reload, so the result
      // must outlive a busy hour. Count-only retention (100 / 50, shared by
      // every tenant) evicted it in minutes and the poll answered 404.
      removeOnComplete: { age: AI_SCAN_KEEP_COMPLETED_SECONDS, count: 1000 },
      removeOnFail: { age: AI_SCAN_KEEP_FAILED_SECONDS, count: 1000 },
    });
    return { job_id: String(added.id) };
  }

  async getStatus(jobId: string): Promise<AiScanJobStatus> {
    const notFound = () => new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    try {
      const rc = RequestContextService.getContext();
      const callerUser = rc?.user_id ?? null;
      if (callerUser == null) throw notFound();

      const job = await this.queue.getJob(jobId);
      const owner = (job?.data as AiScanJob | undefined)?.context;
      if (
        !job ||
        !owner ||
        (owner.user_id ?? null) !== callerUser ||
        (owner.organization_id ?? null) !== (rc?.organization_id ?? null) ||
        (owner.store_id ?? null) !== (rc?.store_id ?? null)
      ) {
        throw notFound();
      }

      const state = await job.getState();
      let status: AiScanJobStatus['status'];
      switch (state) {
        case 'completed':
        case 'failed':
        case 'active':
        case 'delayed':
          status = state;
          break;
        case 'waiting':
        case 'prioritized':
        case 'waiting-children':
          status = 'waiting';
          break;
        default:
          throw notFound();
      }

      const out: AiScanJobStatus = {
        status,
        kind: (job.data as AiScanJob).kind,
        ...(await this.monitor.describe(
          job,
          state,
          aiScanSource((job.data as AiScanJob).kind),
          owner,
          this.queue,
        )),
      };
      if (status === 'completed') out.result = job.returnvalue;
      if (status === 'failed') out.error = job.failedReason;
      return out;
    } catch (err) {
      if (
        err instanceof VendixHttpException &&
        err.errorCode === ErrorCodes.AI_QUEUE_002.code
      ) {
        throw err;
      }
      throw notFound();
    }
  }
}
