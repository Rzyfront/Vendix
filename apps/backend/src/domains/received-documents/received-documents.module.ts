import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { S3Module } from '../../common/services/s3.module';
import { FiscalContextResolverService } from '../fiscal-operations/services/fiscal-context-resolver.service';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentParserService } from './services/received-document-parser.service';
import { ReceivedDocumentStorageService } from './services/received-document-storage.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';

/** Provider-only shared module; route controllers live in each invoicing module. */
@Module({
  imports: [PrismaModule, ResponseModule, S3Module],
  providers: [
    FiscalContextResolverService,
    ReceivedDocumentsContextService,
    ReceivedDocumentsService,
    ReceivedDocumentParserService,
    ReceivedDocumentStorageService,
  ],
  exports: [ReceivedDocumentsContextService, ReceivedDocumentsService],
})
export class ReceivedDocumentsModule {}
