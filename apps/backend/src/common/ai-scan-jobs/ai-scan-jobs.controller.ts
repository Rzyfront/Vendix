import { Controller, Get, Param } from '@nestjs/common';
import { AiScanJobService } from './ai-scan-job.service';
import { AiScanJobStatus } from './interfaces/ai-scan-job.interface';

/**
 * GET /api/ai-scan-jobs/:jobId -> {status, result?, error?} (sin envelope).
 * Sin @Permissions: el permiso se valida al encolar; la propiedad del job
 * (user + org + store) es el control.
 */
@Controller('ai-scan-jobs')
export class AiScanJobsController {
  constructor(private readonly jobs: AiScanJobService) {}

  @Get(':jobId')
  getStatus(@Param('jobId') jobId: string): Promise<AiScanJobStatus> {
    return this.jobs.getStatus(jobId);
  }
}
