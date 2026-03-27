import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { AvailabilityService } from './availability.service';
import {
  BookingQueryDto,
  AvailabilityQueryDto,
  CreateBookingDto,
  RescheduleBookingDto,
  CalendarQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/reservations')
@UseGuards(PermissionsGuard)
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly availabilityService: AvailabilityService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:reservations:read')
  async findAll(@Query() query: BookingQueryDto) {
    const result = await this.reservationsService.findAll(query);
    return this.responseService.success(result, 'Reservas obtenidas exitosamente');
  }

  @Get('stats')
  @Permissions('store:reservations:read')
  async getStats() {
    const result = await this.reservationsService.getStats();
    return this.responseService.success(result, 'Estadisticas de reservas obtenidas exitosamente');
  }

  @Get('today')
  @Permissions('store:reservations:read')
  async getToday() {
    const result = await this.reservationsService.getToday();
    return this.responseService.success(result, 'Reservas de hoy obtenidas exitosamente');
  }

  @Get('calendar')
  @Permissions('store:reservations:read')
  async getCalendar(@Query() query: CalendarQueryDto) {
    const result = await this.reservationsService.getCalendar(query);
    return this.responseService.success(result, 'Calendario de reservas obtenido exitosamente');
  }

  @Get('availability/:productId')
  @Permissions('store:reservations:read')
  async getAvailability(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: AvailabilityQueryDto,
  ) {
    const result = await this.availabilityService.getAvailableSlots(productId, query.date_from, query.date_to);
    return this.responseService.success(result, 'Disponibilidad obtenida exitosamente');
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.findOne(id);
    return this.responseService.success(result, 'Reserva obtenida exitosamente');
  }

  @Post()
  @Permissions('store:reservations:create')
  async create(@Body() dto: CreateBookingDto) {
    const result = await this.reservationsService.create(dto);
    return this.responseService.created(result, 'Reserva creada exitosamente');
  }

  @Patch(':id/confirm')
  @Permissions('store:reservations:update')
  async confirm(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.confirm(id);
    return this.responseService.success(result, 'Reserva confirmada exitosamente');
  }

  @Patch(':id/cancel')
  @Permissions('store:reservations:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.cancel(id);
    return this.responseService.success(result, 'Reserva cancelada exitosamente');
  }

  @Patch(':id/complete')
  @Permissions('store:reservations:update')
  async complete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.complete(id);
    return this.responseService.success(result, 'Reserva completada exitosamente');
  }

  @Patch(':id/no-show')
  @Permissions('store:reservations:update')
  async noShow(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.noShow(id);
    return this.responseService.success(result, 'Reserva marcada como no-show exitosamente');
  }

  @Patch(':id/reschedule')
  @Permissions('store:reservations:update')
  async reschedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleBookingDto,
  ) {
    const result = await this.reservationsService.reschedule(id, dto);
    return this.responseService.success(result, 'Reserva reprogramada exitosamente');
  }

  @Patch(':id')
  @Permissions('store:reservations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { notes?: string; internal_notes?: string },
  ) {
    const booking = await this.reservationsService.findOne(id);
    const updated = await this.reservationsService['prisma'].bookings.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.internal_notes !== undefined && { internal_notes: dto.internal_notes }),
        updated_at: new Date(),
      },
      include: this.reservationsService['BOOKING_INCLUDE'],
    });
    return this.responseService.success(updated, 'Reserva actualizada exitosamente');
  }

  @Delete(':id')
  @Permissions('store:reservations:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const booking = await this.reservationsService.findOne(id);
    if (booking.status !== 'pending') {
      throw new BadRequestException('Solo se pueden eliminar reservas en estado pendiente');
    }
    await this.reservationsService['prisma'].bookings.delete({ where: { id } });
    return this.responseService.success(null, 'Reserva eliminada exitosamente');
  }
}
