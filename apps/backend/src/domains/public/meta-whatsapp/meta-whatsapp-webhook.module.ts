import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { MetaWhatsappWebhookController } from './meta-whatsapp-webhook.controller';
import { MetaWhatsappWebhookService } from './meta-whatsapp-webhook.service';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';
import { CRM_INBOUND_QUEUE } from './inbound/crm-inbound.constants';
import { CrmInboundQueue } from './inbound/crm-inbound.queue';
import { CrmInboundProcessor } from './inbound/crm-inbound.processor';
import { MetaWhatsappInboundService } from './inbound/meta-whatsapp-inbound.service';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    BullModule.registerQueue({ name: CRM_INBOUND_QUEUE }),
  ],
  controllers: [MetaWhatsappWebhookController],
  providers: [
    MetaWhatsappWebhookService,
    SocialChannelEncryptionService,
    S3PathHelper,
    CrmInboundQueue,
    CrmInboundProcessor,
    MetaWhatsappInboundService,
  ],
})
export class MetaWhatsappWebhookModule {}
