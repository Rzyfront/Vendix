import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { PayrollSettingsService } from '@common/services/payroll-settings.service';
import { OrgPayrollSettingsController } from './payroll-settings.controller';

/**
 * Minimal payroll settings module (organization scope). Mirrors
 * `StorePayrollSettingsModule` and persists into
 * `organization_settings.settings.payroll.minimal`.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [OrgPayrollSettingsController],
  providers: [PayrollSettingsService],
  exports: [PayrollSettingsService],
})
export class OrgPayrollSettingsModule {}
