import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { NotificationSoundsController } from './notification-sounds.controller';
import { NotificationSoundsService } from './notification-sounds.service';

@Module({
  imports: [ResponseModule, S3Module],
  controllers: [NotificationSoundsController],
  providers: [NotificationSoundsService, GlobalPrismaService],
  exports: [NotificationSoundsService],
})
export class NotificationSoundsModule {}
