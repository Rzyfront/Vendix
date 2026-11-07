import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WorkflowPublicUploadsService } from './workflow-public-uploads.service';

/**
 * Hourly: open chunked-upload sessions past their 24 h life are aborted in S3
 * (so no orphan multipart parts keep costing) and marked `aborted`. Runs only
 * in the worker (the API unmounts crons).
 */
@Injectable()
export class WorkflowUploadSessionsCron {
  private readonly logger = new Logger(WorkflowUploadSessionsCron.name);
  private running = false;

  constructor(private readonly uploads: WorkflowPublicUploadsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.uploads.sweepExpired(new Date());
    } catch (e) {
      this.logger.error(`Upload session sweep failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }
}
