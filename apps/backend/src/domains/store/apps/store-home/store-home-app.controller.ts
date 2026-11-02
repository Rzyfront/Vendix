import { Body, Controller, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { StoreHomeAppService } from './store-home-app.service';
import { UpdateStoreHomeConfigDto } from './store-home.dto';

/**
 * Apps · store home (Fase 5): owner/admin configuration of the entry page of
 * `{tienda}-store`. Reading the app stays on `GET /store/apps/store_home`
 * (its `config` carries the footer text).
 */
@Controller('store/apps/store-home')
@UseGuards(PermissionsGuard)
export class StoreHomeAppController {
  constructor(
    private readonly storeHome: StoreHomeAppService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('store:apps:manage')
  @Patch('config')
  async updateConfig(@Body() dto: UpdateStoreHomeConfigDto) {
    await this.storeHome.updateConfig(dto);
    return this.responseService.success(null, 'Inicio de tienda guardado');
  }

  @Permissions('store:apps:manage')
  @Post('publish')
  async publish() {
    await this.storeHome.publish();
    return this.responseService.success(null, 'Inicio de tienda publicado');
  }

  @Permissions('store:apps:manage')
  @Post('unpublish')
  async unpublish() {
    await this.storeHome.unpublish();
    return this.responseService.success(null, 'Inicio de tienda despublicado');
  }
}
