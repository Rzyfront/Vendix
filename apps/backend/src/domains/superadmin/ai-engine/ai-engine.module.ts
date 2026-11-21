import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineController } from './ai-engine.controller';
import { AIEngineConfigService } from './ai-engine.service';
import { AIEngineAppsController } from './ai-engine-apps.controller';
import { AIEngineAppsService } from './ai-engine-apps.service';
import { AIAgentsController } from './ai-agents.controller';
import { AIAgentsService } from './ai-agents.service';
import { AISkillsController } from './ai-skills.controller';
import { AISkillsService } from './ai-skills.service';
import { SkillsModule } from '../../../ai-engine/skills/skills.module';

@Module({
  imports: [PrismaModule, ResponseModule, SkillsModule],
  // Orden intencional: los controladores con prefijo largo van antes que
  // AIEngineController, cuyo @Get(':id') atraparía '/agents' como id='agents'.
  controllers: [
    AIEngineAppsController,
    AIAgentsController,
    AISkillsController,
    AIEngineController,
  ],
  providers: [
    AIEngineConfigService,
    AIEngineAppsService,
    AIAgentsService,
    AISkillsService,
  ],
  exports: [AIEngineConfigService, AIEngineAppsService, AIAgentsService],
})
export class AIEngineConfigModule {}
