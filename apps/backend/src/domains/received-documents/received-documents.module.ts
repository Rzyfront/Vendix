import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { S3Module } from '../../common/services/s3.module';
import { FiscalContextResolverService } from '../fiscal-operations/services/fiscal-context-resolver.service';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentParserService } from './services/received-document-parser.service';
import { ReceivedDocumentStorageService } from './services/received-document-storage.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentPagesService } from './services/received-document-pages.service';
import { ReceivedDocumentScanService } from './services/received-document-scan.service';
import { ReceivedDocumentScanQueueService } from './services/received-document-scan-queue.service';
import { ReceivedDocumentScanProcessor } from './services/received-document-scan.processor';
import { ReceivedDocumentMatchCandidatesService } from './services/received-document-match-candidates.service';
import { ReceivedDocumentMatchAllocationsService } from './services/received-document-match-allocations.service';
import { ReceivedDocumentMatchExpensesService } from './services/received-document-match-expenses.service';
import { DocumentReceptionConnectionsService } from './services/document-reception-connections.service';
import { DocumentReceptionHttpService } from './services/document-reception-http.service';
import { DocumentReceptionEnvelopeService } from './services/document-reception-envelope.service';
import { DocumentReceptionIngestService } from './services/document-reception-ingest.service';
import { DocumentReceptionSyncLeaseService } from './services/document-reception-sync-lease.service';
import { DocumentReceptionWebhookService } from './services/document-reception-webhook.service';
import { DocumentReceptionSyncService } from './services/document-reception-sync.service';
import { DocumentReceptionSyncQueueService } from './services/document-reception-sync-queue.service';
import { DocumentReceptionSyncProcessor } from './services/document-reception-sync.processor';
import { DocumentReceptionSyncSchedulerService } from './services/document-reception-sync-scheduler.service';
import { DocumentReceptionManualSyncService } from './services/document-reception-manual-sync.service';
import { DocumentReceptionRunResolutionService } from './services/document-reception-run-resolution.service';
import { PublicDocumentReceptionWebhookController } from './public-document-reception-webhook.controller';
import { StoreReceivedDocumentAccountingController } from './store-received-document-accounting.controller';
import { OrganizationReceivedDocumentAccountingController } from './organization-received-document-accounting.controller';
import { ReceivedDocumentAccountingEvidenceService } from './services/received-document-accounting-evidence.service';
import { ReceivedBuyerEventEnablementService } from './services/received-buyer-event-enablement.service';

/** Shared reception pipeline; this module also owns narrow read-only evidence routes. */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    BullModule.registerQueue({ name: 'received-document-scan' }),
    BullModule.registerQueue({ name: 'document-reception-sync' }),
  ],
  controllers: [PublicDocumentReceptionWebhookController, StoreReceivedDocumentAccountingController, OrganizationReceivedDocumentAccountingController],
  providers: [
    FiscalContextResolverService,
    ReceivedDocumentsContextService,
    ReceivedDocumentAccountingEvidenceService,
    ReceivedBuyerEventEnablementService,
    ReceivedDocumentsService,
    ReceivedDocumentParserService,
    ReceivedDocumentStorageService,
    ReceivedDocumentPagesService,
    ReceivedDocumentScanService,
    ReceivedDocumentScanQueueService,
    ReceivedDocumentScanProcessor,
    ReceivedDocumentMatchCandidatesService,
    ReceivedDocumentMatchAllocationsService,
    ReceivedDocumentMatchExpensesService,
    DocumentReceptionHttpService,
    DocumentReceptionConnectionsService,
    DocumentReceptionEnvelopeService,
    DocumentReceptionIngestService,
    DocumentReceptionSyncLeaseService,
    DocumentReceptionWebhookService,
    DocumentReceptionSyncService,
    DocumentReceptionSyncQueueService,
    DocumentReceptionSyncProcessor,
    DocumentReceptionSyncSchedulerService,
    DocumentReceptionManualSyncService,
    DocumentReceptionRunResolutionService,
  ],
  exports: [
    ReceivedDocumentsContextService,
    ReceivedDocumentAccountingEvidenceService,
    ReceivedBuyerEventEnablementService,
    ReceivedDocumentsService,
    ReceivedDocumentScanQueueService,
    ReceivedDocumentMatchCandidatesService,
    ReceivedDocumentMatchAllocationsService,
    ReceivedDocumentMatchExpensesService,
    DocumentReceptionConnectionsService,
    DocumentReceptionManualSyncService,
    DocumentReceptionRunResolutionService,
  ],
})
export class ReceivedDocumentsModule {}
