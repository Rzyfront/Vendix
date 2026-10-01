import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { NotificationSoundsController } from './notification-sounds.controller';
import { NotificationSoundsService } from './notification-sounds.service';

@Module({
  imports: [ResponseModule, S3Module],
  controllers: [NotificationSoundsController],
  providers: [NotificationSoundsService],
  exports: [NotificationSoundsService],
})
export class NotificationSoundsModule {}
