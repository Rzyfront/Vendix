import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResponseModule } from '@common/responses/response.module';
import { BulkUploadLogsController } from './bulk-upload-logs.controller';
import { BulkUploadLogsService } from './bulk-upload-logs.service';
import { BulkUploadHandlerRegistry } from './bulk-upload-handler.registry';
import { BulkUploadJobLockService } from './bulk-upload-job-lock.service';
import { BulkUploadJobRunnerService } from './bulk-upload-job-runner.service';
import { BulkUploadJobsProcessor } from './bulk-upload-jobs.processor';
import { BulkUploadJobsService } from './bulk-upload-jobs.service';
import { BULK_UPLOAD_JOBS_QUEUE } from './bulk-upload-job.types';

/**
 * QUI-1004 — registro liviano de cargas masivas. Exporta el servicio para que
 * cada módulo con carga masiva registre sus cargas y consulte repetidos.
 * `StorePrismaService` llega del `PrismaModule` global (no se redeclara).
 *
 * QUI-1009 — trabajos durables: cola `bulk-upload-jobs`, registro de handlers
 * (cada dominio registra el suyo en `onModuleInit`) y servicio de trabajos.
 * `PlatformIncidentService` y Redis llegan de módulos globales.
 */
@Module({
  imports: [
    ResponseModule,
    BullModule.registerQueue({ name: BULK_UPLOAD_JOBS_QUEUE }),
  ],
  controllers: [BulkUploadLogsController],
  providers: [
    BulkUploadLogsService,
    BulkUploadHandlerRegistry,
    BulkUploadJobLockService,
    BulkUploadJobRunnerService,
    BulkUploadJobsProcessor,
    BulkUploadJobsService,
  ],
  exports: [
    BulkUploadLogsService,
    BulkUploadHandlerRegistry,
    BulkUploadJobsService,
  ],
})
export class BulkUploadsModule {}
