import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { WorkflowAuditService } from './workflow-audit.service';

/**
 * Append-only audit trail of Flows (P7.2), as its own module so the documents
 * domain (downloads, signatures) and the global request interceptor can write
 * to it without importing `WorkflowsModule`, which already imports
 * `DocumentsModule`.
 */
@Module({
  imports: [PrismaModule],
  providers: [WorkflowAuditService],
  exports: [WorkflowAuditService],
})
export class WorkflowAuditModule {}
