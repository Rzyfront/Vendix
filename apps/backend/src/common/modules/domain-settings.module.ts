import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainSettingsService } from '../services/domain-settings.service';
import { DomainSettingsController } from '../controllers/domain-settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { DomainResolutionService } from '../services/domain-resolution.service';

@Module({
  imports: [PrismaModule, EventEmitterModule.forRoot({ wildcard: false })],
  controllers: [DomainSettingsController],
  providers: [DomainSettingsService, DomainResolutionService],
  exports: [DomainSettingsService, DomainResolutionService],
})
export class DomainSettingsModule {}
