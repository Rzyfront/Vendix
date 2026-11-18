import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { S3Module } from '@common/services/s3.module';
import { PlatformOrgService } from '@common/services/platform-org.service';
import { AiScanHandlerRegistry } from './ai-scan-handler.registry';
import { AiScanJobService } from './ai-scan-job.service';
import { AiScanProcessor } from './ai-scan.processor';
import { AiScanJobsController } from './ai-scan-jobs.controller';
import { AiJobMonitorService } from './ai-job-monitor.service';

/**
 * Global: the per-domain scan queues (invoice, expense, receipt…) inject
 * `AiJobMonitorService` too (QUI-1020). `PlatformIncidentService` comes from
 * its own global module.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'ai-scan' }), S3Module],
  controllers: [AiScanJobsController],
  providers: [
    AiScanHandlerRegistry,
    AiScanJobService,
    AiScanProcessor,
    AiJobMonitorService,
    PlatformOrgService,
  ],
  exports: [AiScanHandlerRegistry, AiScanJobService, AiJobMonitorService],
})
export class AiScanJobsModule {}
