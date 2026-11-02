import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { BookingAppService } from './booking-app.service';
import { PublishBookingPageDto, UpdateBookingPageConfigDto } from './booking-page.dto';

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
  ) {}

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
}
