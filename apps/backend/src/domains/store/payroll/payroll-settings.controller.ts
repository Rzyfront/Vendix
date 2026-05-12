import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PayrollSettingsService } from '@common/services/payroll-settings.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UpdatePayrollSettingsDto } from '@common/dto/payroll-settings.dto';

/**
 * Store-scoped minimal payroll configuration endpoint used by the
 * onboarding wizard PayrollConfigStep. The per-year rate matrix is
 * still owned by `PayrollRulesController` at `store/payroll/rules`.
 */
@ApiTags('Store Payroll Settings')
@Controller('store/payroll/settings')
@UseGuards(PermissionsGuard)
export class StorePayrollSettingsController {
  constructor(
    private readonly payrollSettings: PayrollSettingsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:payroll:settings:read')
  @ApiOperation({
    summary: 'Get minimal payroll settings for the current store',
  })
  async getSettings() {
    const data = await this.payrollSettings.getSettings('store');
    return this.response.success(data);
  }

  @Put()
  @Permissions('store:payroll:settings:write')
  @ApiOperation({
    summary: 'Replace minimal payroll settings for the current store',
  })
  async updateSettings(@Body() dto: UpdatePayrollSettingsDto) {
    const data = await this.payrollSettings.updateSettings('store', dto);
    return this.response.updated(data, 'Payroll settings updated');
  }
}
