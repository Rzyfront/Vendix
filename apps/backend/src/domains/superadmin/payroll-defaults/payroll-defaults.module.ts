import { Module } from '@nestjs/common';
import { PayrollDefaultsController } from './payroll-defaults.controller';
import { PayrollDefaultsService } from './payroll-defaults.service';
import { PayrollDefaultsNotificationsListener } from './payroll-defaults-notifications.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';

@Module({
  imports: [ResponseModule, NotificationsModule],
  controllers: [PayrollDefaultsController],
  providers: [
    PayrollDefaultsService,
    PayrollDefaultsNotificationsListener,
  ],
  exports: [PayrollDefaultsService],
})
export class PayrollDefaultsModule {}
