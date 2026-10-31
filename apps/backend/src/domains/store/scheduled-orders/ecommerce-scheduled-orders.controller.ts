import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { FulfillmentAvailabilityService } from './fulfillment-availability.service';
import { AvailabilityQueryDto } from './dto/fulfillment-exceptions.dto';

/** Tienda en línea: franjas con cupo. Con el ajuste apagado → SCHED_DISABLED. */
@Controller('ecommerce/scheduled-orders')
export class EcommerceScheduledOrdersController {
  constructor(
    private readonly availability: FulfillmentAvailabilityService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get('availability')
  async getAvailability(@Query() query: AvailabilityQueryDto) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const days = await this.availability.getAvailability(store_id, query.from, query.to);
    return this.responseService.success(days, 'Disponibilidad obtenida');
  }
}
