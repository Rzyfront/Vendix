import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { LodgingReservationsService } from './reservations.service';
import { LodgingRoomChangesService } from './room-changes.service';
import { LodgingRatePlansService } from '../rates/rate-plans.service';
import {
  CancelReservationDto,
  CreateReservationDto,
  NoShowReservationDto,
  ReservationQueryDto,
  ReservationQuoteDto,
  RoomChangeDto,
} from './dto';

/** Hospitality Suite (H1.1/H1.2/H1.4/H1.5/H2.1) — nightly reservations of a hotel store. */
@Controller('store/hospitality/reservations')
@UseGuards(PermissionsGuard)
export class LodgingReservationsController {
  constructor(
    private readonly lodgingReservationsService: LodgingReservationsService,
    private readonly lodgingRoomChangesService: LodgingRoomChangesService,
    private readonly lodgingRatePlansService: LodgingRatePlansService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar las reservas del hotel' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async findAll(@Query() query: ReservationQueryDto) {
    const { data, total, page, limit } = await this.lodgingReservationsService.findAll(query);
    return this.responseService.paginated(data, total, page, limit);
  }

  @ApiOperation({ summary: 'Llegadas de hoy, en casa y ocupación de hoy' })
  @Get('stats')
  @Permissions('store:lodging:reservations:read')
  async stats() {
    const result = await this.lodgingReservationsService.stats();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Disponibilidad y precio de una estadía' })
  @Get('quote')
  @Permissions('store:lodging:reservations:read')
  async quote(@Query() dto: ReservationQuoteDto) {
    const result = await this.lodgingReservationsService.quote(dto);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Planes tarifarios activos para reservar, con los tipos que tienen precio' })
  @Get('rate-plans')
  @Permissions('store:lodging:reservations:read')
  async sellableRatePlans() {
    const result = await this.lodgingRatePlansService.findSellable();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Validar y cotizar un cambio de habitación o de fechas' })
  @Get('rooms/:roomId/change-quote')
  @Permissions('store:lodging:reservations:read')
  async changeQuote(@Param('roomId', ParseIntPipe) roomId: number, @Query() dto: RoomChangeDto) {
    const result = await this.lodgingRoomChangesService.quote(roomId, dto);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Asignar, mover o cambiar las fechas de una habitación de la reserva' })
  @Patch('rooms/:roomId')
  @Permissions('store:lodging:reservations:write')
  async changeRoom(@Param('roomId', ParseIntPipe) roomId: number, @Body() dto: RoomChangeDto) {
    const reservationId = await this.lodgingRoomChangesService.apply(roomId, dto);
    const result = await this.lodgingReservationsService.findOne(reservationId);
    return this.responseService.success(result, 'Reserva actualizada');
  }

  @ApiOperation({ summary: 'Cancelar una habitación de una reserva multi-habitación' })
  @Post('rooms/:roomId/cancel')
  @Permissions('store:lodging:reservations:write')
  async cancelRoom(
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: CancelReservationDto,
  ) {
    const result = await this.lodgingReservationsService.cancelRoom(roomId, dto.reason);
    return this.responseService.success(result, 'Habitación cancelada');
  }

  @ApiOperation({ summary: 'Obtener una reserva' })
  @Get(':id')
  @Permissions('store:lodging:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingReservationsService.findOne(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear una reserva por noches de una o varias habitaciones' })
  @Post()
  @Permissions('store:lodging:reservations:write')
  async create(@Body() dto: CreateReservationDto) {
    const result = await this.lodgingReservationsService.create(dto);
    return this.responseService.created(result, 'Reserva creada exitosamente');
  }

  @ApiOperation({ summary: 'Cancelar una reserva y liberar sus noches' })
  @Post(':id/cancel')
  @Permissions('store:lodging:reservations:write')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelReservationDto) {
    const result = await this.lodgingReservationsService.cancel(id, dto.reason);
    return this.responseService.success(result, 'Reserva cancelada');
  }

  @ApiOperation({ summary: 'Marcar una reserva como no-show y liberar sus noches' })
  @Post(':id/no-show')
  @Permissions('store:lodging:reservations:write')
  async noShow(@Param('id', ParseIntPipe) id: number, @Body() dto: NoShowReservationDto) {
    const result = await this.lodgingReservationsService.markNoShow(id, dto.reason);
    return this.responseService.success(result, 'Reserva marcada como no-show');
  }
}
