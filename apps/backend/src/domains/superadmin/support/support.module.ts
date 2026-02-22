import { Module } from '@nestjs/common';
import { SuperadminSupportController } from './support.controller';
import { SuperadminSupportService } from './support.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { SupportNotificationsModule } from '../../support/notifications/support-notifications.module';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    SupportNotificationsModule,
  ],
  controllers: [SuperadminSupportController],
  providers: [SuperadminSupportService],
  exports: [SuperadminSupportService],
})
export class SuperadminSupportModule {}
