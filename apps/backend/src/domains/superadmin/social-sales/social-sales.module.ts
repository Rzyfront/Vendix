import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { ChannelEncryptionService } from '../../store/integrations/channels/channel-encryption.service';
import { MetaWhatsappPlatformConfigController } from './meta-whatsapp-platform-config.controller';
import { MetaWhatsappPlatformConfigService } from './meta-whatsapp-platform-config.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [MetaWhatsappPlatformConfigController],
  providers: [
    MetaWhatsappPlatformConfigService,
    ChannelEncryptionService,
  ],
  exports: [MetaWhatsappPlatformConfigService],
})
export class SuperadminSocialSalesModule {}
