import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DossiersController } from './documents.controller';
import { DossiersService } from './dossiers.service';
import { StoredFilesService } from './stored-files.service';
import { ReceivedDocumentPagesService } from '../../received-documents/services/received-document-pages.service';
import { BasePdfPagesService } from './templates/base-pdf-pages.service';
import { DocumentTemplatesController } from './templates/document-templates.controller';
import { DocumentTemplatesService } from './templates/document-templates.service';
import { FrozenIssuedDocumentRenderer } from './templates/issued-document-renderer.impl';
import { IssuedDocumentRenderer } from './templates/issued-document-renderer';
import { IssuedDocumentsController } from './templates/issued-documents.controller';
import { IssuedDocumentsRenderQueue } from './templates/issued-documents.queue';
import { IssuedDocumentsService } from './templates/issued-documents.service';
import { TemplateDataService } from './templates/template-data.service';
import { TemplateRenderService } from './templates/template-render.service';
import { EmailModule } from '../../../email/email.module';
import { SignaturesController } from './signatures/signatures.controller';
import { SignatureDeliveryService } from './signatures/signature-delivery.service';
import { SignatureEvidenceService } from './signatures/signature-evidence.service';
import { SignatureExpiryCron } from './signatures/signature-expiry.cron';
import { SignatureFlowNotifier } from './signatures/signature-flow.notifier';
import { SignaturePublicService } from './signatures/signature-public.service';
import { SignatureRequestsService } from './signatures/signature-requests.service';
import { SignatureSealService } from './signatures/signature-seal.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentExpiryController } from './profiles/document-expiry.controller';
import { DocumentExpiryCron } from './profiles/document-expiry.cron';
import { DocumentExpiryService } from './profiles/document-expiry.service';
import { DocumentFileProfilesController } from './profiles/document-file-profiles.controller';
import { DocumentFileProfilesService } from './profiles/document-file-profiles.service';
import { DocumentRetentionController } from './retention/document-retention.controller';
import { DocumentRetentionCron } from './retention/document-retention.cron';
import { DocumentRetentionService } from './retention/document-retention.service';
import { DocumentSearchController } from './search/document-search.controller';
import { DocumentSearchService } from './search/document-search.service';

/**
 * Documental D1: archivos almacenados (S3 por llave), expedientes y sus items.
 * No depende de Flujos; `WorkflowsModule` lo importa para el requisito `upload`,
 * el expediente por solicitud y la descarga con regla de participante.
 * `S3PathHelper` y `AuditService` llegan por módulos globales.
 */
@Module({
  imports: [PrismaModule, S3Module, ResponseModule, NotificationsModule, EmailModule],
  controllers: [
    DossiersController,
    DocumentFileProfilesController,
    DocumentExpiryController,
    DocumentRetentionController,
    DocumentSearchController,
    SignaturesController,
    DocumentTemplatesController,
    IssuedDocumentsController,
  ],
  providers: [
    StoredFilesService,
    DossiersService,
    // P4.4/P4.6/P4.7: perfil del archivo, retención y purga, vencimientos, búsqueda y carpetas.
    DocumentFileProfilesService,
    DocumentRetentionService,
    DocumentRetentionCron,
    DocumentExpiryService,
    DocumentExpiryCron,
    DocumentSearchService,
    // P4.2: firma electrónica simple. `IssuedDocumentRenderer` lo provee la plantilla (P4.1).
    SignatureEvidenceService,
    SignatureDeliveryService,
    SignatureFlowNotifier,
    SignatureSealService,
    SignatureRequestsService,
    SignaturePublicService,
    SignatureExpiryCron,
    // P4.1/P4.5: plantillas, versiones inmutables, emisión y cola de render.
    ReceivedDocumentPagesService,
    BasePdfPagesService,
    TemplateDataService,
    TemplateRenderService,
    DocumentTemplatesService,
    IssuedDocumentsService,
    IssuedDocumentsRenderQueue,
    { provide: IssuedDocumentRenderer, useClass: FrozenIssuedDocumentRenderer },
  ],
  exports: [
    StoredFilesService,
    DossiersService,
    SignatureRequestsService,
    SignaturePublicService,
    IssuedDocumentRenderer,
    IssuedDocumentsService,
    DocumentTemplatesService,
  ],
})
export class DocumentsModule {}
