import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { LandingPageAppService } from './landing-page-app.service';
import {
  PublishLandingPageDto,
  UpdateLandingPageConfigDto,
} from './landing-page.dto';

/**
 * Apps · landing page (Fase 6): owner/admin configuration of the offer and
 * of the landing's own domain. Reading the app stays on
 * `GET /store/apps/landing` (its `config` carries the offer). The landing
 * content is still made in "Landing de captación" (`/admin/customers/crm`).
 */
@Controller('store/apps/landing')
@UseGuards(PermissionsGuard)
export class LandingPageAppController {
  constructor(
    private readonly landingPage: LandingPageAppService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('store:apps:read')
  @Get('custom-domains')
  async customDomains() {
    const result = await this.landingPage.listCustomDomains();
    return this.responseService.success(result);
  }

  @Permissions('store:apps:manage')
  @Patch('config')
  async updateConfig(@Body() dto: UpdateLandingPageConfigDto) {
    await this.landingPage.updateConfig(dto);
    return this.responseService.success(null, 'Oferta de la landing guardada');
  }

  @Permissions('store:apps:manage')
  @Post('publish')
  async publish(@Body() dto: PublishLandingPageDto) {
    await this.landingPage.publish(dto);
    return this.responseService.success(null, 'Landing publicada en su dominio');
  }

  @Permissions('store:apps:manage')
  @Post('unpublish')
  async unpublish() {
    await this.landingPage.unpublish();
    return this.responseService.success(null, 'Landing despublicada de su dominio');
  }
}
