import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto, UpdateOrgInventorySettingsDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Settings')
@Controller('organization/settings')
@UseGuards(PermissionsGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Permissions('organization:settings:read')
  @ApiOperation({ summary: 'Get organization settings' })
  @ApiResponse({
    status: 200,
    description: 'Organization settings retrieved successfully',
  })
  async findOne() {
    return this.settingsService.findOne();
  }

  @Put()
  @Permissions('organization:settings:update')
  @ApiOperation({ summary: 'Update organization settings' })
  @ApiResponse({
    status: 200,
    description: 'Organization settings updated successfully',
  })
  async update(@Body() updateDto: UpdateSettingsDto) {
    return this.settingsService.update(updateDto);
  }

  // ---------------------------------------------------------------------------
  // Inventory section (Plan Unificado P3.2 — costing_method)
  //
  // Permission strings: `organization:settings:inventory:{read,write}`. ORG_ADMIN
  // and owner roles las heredan automáticamente porque el seeder aplica
  // `p.name.startsWith('organization:')` (ver `permissions-roles.seed.ts`).
  // ---------------------------------------------------------------------------

  @Get('inventory')
  @Permissions('organization:settings:inventory:read')
  @ApiOperation({
    summary:
      'Get the organization-level inventory settings (mode, costing_method, alerts).',
  })
  @ApiResponse({
    status: 200,
    description: 'Inventory section returned merged with defaults.',
  })
  async getInventory() {
    return this.settingsService.getInventory();
  }

  @Put('inventory')
  @Permissions('organization:settings:inventory:write')
  @ApiOperation({
    summary:
      'Update the organization-level inventory settings (currently only `costing_method`). LIFO is rejected.',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated inventory section.',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failure (e.g. lifo or cpp not allowed).',
  })
  async updateInventory(@Body() dto: UpdateOrgInventorySettingsDto) {
    return this.settingsService.updateInventory(dto);
  }
}
