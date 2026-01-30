import { Module } from '@nestjs/common';
import { LegalDocumentsController } from './controllers/legal-documents.controller';
import { LegalDocumentsService } from './services/legal-documents.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService],
  exports: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
