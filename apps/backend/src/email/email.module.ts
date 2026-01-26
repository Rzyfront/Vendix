import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailBrandingService } from './services/email-branding.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [EmailController],
  providers: [EmailService, EmailBrandingService],
  exports: [EmailService, EmailBrandingService],
})
export class EmailModule {}
