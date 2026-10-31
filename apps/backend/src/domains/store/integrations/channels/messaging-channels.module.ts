import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../../common/responses/response.module';
import { MessagingChannelsController } from './messaging-channels.controller';
import { MessagingChannelsService } from './messaging-channels.service';

/**
 * SMS and email channel settings. `MessagingModule` (for `SmsSpendService`),
 * `AuditModule` and the Prisma services are global.
 */
@Module({
  imports: [ResponseModule],
  controllers: [MessagingChannelsController],
  providers: [MessagingChannelsService],
})
export class MessagingChannelsModule {}
