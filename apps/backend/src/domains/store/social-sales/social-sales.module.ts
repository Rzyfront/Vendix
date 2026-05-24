import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { MetaWhatsappEmbeddedSignupService } from './meta-whatsapp-embedded-signup.service';
import { SocialChannelEncryptionService } from './social-channel-encryption.service';
import { SocialSalesController } from './social-sales.controller';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [SocialSalesController],
  providers: [
    MetaWhatsappEmbeddedSignupService,
    SocialChannelEncryptionService,
  ],
  exports: [MetaWhatsappEmbeddedSignupService],
})
export class SocialSalesModule {}
