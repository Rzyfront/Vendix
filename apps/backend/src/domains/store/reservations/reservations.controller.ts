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
  SendConfirmationDto,
  CreateRescheduleRequestDto,
  ApproveRescheduleRequestDto,
  RejectRescheduleRequestDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { BookingConfirmationService } from './booking-confirmation.service';
import { AppointmentQueueService } from './appointment-queue/appointment-queue.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

@Controller('store/reservations')
@UseGuards(PermissionsGuard)
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingConfirmationService: BookingConfirmationService,
    private readonly appointmentQueueService: AppointmentQueueService,
    private readonly responseService: ResponseService,
    private readonly prisma: StorePrismaService,
  ) {}

  @Get()
  @Permissions('store:reservations:read')
  async findAll(@Query() query: BookingQueryDto) {
    const result = await this.reservationsService.findAll(query);
    return this.responseService.success(
      result,
      'Reservas obtenidas exitosamente',
    );
  }

  @Get('stats')
  @Permissions('store:reservations:read')
  async getStats() {
    const result = await this.reservationsService.getStats();
    return this.responseService.success(
      result,
      'Estadisticas de reservas obtenidas exitosamente',
    );
  }

  @Get('today')
  @Permissions('store:reservations:read')
  async getToday() {
    const result = await this.reservationsService.getToday();
    return this.responseService.success(
      result,
      'Reservas de hoy obtenidas exitosamente',
    );
  }

  @Get('calendar')
  @Permissions('store:reservations:read')
  async getCalendar(@Query() query: CalendarQueryDto) {
    const result = await this.reservationsService.getCalendar(query);
    return this.responseService.success(
      result,
      'Calendario de reservas obtenido exitosamente',
    );
  }

  @Get('availability/:productId')
  @Permissions('store:reservations:read')
  async getAvailability(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: AvailabilityQueryDto,
  ) {
    const result = await this.availabilityService.getAvailableSlots(
      productId,
      query.date_from,
      query.date_to,
      {
        provider_id: query.provider_id,
        product_variant_id: query.product_variant_id,
        include_booked: query.include_booked,
      },
    );
    return this.responseService.success(
      result,
      'Disponibilidad obtenida exitosamente',
    );
  }

  /**
   * Returns dates within a range where the given provider has active
   * schedule blocks, plus the count of existing bookings per date.
   * Used by the reschedule modal to show only available days.
   */
  @Get('provider-dates/:providerId')
  @Permissions('store:reservations:read')
  async getProviderDates(
    @Param('providerId', ParseIntPipe) providerId: number,
    @Query('date_from') dateFrom: string,
    @Query('date_to') dateTo: string,
    @Query('product_id') productId?: string,
  ) {
    const result = await this.availabilityService.getProviderDatesWithBookings(
      providerId,
      dateFrom,
      dateTo,
      productId ? parseInt(productId, 10) : undefined,
    );
    return this.responseService.success(
      result,
      'Fechas del proveedor obtenidas exitosamente',
    );
  }

  @Public()
  @Get('confirm/:token')
  async confirmByToken(@Param('token') token: string) {
    const result = await this.bookingConfirmationService.processToken(token);
    return this.responseService.success(result);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Reschedule approval flow (appointment redesign phase 2)
  // ─────────────────────────────────────────────────────────────────────
  // IMPORTANT: estos endpoints estáticos (`reschedule-requests`, etc.)
  // deben declararse ANTES de los `@Get(':id')` parametrizados para que
  // NestJS los matchee primero — si no, `:id = 'reschedule-requests'` se
  // intenta parsear como int y falla con 400 "numeric string is expected".
  // Enpoints para cuando la tienda tiene
  // `settings.reservations.allow_direct_reschedule = false`. La solicitud
  // del cliente (o del admin en su nombre) queda como fila PENDING en
  // `booking_reschedule_requests` hasta que un admin apruebe o rechace.

  /**
   * Lista las solicitudes pendientes (la cola que ve el admin).
   * Opcional: filtra por `status` (pending/approved/rejected/cancelled).
   */
  @Get('reschedule-requests')
  @Permissions('store:reservations:read')
  async listRescheduleRequests(
    @Query('status') status?: string,
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new BadRequestException(
        'No se pudo determinar la tienda del contexto de la solicitud',
      );
    }
    const rows = await this.prisma.booking_reschedule_requests.findMany({
      where: {
        store_id: storeId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { requested_at: 'desc' },
      take: 200,
      include: {
        booking: {
          select: {
            id: true,
            booking_number: true,
            date: true,
            start_time: true,
            end_time: true,
            customer: {
              select: { id: true, first_name: true, last_name: true, email: true, phone: true },
            },
            product: { select: { id: true, name: true } },
            provider: { select: { id: true, display_name: true } },
          },
        },
        requested_by_user: { select: { id: true, first_name: true, last_name: true } },
        decided_by_user: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    return this.responseService.success(rows, 'Solicitudes de reagendamiento obtenidas');
  }

  /**
   * Aprueba una solicitud pendiente — mueve la reserva al slot solicitado.
   */
  @Patch('reschedule-requests/:reqId/approve')
  @Permissions('store:reservations:update')
  async approveRescheduleRequest(
    @Param('reqId', ParseIntPipe) reqId: number,
    @Body() dto: ApproveRescheduleRequestDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new BadRequestException(
        'No se pudo determinar el usuario del contexto de la solicitud',
      );
    }
    const updated = await this.reservationsService.approveRescheduleRequest(reqId, {
      decidedByUserId: userId,
      decisionReason: dto.decision_reason,
    });
    return this.responseService.success(updated, 'Solicitud aprobada y reserva reprogramada');
  }

  /**
   * Rechaza una solicitud pendiente — la reserva queda en su slot original.
   */
  @Patch('reschedule-requests/:reqId/reject')
  @Permissions('store:reservations:update')
  async rejectRescheduleRequest(
    @Param('reqId', ParseIntPipe) reqId: number,
    @Body() dto: RejectRescheduleRequestDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new BadRequestException(
        'No se pudo determinar el usuario del contexto de la solicitud',
      );
    }
    const result = await this.reservationsService.rejectRescheduleRequest(reqId, {
      decidedByUserId: userId,
      decisionReason: dto.decision_reason,
    });
    return this.responseService.success(result, 'Solicitud rechazada');
  }

  /**
   * Cancela una solicitud pendiente (admin o cliente la retira).
   */
  @Delete('reschedule-requests/:reqId')
  @Permissions('store:reservations:update')
  async cancelRescheduleRequest(
    @Param('reqId', ParseIntPipe) reqId: number,
  ) {
    const userId = RequestContextService.getUserId();
    const result = await this.reservationsService.cancelRescheduleRequest(reqId, {
      cancelledByUserId: userId ?? undefined,
    });
    return this.responseService.success(result, 'Solicitud cancelada');
  }

  /**
   * Crea una solicitud de reagendamiento pendiente en nombre del cliente.
   * Usado por el admin/POS cuando quieren reagendar con aprobación.
   */
  @Post(':id/reschedule-requests')
  @Permissions('store:reservations:update')
  async createRescheduleRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateRescheduleRequestDto,
  ) {
    const booking = await this.reservationsService.findOne(id);
    const userId = RequestContextService.getUserId();
    const created = await this.reservationsService.requestReschedule(booking, dto, {
      requestedByUserId: userId ?? undefined,
    });
    return this.responseService.created(
      created,
      'Solicitud de reagendamiento creada. Queda pendiente hasta que un admin la apruebe.',
    );
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.findOne(id);
    return this.responseService.success(
      result,
      'Reserva obtenida exitosamente',
    );
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
    return this.responseService.success(
      result,
      'Reserva confirmada exitosamente',
    );
  }

  @Patch(':id/start')
  @Permissions('store:reservations:update')
  async start(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.start(id);
    return this.responseService.success(
      result,
      'Reserva iniciada exitosamente',
    );
  }

  @Patch(':id/cancel')
  @Permissions('store:reservations:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.cancel(id);
    return this.responseService.success(
      result,
      'Reserva cancelada exitosamente',
    );
  }

  @Patch(':id/complete')
  @Permissions('store:reservations:update')
  async complete(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.complete(id);
    return this.responseService.success(
      result,
      'Reserva completada exitosamente',
    );
  }

  @Patch(':id/no-show')
  @Permissions('store:reservations:update')
  async noShow(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.noShow(id);
    return this.responseService.success(
      result,
      'Reserva marcada como no-show exitosamente',
    );
  }

  @Patch(':id/check-in')
  @Permissions('store:reservations:write')
  async checkIn(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.checkIn(id, 'staff');
    return this.responseService.success(
      result,
      'Check-in registrado correctamente',
    );
  }

  @Patch(':id/mark-arriving')
  @Permissions('store:reservations:update')
  async markArriving(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.markArriving(id);
    return this.responseService.success(
      result,
      'Reserva marcada como en sala (arriving)',
    );
  }

  @Patch(':id/mark-attending')
  @Permissions('store:reservations:update')
  async markAttending(@Param('id', ParseIntPipe) id: number) {
    const result = await this.reservationsService.markAttending(id);
    return this.responseService.success(
      result,
      'Reserva marcada como siendo atendida (attending)',
    );
  }

  @Post(':id/send-confirmation')
  @Permissions('store:reservations:send_confirmation')
  async sendConfirmation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendConfirmationDto,
  ) {
    const result = await this.bookingConfirmationService.sendConfirmationRequest(
      id,
      dto.source,
    );
    return this.responseService.success(
      result,
      'Solicitud de confirmación enviada al cliente',
    );
  }

  @Get('queue')
  @Permissions('store:reservations:queue:read')
  async getQueue(@Query('day') day?: string) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new BadRequestException(
        'No se pudo determinar la tienda del contexto de la solicitud',
      );
    }
    const targetDay = day ?? new Date().toISOString().split('T')[0];
    const result = await this.appointmentQueueService.computeQueueForStore(
      storeId,
      targetDay,
    );
    return this.responseService.success(result, 'Cola de reservas obtenida');
  }

  @Patch(':id/reschedule')
  @Permissions('store:reservations:update')
  async reschedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleBookingDto,
  ) {
    const result = await this.reservationsService.reschedule(id, dto);
    return this.responseService.success(
      result,
      'Reserva reprogramada exitosamente',
    );
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
        ...(dto.internal_notes !== undefined && {
          internal_notes: dto.internal_notes,
        }),
        updated_at: new Date(),
      },
      include: this.reservationsService['BOOKING_INCLUDE'],
    });
    return this.responseService.success(
      updated,
      'Reserva actualizada exitosamente',
    );
  }

  @Patch(':id/assign-table')
  @Permissions('store:reservations:update')
  async assignTable(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { table_id: number },
  ) {
    if (!body?.table_id) {
      throw new BadRequestException('table_id es obligatorio');
    }
    const result = await this.reservationsService.assignTable(
      id,
      body.table_id,
    );
    return this.responseService.success(
      result,
      'Mesa asignada a la reserva',
    );
  }

  @Patch(':id/seat')
  @Permissions('store:reservations:update')
  async seat(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { table_id?: number } = {},
  ) {
    const result = await this.reservationsService.seatBooking(
      id,
      body.table_id,
    );
    return this.responseService.success(
      result,
      'Reserva sentada en la mesa',
    );
  }

  @Delete(':id')
  @Permissions('store:reservations:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const booking = await this.reservationsService.findOne(id);
    if (booking.status !== 'pending') {
      throw new BadRequestException(
        'Solo se pueden eliminar reservas en estado pendiente',
      );
    }
    await this.reservationsService['prisma'].bookings.delete({ where: { id } });
    return this.responseService.success(null, 'Reserva eliminada exitosamente');
  }
}
