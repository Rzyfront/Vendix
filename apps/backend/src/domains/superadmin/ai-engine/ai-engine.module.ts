import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineController } from './ai-engine.controller';
import { AIEngineConfigService } from './ai-engine.service';
import { AIEngineAppsController } from './ai-engine-apps.controller';
import { AIEngineAppsService } from './ai-engine-apps.service';
import { AIAgentsController } from './ai-agents.controller';
import { AIAgentsService } from './ai-agents.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AIEngineAppsController, AIEngineController, AIAgentsController],
  providers: [AIEngineConfigService, AIEngineAppsService, AIAgentsService],
  exports: [AIEngineConfigService, AIEngineAppsService, AIAgentsService],
})
export class AIEngineConfigModule {}
