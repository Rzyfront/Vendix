import { Module } from '@nestjs/common';
import { SupportNotificationsService } from './support-notifications.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EmailModule } from '../../../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [
    SupportNotificationsService,
    GlobalPrismaService,
  ],
  exports: [SupportNotificationsService],
})
export class SupportNotificationsModule {}
