import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { LodgingReservationsService } from './reservations.service';
import { CreateReservationDto, ReservationQuoteDto } from './dto';

/** Hospitality Suite (H1.1) — nightly reservations of a hotel store. */
@Controller('store/hospitality/reservations')
@UseGuards(PermissionsGuard)
export class LodgingReservationsController {
  constructor(
    private readonly lodgingReservationsService: LodgingReservationsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar las reservas del hotel' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async findAll() {
    const result = await this.lodgingReservationsService.findAll();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Disponibilidad y precio de una estadía' })
  @Get('quote')
  @Permissions('store:lodging:reservations:read')
  async quote(@Query() dto: ReservationQuoteDto) {
    const result = await this.lodgingReservationsService.quote(dto);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Obtener una reserva' })
  @Get(':id')
  @Permissions('store:lodging:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingReservationsService.findOne(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear una reserva por noches' })
  @Post()
  @Permissions('store:lodging:reservations:write')
  async create(@Body() dto: CreateReservationDto) {
    const result = await this.lodgingReservationsService.create(dto);
    return this.responseService.created(result, 'Reserva creada exitosamente');
  }
}
