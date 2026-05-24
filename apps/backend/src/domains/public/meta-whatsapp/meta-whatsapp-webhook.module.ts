import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { MetaWhatsappWebhookController } from './meta-whatsapp-webhook.controller';
import { MetaWhatsappWebhookService } from './meta-whatsapp-webhook.service';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [MetaWhatsappWebhookController],
  providers: [MetaWhatsappWebhookService, SocialChannelEncryptionService],
})
export class MetaWhatsappWebhookModule {}
