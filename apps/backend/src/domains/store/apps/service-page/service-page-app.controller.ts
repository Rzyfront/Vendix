import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AppPageService } from '../shared/app-page.service';
import { ServicePageAppService } from './service-page-app.service';
import {
  PublishServicePageDto,
  UpdateServicePageConfigDto,
  UpdateServicePagePageDto,
} from './service-page.dto';

/**
 * Apps · service page (Fase 3): owner/admin configuration. Reading the app
 * stays on `GET /store/apps/service_page` (its `config` carries the featured
 * services and the secondary products).
 */
@Controller('store/apps/service_page')
@UseGuards(PermissionsGuard)
export class ServicePageAppController {
  constructor(
    private readonly servicePage: ServicePageAppService,
    private readonly responseService: ResponseService,
    private readonly appPage: AppPageService,
  ) {}

  @Permissions('store:apps:read')
  @Get('custom-domains')
  async customDomains() {
    const result = await this.servicePage.listCustomDomains();
    return this.responseService.success(result);
  }

  @Permissions('store:apps:manage')
  @Patch('config')
  async updateConfig(@Body() dto: UpdateServicePageConfigDto) {
    await this.servicePage.updateConfig(dto);
    return this.responseService.success(null, 'Página de servicios guardada');
  }

  @Permissions('store:apps:manage')
  @Post('publish')
  async publish(@Body() dto: PublishServicePageDto) {
    await this.servicePage.publish(dto);
    return this.responseService.success(null, 'Página de servicios publicada');
  }

  @Permissions('store:apps:manage')
  @Post('unpublish')
  async unpublish() {
    await this.servicePage.unpublish();
    return this.responseService.success(null, 'Página de servicios despublicada');
  }

  /** Apps F2: the app's own page (hero, its own sections, brand and SEO). */
  @Permissions('store:apps:manage')
  @Patch('page')
  async updatePage(@Body() dto: UpdateServicePagePageDto) {
    const page = await this.appPage.save('service_page', dto.page);
    return this.responseService.success({ page }, 'Página de servicios: contenido guardado');
  }
}
