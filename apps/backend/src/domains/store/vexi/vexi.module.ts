import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createBusinessTools } from '../../../ai-engine/tools/domains/business.tools';
import { createTaskTools } from '../../../ai-engine/tools/domains/tasks.tools';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineModule } from '../../../ai-engine/ai-engine.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SettingsModule } from '../settings/settings.module';
import { WeeklyReportModule } from '../weekly-report/weekly-report.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VexiRealtimeController } from './vexi-realtime.controller';
import { VexiRealtimeService } from './vexi-realtime.service';
import { VexiController } from './vexi.controller';
import { VexiContextService } from './vexi-context.service';
import { VexiStreamIntentService } from './vexi-stream-intent.service';
import { VexiTaskService } from './vexi-task.service';
import { VexiActivityService } from './vexi-activity.service';
import { VexiAttachmentsService } from './vexi-attachments.service';
import { VexiEnabledGuard } from './guards/vexi-enabled.guard';

/**
 * Vexi realtime voice and business context. Text chat still lives in
 * `AIChatModule` under `store/ai-chat` — that contract is unchanged; Vexi is
 * the product name for the assistant, not a rename of the persistence layer.
 *
 * Note which services are NOT provided here: `VexiAttachmentsService`,
 * `VexiUiChannelService` and `VexiConfirmationService` live in this folder but are
 * provided by `AIEngineModule`, because the tool registry and the agent loop depend
 * on them and that module is `@Global()` — providing them in both places would give
 * the two consumers different instances of a service whose whole job is correlating
 * state across them.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    AIEngineModule,
    SubscriptionsModule,
    SettingsModule,
    WeeklyReportModule,
    // A background task's only way to reach the person after they walked away.
    NotificationsModule,
  ],
  controllers: [VexiRealtimeController, VexiController],
  providers: [
    VexiRealtimeService,
    VexiContextService,
    VexiStreamIntentService,
    VexiTaskService,
    VexiActivityService,
    VexiEnabledGuard,
  ],
  exports: [
    VexiRealtimeService,
    VexiContextService,
    VexiStreamIntentService,
    VexiTaskService,
  ],
})
export class VexiModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly vexiContext: VexiContextService,
    private readonly tasks: VexiTaskService,
    private readonly attachments: VexiAttachmentsService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createBusinessTools({ vexiContext: this.vexiContext }),
    );
    // Registered from here rather than from AIEngineModule because
    // `VexiTaskService` needs the notifications stack, and importing that into a
    // `@Global()` module is how cycles start.
    this.toolRegistry.registerMany(
      createTaskTools({
        tasks: this.tasks,
        attachments: this.attachments,
      }),
    );
  }
}
