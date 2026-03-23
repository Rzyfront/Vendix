import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationsEventsListener } from './notifications-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailModule } from '../../../email/email.module';
import { S3Module } from '../../../common/services/s3.module';

@Module({
  imports: [ResponseModule, PrismaModule, EmailModule, S3Module],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsSseService,
    NotificationsPushService,
    NotificationsEventsListener,
  ],
  exports: [NotificationsService, NotificationsPushService],
})
export class NotificationsModule {}
