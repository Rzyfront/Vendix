import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AppPageService } from '../shared/app-page.service';
import { ProductPageAppService } from './product-page-app.service';
import {
  PublishProductPageDto,
  UpdateProductPageConfigDto,
  UpdateProductPagePageDto,
} from './product-page.dto';

/**
 * Apps · product page (Fase 2): owner/admin configuration. Reading the app
 * stays on `GET /store/apps/product_page` (its `config` carries the product
 * and the complements).
 */
@Controller('store/apps/product_page')
@UseGuards(PermissionsGuard)
export class ProductPageAppController {
  constructor(
    private readonly productPage: ProductPageAppService,
    private readonly responseService: ResponseService,
    private readonly appPage: AppPageService,
  ) {}

  @Permissions('store:apps:read')
  @Get('custom-domains')
  async customDomains() {
    const result = await this.productPage.listCustomDomains();
    return this.responseService.success(result);
  }

  @Permissions('store:apps:manage')
  @Patch('config')
  async updateConfig(@Body() dto: UpdateProductPageConfigDto) {
    await this.productPage.updateConfig(dto);
    return this.responseService.success(null, 'Página de producto guardada');
  }

  @Permissions('store:apps:manage')
  @Post('publish')
  async publish(@Body() dto: PublishProductPageDto) {
    await this.productPage.publish(dto);
    return this.responseService.success(null, 'Página de producto publicada');
  }

  @Permissions('store:apps:manage')
  @Post('unpublish')
  async unpublish() {
    await this.productPage.unpublish();
    return this.responseService.success(null, 'Página de producto despublicada');
  }

  /** Apps F2: the app's own page (hero, its own sections, brand and SEO). */
  @Permissions('store:apps:manage')
  @Patch('page')
  async updatePage(@Body() dto: UpdateProductPagePageDto) {
    const page = await this.appPage.save('product_page', dto.page);
    return this.responseService.success({ page }, 'Página de producto: contenido guardado');
  }
}
