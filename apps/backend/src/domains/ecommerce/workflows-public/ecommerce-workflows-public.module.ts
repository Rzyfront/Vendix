import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DocumentsModule } from '../../store/documents/documents.module';
import { WorkflowsModule } from '../../store/workflows/workflows.module';
import { EcommerceDocumentsSigningController } from './ecommerce-documents-signing.controller';
import { EcommerceWorkflowsPublicController } from './ecommerce-workflows-public.controller';
import { EcommerceWorkflowsTrackingController } from './ecommerce-workflows-tracking.controller';
import { WorkflowPublicCaptchaService } from './workflow-public-captcha.service';
import { WorkflowPublicFormService } from './workflow-public-form.service';

/**
 * Public side of Flujos (no JWT; the store comes from the domain): the form by
 * link with its captcha and chunked uploads, and the tracking portal.
 */
@Module({
  imports: [PrismaModule, ResponseModule, WorkflowsModule, DocumentsModule],
  controllers: [
    EcommerceWorkflowsPublicController,
    EcommerceWorkflowsTrackingController,
    EcommerceDocumentsSigningController,
  ],
  providers: [WorkflowPublicFormService, WorkflowPublicCaptchaService],
})
export class EcommerceWorkflowsPublicModule {}
