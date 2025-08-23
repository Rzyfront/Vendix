import { Module } from '@nestjs/common';
import { DomainSettingsService } from '../services/domain-settings.service';
import { DomainSettingsController } from '../controllers/domain-settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DomainSettingsController],
  providers: [DomainSettingsService],
  exports: [DomainSettingsService],
})
export class DomainSettingsModule {}
