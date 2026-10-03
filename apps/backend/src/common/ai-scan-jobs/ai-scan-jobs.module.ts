import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { S3Module } from '@common/services/s3.module';
import { AiScanHandlerRegistry } from './ai-scan-handler.registry';
import { AiScanJobService } from './ai-scan-job.service';
import { AiScanProcessor } from './ai-scan.processor';
import { AiScanJobsController } from './ai-scan-jobs.controller';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'ai-scan' }), S3Module],
  controllers: [AiScanJobsController],
  providers: [AiScanHandlerRegistry, AiScanJobService, AiScanProcessor],
  exports: [AiScanHandlerRegistry, AiScanJobService],
})
export class AiScanJobsModule {}
