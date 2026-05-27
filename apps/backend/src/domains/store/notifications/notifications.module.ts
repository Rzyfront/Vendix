import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationSoundsCatalogController } from './notification-sounds-catalog.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSoundsCatalogService } from './notification-sounds-catalog.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationsEventsListener } from './notifications-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailModule } from '../../../email/email.module';
import { S3Module } from '../../../common/services/s3.module';

@Module({
  imports: [ResponseModule, PrismaModule, EmailModule, S3Module],
  controllers: [NotificationsController, NotificationSoundsCatalogController],
  providers: [
    NotificationsService,
    NotificationsSseService,
    NotificationsPushService,
    NotificationsEventsListener,
    NotificationSoundsCatalogService,
  ],
  exports: [NotificationsService, NotificationsPushService],
})
export class NotificationsModule {}
