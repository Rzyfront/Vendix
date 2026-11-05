import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { ServiceIndustryGuard } from '../../../../common/guards/service-industry.guard';
import { RentalQuoteQueryDto, SetStationRateWindowsDto } from '../dto/station-rates.dto';
import { RentalQuoteService } from '../rental-quote/rental-quote.service';
import { RateWindowsService } from './rate-windows.service';

@Controller('store/service-stations')
@UseGuards(PermissionsGuard, ServiceIndustryGuard)
export class RateWindowsController {
  constructor(
    private readonly service: RateWindowsService,
    private readonly quoteService: RentalQuoteService,
    private readonly response: ResponseService,
  ) {}

  @Get(':id/rate-windows')
  @Permissions('store:reservations:read')
  async getRateWindows(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.getRateWindows(id));
  }

  @Put(':id/rate-windows')
  @Permissions('store:reservations:update')
  async setRateWindows(@Param('id', ParseIntPipe) id: number, @Body() dto: SetStationRateWindowsDto) {
    return this.response.updated(await this.service.setRateWindows(id, dto), 'Tarifas por franja actualizadas');
  }

  /** Admin preview: price of a rental starting at `start_at` on this station. */
  @Get(':id/rental-quote')
  @Permissions('store:reservations:read')
  async quote(@Param('id', ParseIntPipe) id: number, @Query() query: RentalQuoteQueryDto) {
    return this.response.success(
      await this.quoteService.quote({
        productId: query.product_id,
        variantId: query.variant_id,
        stationId: id,
        startAt: new Date(query.start_at),
      }),
    );
  }
}
