import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { MenuEngineeringService } from './menu-engineering.service';

/**
 * Menu Engineering analytics (Restaurant Suite — Fase G).
 *
 * Returns the BCG matrix (estrella / caballo / puzzle / perro) using
 * recipe-driven cost when the product has an active recipe, falling back
 * to product.cost_price when not.
 */
@Controller('store/menus/engineering-report')
@UseGuards(PermissionsGuard)
export class MenuEngineeringController {
  constructor(
    private readonly engineeringService: MenuEngineeringService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:menu_engineering:read')
  async report(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    try {
      const data = await this.engineeringService.report({ from, to });
      return this.responseService.success(data, 'Ingeniería de menú');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al generar el reporte de ingeniería',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
