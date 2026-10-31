import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessagingService } from './messaging.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialChannelEncryptionService } from '../domains/store/social-sales/social-channel-encryption.service';
import { ConsoleMessagingProvider } from './providers/console.provider';
import { MetaCloudMessagingProvider } from './providers/meta-cloud.provider';
import { CRM_OUTBOUND_QUEUE } from './queue/crm-outbound.constants';
import { CrmOutboundQueue } from './queue/crm-outbound.queue';
import { CrmOutboundProcessor } from './queue/crm-outbound.processor';

@Global()
@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: CRM_OUTBOUND_QUEUE }),
  ],
  providers: [
    MessagingService,
    SocialChannelEncryptionService,
    ConsoleMessagingProvider,
    MetaCloudMessagingProvider,
    CrmOutboundQueue,
    CrmOutboundProcessor,
  ],
  exports: [MessagingService, CrmOutboundQueue],
})
export class MessagingModule {}
