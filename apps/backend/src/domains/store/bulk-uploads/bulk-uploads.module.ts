import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { BulkUploadLogsController } from './bulk-upload-logs.controller';
import { BulkUploadLogsService } from './bulk-upload-logs.service';

/**
 * QUI-1004 — registro liviano de cargas masivas. Exporta el servicio para que
 * cada módulo con carga masiva registre sus cargas y consulte repetidos.
 * `StorePrismaService` llega del `PrismaModule` global (no se redeclara).
 */
@Module({
  imports: [ResponseModule],
  controllers: [BulkUploadLogsController],
  providers: [BulkUploadLogsService],
  exports: [BulkUploadLogsService],
})
export class BulkUploadsModule {}
