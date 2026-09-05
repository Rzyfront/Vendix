import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmController } from './controllers/crm.controller';
import { CrmPublicController } from './controllers/crm-public.controller';
import { CrmService } from './services/crm.service';
import { CrmGenerationService } from './services/crm-generation.service';
import { CrmPublicService } from './services/crm-public.service';
import { CrmLandingProcessor } from './processors/crm-landing.processor';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../../../email/email.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    SettingsModule,
    AnalyticsModule,
    CustomersModule,
    NotificationsModule,
    EmailModule,
    // Cola dedicada del CRM (patrón receipt-scan): no compartir ai-generation.
    BullModule.registerQueue({ name: 'crm-landing' }),
  ],
  controllers: [CrmController, CrmPublicController],
  providers: [CrmService, CrmGenerationService, CrmPublicService, CrmLandingProcessor],
  exports: [CrmService],
})
export class CrmModule {}
