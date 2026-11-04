import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AppsService } from './apps.service';
import { AppKindParamDto } from './dto';

/**
 * Apps — catálogo de aplicaciones web por tienda: listado liviano, detalle de
 * cada app para su vista y encender/apagar (apps-vistas-f1 S2/S3). Publicar y
 * configurar viven en el sub-controller de cada app.
 */
@Controller('store/apps')
@UseGuards(PermissionsGuard)
export class AppsController {
  constructor(
    private readonly appsService: AppsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('store:apps:read')
  @Get()
  async list() {
    const result = await this.appsService.list();
    return this.responseService.success(result);
  }

  @Permissions('store:apps:read')
  @Get(':kind')
  async get(@Param() params: AppKindParamDto) {
    const result = await this.appsService.get(params.kind);
    return this.responseService.success(result);
  }

  @Permissions('store:apps:manage')
  @Post(':kind/activate')
  async activate(@Param() params: AppKindParamDto) {
    const result = await this.appsService.activate(params.kind);
    return this.responseService.success(result, 'App encendida');
  }

  @Permissions('store:apps:manage')
  @Post(':kind/deactivate')
  async deactivate(@Param() params: AppKindParamDto) {
    const result = await this.appsService.deactivate(params.kind);
    return this.responseService.success(result, 'App apagada');
  }
}
