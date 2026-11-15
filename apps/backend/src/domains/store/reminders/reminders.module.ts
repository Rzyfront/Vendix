import { Module, OnModuleInit } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createReminderTools } from '../../../ai-engine/tools/domains/reminders.tools';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { UserReminderDueJob } from './user-reminder-due.job';

/**
 * QUI-580 — personal reminders log (bitácora): CRUD API, the one-time due
 * notification job and the Vex tools. The Prisma services, Redis and the
 * `AIToolRegistry` come from global modules.
 */
@Module({
  imports: [ResponseModule, NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersService, UserReminderDueJob],
  exports: [RemindersService],
})
export class RemindersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly remindersService: RemindersService,
  ) {}

  /** Decentralized registration in the owning module (vendix-ai-agent-tools). */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createReminderTools({ remindersService: this.remindersService }),
    );
  }
}
