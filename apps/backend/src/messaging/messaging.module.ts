import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessagingService } from './messaging.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ChannelEncryptionService } from '../domains/store/integrations/channels/channel-encryption.service';
import { ConsoleMessagingProvider } from './providers/console.provider';
import { MetaCloudMessagingProvider } from './providers/meta-cloud.provider';
import { SnsSmsMessagingProvider } from './providers/sns-sms.provider';
import { SesEmailMessagingProvider } from './providers/ses-email.provider';
import { SmsSpendService } from './spend/sms-spend.service';
import { EmailModule } from '../email/email.module';
import { CRM_OUTBOUND_QUEUE } from './queue/crm-outbound.constants';
import { CrmOutboundQueue } from './queue/crm-outbound.queue';
import { CrmOutboundProcessor } from './queue/crm-outbound.processor';
import { CrmInboxEventsService } from './events/crm-inbox-events.service';

@Global()
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    BullModule.registerQueue({ name: CRM_OUTBOUND_QUEUE }),
  ],
  providers: [
    MessagingService,
    ChannelEncryptionService,
    ConsoleMessagingProvider,
    MetaCloudMessagingProvider,
    SnsSmsMessagingProvider,
    SesEmailMessagingProvider,
    SmsSpendService,
    CrmOutboundQueue,
    CrmOutboundProcessor,
    CrmInboxEventsService,
  ],
  exports: [
    MessagingService,
    CrmOutboundQueue,
    CrmInboxEventsService,
    SmsSpendService,
  ],
})
export class MessagingModule {}
