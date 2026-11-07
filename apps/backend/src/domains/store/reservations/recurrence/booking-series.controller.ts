import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { BookingSeriesService } from './booking-series.service';
import { CancelBookingSeriesDto, CreateBookingSeriesDto } from './create-booking-series.dto';

/** S19. Declared with its own prefix, so `series` never collides with `store/reservations/:id`. */
@Controller('store/reservations/series')
@UseGuards(PermissionsGuard)
export class BookingSeriesController {
  constructor(
    private readonly seriesService: BookingSeriesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('preview')
  @Permissions('store:reservations:read')
  async preview(@Body() dto: CreateBookingSeriesDto) {
    const result = await this.seriesService.preview(dto);
    return this.responseService.success(result, 'Vista previa de la serie obtenida exitosamente');
  }

  @Post()
  @Permissions('store:reservations:create')
  async create(@Body() dto: CreateBookingSeriesDto) {
    const result = await this.seriesService.create(dto);
    return this.responseService.success(result, 'Serie de reservas creada exitosamente');
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.seriesService.findOne(id);
    return this.responseService.success(result, 'Serie de reservas obtenida exitosamente');
  }

  @Post(':id/cancel')
  @Permissions('store:reservations:update')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: CancelBookingSeriesDto,
    @Query() query?: CancelBookingSeriesDto,
  ) {
    const from = body?.from ?? query?.from ?? 0;
    const result = await this.seriesService.cancelFrom(id, from, body?.reason);
    return this.responseService.success(result, 'Reservas de la serie canceladas exitosamente');
  }
}
