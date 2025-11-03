import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { BypassEmailController } from './bypass-email.controller';
import { DevelopmentOnlyGuard } from '../../common/guards/development-only.guard';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [BypassEmailController],
  providers: [ConfigService, DevelopmentOnlyGuard],
})
export class BypassEmailModule {}
