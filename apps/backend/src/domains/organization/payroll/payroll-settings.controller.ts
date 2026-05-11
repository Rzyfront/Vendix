import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PayrollSettingsService } from '@common/services/payroll-settings.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UpdatePayrollSettingsDto } from '@common/dto/payroll-settings.dto';

/**
 * Organization-scoped minimal payroll configuration endpoint used by
 * the org onboarding wizard PayrollConfigStep. Persists to
 * `organization_settings.settings.payroll.minimal`.
 */
@ApiTags('Organization Payroll Settings')
@Controller('organization/payroll/settings')
@UseGuards(PermissionsGuard)
export class OrgPayrollSettingsController {
  constructor(
    private readonly payrollSettings: PayrollSettingsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('organization:payroll:settings:read')
  @ApiOperation({
    summary: 'Get minimal payroll settings for the current organization',
  })
  async getSettings() {
    const data = await this.payrollSettings.getSettings('organization');
    return this.response.success(data);
  }

  @Put()
  @Permissions('organization:payroll:settings:write')
  @ApiOperation({
    summary: 'Replace minimal payroll settings for the current organization',
  })
  async updateSettings(@Body() dto: UpdatePayrollSettingsDto) {
    const data = await this.payrollSettings.updateSettings('organization', dto);
    return this.response.updated(data, 'Payroll settings updated');
  }
}
