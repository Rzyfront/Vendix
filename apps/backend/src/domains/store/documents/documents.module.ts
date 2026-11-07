import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DossiersController } from './documents.controller';
import { DossiersService } from './dossiers.service';
import { StoredFilesService } from './stored-files.service';

/**
 * Documental D1: archivos almacenados (S3 por llave), expedientes y sus items.
 * No depende de Flujos; `WorkflowsModule` lo importa para el requisito `upload`,
 * el expediente por solicitud y la descarga con regla de participante.
 * `S3PathHelper` y `AuditService` llegan por módulos globales.
 */
@Module({
  imports: [PrismaModule, S3Module, ResponseModule],
  controllers: [DossiersController],
  providers: [StoredFilesService, DossiersService],
  exports: [StoredFilesService, DossiersService],
})
export class DocumentsModule {}
