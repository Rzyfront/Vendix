import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { resolveStoreTimezone } from '../../../common/utils/store-timezone.util';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import {
  createFollowupTools,
  currentTurnKey,
} from '../../../ai-engine/tools/domains/followup.tools';
import { VexiModule } from '../vexi/vexi.module';
import { VexModule } from '../vex/vex.module';
import { RemindersModule } from '../reminders/reminders.module';
import { RemindersService } from '../reminders/reminders.service';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';
import { ConversationTitleService } from './conversation-title.service';
import { ConversationPurgeService } from './conversation-purge.service';
import { ConversationPurgeS3Cleaner } from './conversation-purge-s3.cleaner';
import { VexFollowupService } from './vex-followup.service';

// One-way dependency: chat consumes Vexi's business snapshot, Vexi never
// consumes chat. Keep it that way — VexiModule importing this back would
// close a cycle through the @Global() AIEngineModule. Same for `VexModule`
// (block selections as turn context) and `RemindersModule` (follow-up cards
// saved into the bitácora): neither must ever import this back.
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    VexiModule,
    VexModule,
    RemindersModule,
  ],
  controllers: [AIChatController],
  providers: [
    AIChatService,
    ConversationTitleService,
    ConversationPurgeService,
    ConversationPurgeS3Cleaner,
    VexFollowupService,
  ],
  exports: [AIChatService],
})
export class AIChatModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly prisma: StorePrismaService,
    private readonly reminders: RemindersService,
    private readonly followups: VexFollowupService,
  ) {}

  /**
   * `suggest_followup` (F1/T5) is registered here and not in
   * `RemindersModule`: its guards read the Vex thread (muted flag, cards
   * already shown), which only this module owns.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createFollowupTools({
        remindersService: this.reminders,
        conversations: this.followups,
        resolveTimezone: (storeId) => resolveStoreTimezone(this.prisma, storeId),
        turnKey: currentTurnKey,
      }),
    );
  }
}
