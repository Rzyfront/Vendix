import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { UserReminderDueJob } from './user-reminder-due.job';

/**
 * QUI-580 — personal reminders log (bitácora): CRUD API and the one-time due
 * notification job. The Prisma services come from global modules.
 */
@Module({
  imports: [ResponseModule, NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersService, UserReminderDueJob],
  exports: [RemindersService],
})
export class RemindersModule {}
