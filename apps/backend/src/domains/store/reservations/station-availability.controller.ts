import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { AvailabilityService } from './availability.service';
import { StationAvailabilityQueryDto } from './dto/station-availability-query.dto';

@Controller('store/service-stations')
@UseGuards(PermissionsGuard)
export class StationAvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('availability')
  @Permissions('store:reservations:read')
  async getAvailability(@Query() query: StationAvailabilityQueryDto) {
    const result = await this.availabilityService.getAvailableSlots(
      query.service_id,
      query.date_from,
      query.date_to,
      {
        provider_id: query.provider_id,
        product_variant_id: query.product_variant_id,
        station_id: query.station_id,
        include_booked: false,
      },
    );
    return this.responseService.success(result, 'Disponibilidad de estaciones obtenida');
  }
}
