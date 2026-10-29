import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ManufacturingSettingsService } from './manufacturing-settings.service';
import { UpdateManufacturingSettingsDto } from '../dto';

/** Configuración de planta. Los errores se propagan al filtro global. */
@Controller('store/manufacturing/settings')
@UseGuards(PermissionsGuard)
export class ManufacturingSettingsController {
  constructor(
    private readonly settingsService: ManufacturingSettingsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:manufacturing:settings:read')
  async get() {
    const result = await this.settingsService.get();
    return this.responseService.success(
      result,
      'Configuración de planta obtenida exitosamente',
    );
  }

  @Patch()
  @Permissions('store:manufacturing:settings:update')
  async update(@Body() dto: UpdateManufacturingSettingsDto) {
    const result = await this.settingsService.update(dto);
    return this.responseService.updated(
      result,
      'Configuración de planta actualizada exitosamente',
    );
  }
}
