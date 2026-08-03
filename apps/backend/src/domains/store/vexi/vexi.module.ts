import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createBusinessTools } from '../../../ai-engine/tools/domains/business.tools';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineModule } from '../../../ai-engine/ai-engine.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SettingsModule } from '../settings/settings.module';
import { WeeklyReportModule } from '../weekly-report/weekly-report.module';
import { VexiRealtimeController } from './vexi-realtime.controller';
import { VexiRealtimeService } from './vexi-realtime.service';
import { VexiController } from './vexi.controller';
import { VexiContextService } from './vexi-context.service';
import { VexiStreamIntentService } from './vexi-stream-intent.service';
import { VexiEnabledGuard } from './guards/vexi-enabled.guard';

/**
 * Vexi realtime voice and business context. Text chat still lives in
 * `AIChatModule` under `store/ai-chat` — that contract is unchanged; Vexi is
 * the product name for the assistant, not a rename of the persistence layer.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    AIEngineModule,
    SubscriptionsModule,
    SettingsModule,
    WeeklyReportModule,
  ],
  controllers: [VexiRealtimeController, VexiController],
  providers: [
    VexiRealtimeService,
    VexiContextService,
    VexiStreamIntentService,
    VexiEnabledGuard,
  ],
  exports: [VexiRealtimeService, VexiContextService, VexiStreamIntentService],
})
export class VexiModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly vexiContext: VexiContextService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createBusinessTools({ vexiContext: this.vexiContext }),
    );
  }
}
