import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Settings')
@Controller('organization/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Permissions('organization_settings:read')
  @ApiOperation({ summary: 'Get organization settings' })
  @ApiResponse({
    status: 200,
    description: 'Organization settings retrieved successfully',
  })
  async findOne() {
    return this.settingsService.findOne();
  }

  @Put()
  @Permissions('organization_settings:update')
  @ApiOperation({ summary: 'Update organization settings' })
  @ApiResponse({
    status: 200,
    description: 'Organization settings updated successfully',
  })
  async update(@Body() updateDto: UpdateSettingsDto) {
    return this.settingsService.update(updateDto);
  }
}
