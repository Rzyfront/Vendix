import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../../../email/email.module';
import { ServiceRemindersController } from './service-reminders.controller';
import { ServiceRemindersService } from './service-reminders.service';

@Module({
  imports: [ResponseModule, NotificationsModule, EmailModule],
  controllers: [ServiceRemindersController],
  providers: [ServiceRemindersService],
  exports: [ServiceRemindersService],
})
export class ServiceRemindersModule {}
