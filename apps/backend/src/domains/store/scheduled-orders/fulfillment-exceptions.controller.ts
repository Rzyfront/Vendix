import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { FulfillmentAvailabilityService } from './fulfillment-availability.service';
import { FulfillmentExceptionsService } from './fulfillment-exceptions.service';
import {
  AvailabilityQueryDto,
  CreateFulfillmentExceptionDto,
  UpdateFulfillmentExceptionDto,
} from './dto/fulfillment-exceptions.dto';

@Controller('store/scheduled-orders')
@UseGuards(PermissionsGuard)
export class FulfillmentExceptionsController {
  constructor(
    private readonly availability: FulfillmentAvailabilityService,
    private readonly exceptions: FulfillmentExceptionsService,
    private readonly responseService: ResponseService,
  ) {}

  /** Franjas con cupo para POS y agenda. Con el ajuste apagado → SCHED_DISABLED. */
  @Get('availability')
  @Permissions('store:scheduled_orders:read')
  async getAvailability(@Query() query: AvailabilityQueryDto) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const days = await this.availability.getAvailability(store_id, query.from, query.to);
    return this.responseService.success(days, 'Disponibilidad obtenida');
  }

  @Get('exceptions')
  @Permissions('store:scheduled_orders:read')
  async findExceptions(@Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.exceptions.findAll(from, to);
    return this.responseService.success(rows, 'Excepciones obtenidas');
  }

  @Post('exceptions')
  @Permissions('store:scheduled_orders:update')
  async createException(@Body() dto: CreateFulfillmentExceptionDto) {
    const row = await this.exceptions.create(dto);
    return this.responseService.success(row, 'Excepción guardada');
  }

  @Patch('exceptions/:id')
  @Permissions('store:scheduled_orders:update')
  async updateException(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFulfillmentExceptionDto,
  ) {
    const row = await this.exceptions.update(id, dto);
    return this.responseService.success(row, 'Excepción actualizada');
  }

  @Delete('exceptions/:id')
  @Permissions('store:scheduled_orders:update')
  async removeException(@Param('id', ParseIntPipe) id: number) {
    const row = await this.exceptions.remove(id);
    return this.responseService.success(row, 'Excepción eliminada');
  }
}
