import { Module } from '@nestjs/common';
import { LegalDocumentsController } from './controllers/legal-documents.controller';
import { LegalDocumentsService } from './services/legal-documents.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService],
  exports: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
