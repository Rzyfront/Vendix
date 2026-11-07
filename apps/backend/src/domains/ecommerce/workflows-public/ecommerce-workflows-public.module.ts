import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { WorkflowsModule } from '../../store/workflows/workflows.module';
import { EcommerceWorkflowsPublicController } from './ecommerce-workflows-public.controller';
import { WorkflowPublicFormService } from './workflow-public-form.service';

/** Public form by link of Flujos (no JWT; the store comes from the domain). */
@Module({
  imports: [PrismaModule, ResponseModule, WorkflowsModule],
  controllers: [EcommerceWorkflowsPublicController],
  providers: [WorkflowPublicFormService],
})
export class EcommerceWorkflowsPublicModule {}
