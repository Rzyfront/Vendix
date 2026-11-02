import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AppsService } from './apps.service';
import { AppKindParamDto } from './dto';

/** Apps — catálogo de aplicaciones web por tienda (Fase 0: solo lectura). */
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
}
