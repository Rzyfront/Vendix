import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';
import { MetaWhatsappPlatformConfigController } from './meta-whatsapp-platform-config.controller';
import { MetaWhatsappPlatformConfigService } from './meta-whatsapp-platform-config.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [MetaWhatsappPlatformConfigController],
  providers: [
    MetaWhatsappPlatformConfigService,
    SocialChannelEncryptionService,
  ],
  exports: [MetaWhatsappPlatformConfigService],
})
export class SuperadminSocialSalesModule {}
