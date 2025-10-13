import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BypassEmailController } from './bypass-email.controller';
import { DevelopmentOnlyGuard } from '../../common/guards/development-only.guard';

@Module({
  controllers: [BypassEmailController],
  providers: [PrismaService, ConfigService, DevelopmentOnlyGuard],
})
export class BypassEmailModule {}