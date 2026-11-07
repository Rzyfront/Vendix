import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ReceivedDocumentPagesService } from '../../../received-documents/services/received-document-pages.service';
import { WorkflowsModule } from '../../workflows/workflows.module';
import { DocumentsModule } from '../documents.module';
import { DocumentChecksController } from './document-checks.controller';
import { DocumentChecksService } from './document-checks.service';

/**
 * Lectura con IA de archivos del expediente (P4.3). Importa Flujos para la
 * regla de visibilidad de la solicitud, por eso no cuelga de `DocumentsModule`
 * (Flujos ya importa Documentos). `AIEngineModule` es global.
 */
@Module({
  imports: [PrismaModule, ResponseModule, S3Module, DocumentsModule, WorkflowsModule],
  controllers: [DocumentChecksController],
  providers: [DocumentChecksService, ReceivedDocumentPagesService],
})
export class DocumentChecksModule {}
