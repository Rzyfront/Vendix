import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { PayrollSettingsService } from '@common/services/payroll-settings.service';
import { StorePayrollSettingsController } from './payroll-settings.controller';

/**
 * Minimal payroll settings module (store scope). Lives alongside the
 * legacy `PayrollModule` to keep wizard configuration concerns
 * isolated from the broader payroll-runs/employees surface.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [StorePayrollSettingsController],
  providers: [PayrollSettingsService],
  exports: [PayrollSettingsService],
})
export class StorePayrollSettingsModule {}
