import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIAgentsStatusController } from './ai-agents-status.controller';

/**
 * `AgentRuntimeConfigService` comes from the global `AIEngineModule`.
 */
@Module({
  imports: [ResponseModule],
  controllers: [AIAgentsStatusController],
})
export class StoreAIAgentsModule {}
