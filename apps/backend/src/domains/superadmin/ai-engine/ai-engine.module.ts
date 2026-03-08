import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineController } from './ai-engine.controller';
import { AIEngineConfigService } from './ai-engine.service';
import { AIEngineAppsController } from './ai-engine-apps.controller';
import { AIEngineAppsService } from './ai-engine-apps.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AIEngineAppsController, AIEngineController],
  providers: [AIEngineConfigService, AIEngineAppsService],
  exports: [AIEngineConfigService, AIEngineAppsService],
})
export class AIEngineConfigModule {}
