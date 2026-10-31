import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../../../common/responses/response.module';
import { CrmConversationsController } from './crm-conversations.controller';
import { CrmConversationsService } from './crm-conversations.service';

/**
 * Inbox of the store CRM (PLAN-CRM §4.3). `MessagingModule`, `RedisModule`,
 * `StorageModule`, `AuditModule` and the Prisma services are global.
 */
@Module({
  imports: [ResponseModule],
  controllers: [CrmConversationsController],
  providers: [CrmConversationsService],
})
export class CrmInboxModule {}
