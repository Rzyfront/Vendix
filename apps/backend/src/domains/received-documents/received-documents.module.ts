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
import { DocumentReceptionConnectionsService } from './services/document-reception-connections.service';
import { DocumentReceptionHttpService } from './services/document-reception-http.service';

/** Provider-only shared module; route controllers live in each invoicing module. */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    BullModule.registerQueue({ name: 'received-document-scan' }),
  ],
  providers: [
    FiscalContextResolverService,
    ReceivedDocumentsContextService,
    ReceivedDocumentsService,
    ReceivedDocumentParserService,
    ReceivedDocumentStorageService,
    ReceivedDocumentPagesService,
    ReceivedDocumentScanService,
    ReceivedDocumentScanQueueService,
    ReceivedDocumentScanProcessor,
    DocumentReceptionHttpService,
    DocumentReceptionConnectionsService,
  ],
  exports: [
    ReceivedDocumentsContextService,
    ReceivedDocumentsService,
    ReceivedDocumentScanQueueService,
    DocumentReceptionConnectionsService,
  ],
})
export class ReceivedDocumentsModule {}
