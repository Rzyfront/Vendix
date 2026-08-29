import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmController } from './controllers/crm.controller';
import { CrmService } from './services/crm.service';
import { CrmGenerationService } from './services/crm-generation.service';
import { CrmLandingProcessor } from './processors/crm-landing.processor';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    SettingsModule,
    AnalyticsModule,
    // Cola dedicada del CRM (patrón receipt-scan): no compartir ai-generation.
    BullModule.registerQueue({ name: 'crm-landing' }),
  ],
  controllers: [CrmController],
  providers: [CrmService, CrmGenerationService, CrmLandingProcessor],
  exports: [CrmService],
})
export class CrmModule {}
