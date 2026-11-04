import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AppPageService } from '../shared/app-page.service';
import { StoreHomeAppService } from './store-home-app.service';
import {
  UpdateStoreHomeConfigDto,
  UpdateStoreHomePageDto,
} from './store-home.dto';

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
    private readonly appPage: AppPageService,
  ) {}

  /** F6-B: name, brand, footer and published apps for the editor preview. */
  @Permissions('store:apps:read')
  @Get('preview-context')
  async previewContext() {
    return this.responseService.success(await this.storeHome.previewContext());
  }

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

  /** Apps F2: the app's own page (hero, its own sections, brand and SEO). */
  @Permissions('store:apps:manage')
  @Patch('page')
  async updatePage(@Body() dto: UpdateStoreHomePageDto) {
    const page = await this.appPage.save('store_home', dto.page);
    return this.responseService.success({ page }, 'Inicio de tienda: contenido guardado');
  }
}
