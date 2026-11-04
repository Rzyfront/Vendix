import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { AppPageService } from '../shared/app-page.service';
import { BookingAppService } from './booking-app.service';
import {
  PublishBookingPageDto,
  UpdateBookingPageConfigDto,
  UpdateBookingPagePageDto,
} from './booking-page.dto';

/**
 * Apps · booking (Fase 4): owner/admin configuration of the hotel booking
 * page. Reading the app stays on `GET /store/apps/booking` (its `config`
 * carries the secondary products).
 */
@Controller('store/apps/booking')
@UseGuards(PermissionsGuard)
export class BookingAppController {
  constructor(
    private readonly booking: BookingAppService,
    private readonly responseService: ResponseService,
    private readonly appPage: AppPageService,
  ) {}

  /** F6-B: room types and secondary products for the editor preview. */
  @Permissions('store:apps:read')
  @Get('preview-context')
  async previewContext() {
    return this.responseService.success(await this.booking.previewContext());
  }

  @Permissions('store:apps:read')
  @Get('custom-domains')
  async customDomains() {
    const result = await this.booking.listCustomDomains();
    return this.responseService.success(result);
  }

  @Permissions('store:apps:manage')
  @Patch('config')
  async updateConfig(@Body() dto: UpdateBookingPageConfigDto) {
    await this.booking.updateConfig(dto);
    return this.responseService.success(null, 'Página de reservas guardada');
  }

  @Permissions('store:apps:manage')
  @Post('publish')
  async publish(@Body() dto: PublishBookingPageDto) {
    await this.booking.publish(dto);
    return this.responseService.success(null, 'Página de reservas publicada');
  }

  @Permissions('store:apps:manage')
  @Post('unpublish')
  async unpublish() {
    await this.booking.unpublish();
    return this.responseService.success(null, 'Página de reservas despublicada');
  }

  /** Apps F2: the app's own page (hero, its own sections, brand and SEO). */
  @Permissions('store:apps:manage')
  @Patch('page')
  async updatePage(@Body() dto: UpdateBookingPagePageDto) {
    const page = await this.appPage.save('booking', dto.page);
    return this.responseService.success({ page }, 'Página de reservas: contenido guardado');
  }
}
