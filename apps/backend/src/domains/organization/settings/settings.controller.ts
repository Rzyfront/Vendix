import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Organization Settings')
@Controller('organization/settings')
@UseGuards(PermissionsGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) { }

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
}
