import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { ApiKeysModule } from '../store/integrations/api-keys/api-keys.module';
import { WorkflowsModule } from '../store/workflows/workflows.module';
import { ApiV1WorkflowsController } from './api-v1-workflows.controller';

/** `/api/v1/*`: public API authenticated with store API keys. */
@Module({
  imports: [ApiKeysModule, WorkflowsModule, ResponseModule],
  controllers: [ApiV1WorkflowsController],
})
export class ApiV1Module {}
