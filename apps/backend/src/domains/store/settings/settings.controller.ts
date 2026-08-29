import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { ScheduleValidationService } from './schedule-validation.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { IsString } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { UpdateStoreFiscalDataDto } from './dto/update-store-fiscal-data.dto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

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
    private readonly scheduleValidationService: ScheduleValidationService,
    private readonly responseService: ResponseService,
    private readonly storePrisma: StorePrismaService,
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

  /**
   * Public endpoint — no auth required. Returns ONLY non-sensitive UI
   * flags that the storefront needs before the user is authenticated
   * (e.g. the high-conversion UI toggle that controls celebration
   * badges in the cart drawer). Sensitive settings (fiscal data,
   * business hours, payment config) are NOT exposed here.
   *
   * Consumed by HighConversionService in the cart drawer for guests.
   *
   * For now uses Prisma to find the first store. Future improvement:
   * accept `?store_id=X` query param or read from `x-store-id` header
   * for multi-store deployments.
   */
  @Get('public')
  @Public()
  @ApiOperation({
    summary: 'Get public UI flags (no auth required)',
  })
  @ApiResponse({
    status: 200,
    description: 'Public UI flags retrieved successfully',
  })
  async getPublicFlags() {
    // TODO multi-store: read from x-store-id header or ?store_id query
    const store = await this.storePrisma.store.findFirst({
      where: { is_active: true, deleted_at: null },
      orderBy: { id: 'asc' },
    });
    if (!store) {
      return this.responseService.success({
        enable_high_conversion_ui: true,
      });
    }
    // Read the raw settings row to avoid the store-context requirement
    // in SettingsService.getSettings(). This endpoint is public.
    const row = await this.storePrisma.store_settings.findFirst({
      where: { store_id: store.id },
      select: { settings: true },
    });
    const promotions = (row?.settings as any)?.promotions ?? {};
    return this.responseService.success({
      enable_high_conversion_ui:
        promotions.enable_high_conversion_ui !== false,
    });
  }

  @Get('schedule-status')
  @Permissions('store:pos:access')
  @ApiOperation({ summary: 'Get POS schedule validation status' })
  @ApiResponse({
    status: 200,
    description: 'Schedule status retrieved successfully',
  })
  async getScheduleStatus() {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      return this.responseService.error('Store context required');
    }

    // Verificar si el usuario es admin
    const isAdmin =
      await this.scheduleValidationService.canBypassScheduleCheck();

    // Obtener el estado de validación
    const validation =
      await this.scheduleValidationService.validateBusinessHours(storeId);

    return this.responseService.success({
      ...validation,
      isAdmin,
      canBypass: isAdmin,
    });
  }

  @Patch()
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Update store settings (overwrite sections)' })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
  })
  // Body intentionally typed as a plain record so deprecated keys are not
  // rejected by the global ValidationPipe before reaching the service.
  // The service runs `sanitizeAndValidate(raw)` to drop unknown keys and
  // validate retained sections against `UpdateSettingsDto`.
  async updateSettings(@Body() raw: Record<string, unknown>) {
    await this.settingsService.updateSettings(raw);
    // Re-read via getSettings() to return the full projection (including app from branding)
    const settings = await this.settingsService.getSettings();
    return this.responseService.success(
      settings,
      'Settings updated successfully',
    );
  }

  @Patch('fiscal-data')
  @Permissions('store:settings:fiscal_data:write')
  @ApiOperation({
    summary:
      'Patch the legal/tax identity (fiscal_data) section of store settings',
  })
  @ApiResponse({
    status: 200,
    description: 'Fiscal data section updated successfully',
  })
  async updateFiscalData(@Body() dto: UpdateStoreFiscalDataDto) {
    const fiscalData = await this.settingsService.updateFiscalData(
      dto as unknown as Record<string, unknown>,
    );
    return this.responseService.success(
      { fiscal_data: fiscalData },
      'Fiscal data updated successfully',
    );
  }

  @Get('fiscal-data')
  @Permissions('store:settings:fiscal_data:read')
  @ApiOperation({
    summary:
      'Get the legal/tax identity (fiscal_data) section for the current fiscal scope',
  })
  @ApiResponse({
    status: 200,
    description: 'Fiscal data section returned successfully',
  })
  async getFiscalData() {
    const fiscalData = await this.settingsService.getFiscalData();
    return this.responseService.success({ fiscal_data: fiscalData });
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
