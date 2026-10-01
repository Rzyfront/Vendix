import { Module } from '@nestjs/common';
import { SupportNotificationsService } from './support-notifications.service';
import { EmailModule } from '../../../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [SupportNotificationsService],
  exports: [SupportNotificationsService],
})
export class SupportNotificationsModule {}
