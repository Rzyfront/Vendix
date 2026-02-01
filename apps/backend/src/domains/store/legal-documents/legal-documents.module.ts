import { Module } from '@nestjs/common';
import { StoreLegalDocumentsController } from './controllers/store-legal-documents.controller';
import { StoreLegalDocumentsService } from './services/store-legal-documents.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditModule } from '@common/audit/audit.module';
import { S3Module } from '@common/services/s3.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
    imports: [PrismaModule, AuditModule, S3Module, ResponseModule],
    controllers: [StoreLegalDocumentsController],
    providers: [StoreLegalDocumentsService],
    exports: [StoreLegalDocumentsService],
})
export class StoreLegalDocumentsModule { }
