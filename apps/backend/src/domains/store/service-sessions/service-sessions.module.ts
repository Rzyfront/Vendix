import { Module } from '@nestjs/common';
import { ServiceIndustryGuard } from '../../../common/guards/service-industry.guard';
import { ResponseModule } from '@common/responses/response.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ServiceSessionsController } from './service-sessions.controller';
import { ServiceSessionsService } from './service-sessions.service';
import { ServiceAllocationModule } from '../reservations/service-allocation.module';
import { ServiceSessionAccessModule } from '../../ecommerce/service-sessions/service-session-access.module';
import { EmailModule } from '../../../email/email.module';
import { DataCollectionModule } from '../data-collection/data-collection.module';

@Module({
  imports: [ResponseModule, NotificationsModule, SettingsModule, ServiceAllocationModule, ServiceSessionAccessModule, EmailModule, DataCollectionModule],
  controllers: [ServiceSessionsController],
  providers: [ServiceSessionsService, ServiceIndustryGuard],
  exports: [ServiceSessionsService],
})
export class ServiceSessionsModule {}
