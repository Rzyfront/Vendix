import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { MetaWhatsappEmbeddedSignupService } from './meta-whatsapp-embedded-signup.service';
import { ChannelEncryptionService } from './channel-encryption.service';
import { ChannelsController } from './channels.controller';
import { SocialSalesLegacyController } from './social-sales-legacy.controller';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [ChannelsController, SocialSalesLegacyController],
  providers: [MetaWhatsappEmbeddedSignupService, ChannelEncryptionService],
  exports: [MetaWhatsappEmbeddedSignupService, ChannelEncryptionService],
})
export class ChannelsModule {}
