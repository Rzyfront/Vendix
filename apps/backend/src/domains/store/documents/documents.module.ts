import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { VexiAttachmentsService } from '../vexi/vexi-attachments.service';
import { createDocumentTools } from '../../../ai-engine/tools/domains/documents.tools';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DossiersController } from './documents.controller';
import { DossiersService } from './dossiers.service';
import { RecordAttachmentsService } from './record-attachments.service';
import { RecordDocumentsController } from './record-documents.controller';
import { RecordDocumentsService } from './record-documents.service';
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
import { WorkflowAuditModule } from '../workflows/audit/workflow-audit.module';
import { WorkflowLimitsModule } from '../workflows/limits/workflow-limits.module';
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
  imports: [
    PrismaModule,
    S3Module,
    ResponseModule,
    NotificationsModule,
    EmailModule,
    // P7: storage limit on upload and fail-closed audit of document accesses.
    WorkflowAuditModule,
    WorkflowLimitsModule,
  ],
  controllers: [
    DossiersController,
    DocumentFileProfilesController,
    DocumentExpiryController,
    DocumentRetentionController,
    DocumentSearchController,
    // B1: a record's documents in every industry, behind the record's read permission.
    RecordDocumentsController,
    SignaturesController,
    DocumentTemplatesController,
    IssuedDocumentsController,
  ],
  providers: [
    StoredFilesService,
    DossiersService,
    // T44: Vex saves a chat attachment into a record's folder.
    RecordAttachmentsService,
    RecordDocumentsService,
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
export class DocumentsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    // Provided by the @Global() AIEngineModule, like AIToolRegistry.
    private readonly attachments: VexiAttachmentsService,
    private readonly recordAttachments: RecordAttachmentsService,
  ) {}

  /** T44: Vex saves a chat attachment into a record's folder (permission per target entity). */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createDocumentTools({
        attachments: this.attachments,
        recordAttachments: this.recordAttachments,
      }),
    );
  }
}
