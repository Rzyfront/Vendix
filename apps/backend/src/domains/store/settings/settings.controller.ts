import { Controller, Get, Patch, Post, Body, UseGuards, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { ResponseService } from '@common/responses/response.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { IsString } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';

export class ApplyTemplateDto {
  @IsString()
  template_name: string;
}

@ApiTags('Store Settings')
@Controller('store/settings')
@UseGuards(PermissionsGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:settings:read')
  @ApiOperation({ summary: 'Get current store settings' })
  @ApiResponse({
    status: 200,
    description: 'Store settings retrieved successfully',
  })
  async getSettings() {
    const settings = await this.settingsService.getSettings();
    return this.responseService.success(settings);
  }

  @Patch()
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Update store settings (overwrite sections)' })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
  })
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: false, // Permitir propiedades no definidas para updates parciales
    forbidNonWhitelisted: false,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }))
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    const settings = await this.settingsService.updateSettings(dto);
    return this.responseService.success(
      settings,
      'Settings updated successfully',
    );
  }

  @Post('reset')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Reset settings to defaults' })
  @ApiResponse({
    status: 200,
    description: 'Settings reset to defaults',
  })
  async resetToDefault() {
    const settings = await this.settingsService.resetToDefault();
    return this.responseService.success(settings, 'Settings reset to defaults');
  }

  @Get('templates')
  @Permissions('store:settings:read')
  @ApiOperation({ summary: 'Get available system templates' })
  @ApiResponse({
    status: 200,
    description: 'Templates retrieved successfully',
  })
  async getSystemTemplates() {
    const templates = await this.settingsService.getSystemTemplates();
    return this.responseService.success(templates);
  }

  @Post('apply-template')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Apply a system template to store' })
  @ApiResponse({
    status: 200,
    description: 'Template applied successfully',
  })
  async applyTemplate(@Body() body: ApplyTemplateDto) {
    const settings = await this.settingsService.applyTemplate(
      body.template_name,
    );
    return this.responseService.success(
      settings,
      'Template applied successfully',
    );
  }
}
