import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingGuestsService } from './guests.service';
import { LodgingGuestDto } from './guest.dto';

/** Hospitality Suite (H3.1) — guest register of a reservation (holder and companions). */
@Controller('store/hospitality/reservations/:reservationId/guests')
@UseGuards(PermissionsGuard)
export class LodgingGuestsController {
  constructor(
    private readonly guestsService: LodgingGuestsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar los huéspedes de una reserva' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async findAll(@Param('reservationId', ParseIntPipe) reservationId: number) {
    const result = await this.guestsService.findAll(reservationId);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Registrar un huésped o acompañante' })
  @Post()
  @Permissions('store:lodging:front_desk:operate')
  async create(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: LodgingGuestDto,
  ) {
    const result = await this.guestsService.create(reservationId, dto);
    return this.responseService.created(result, 'Huésped registrado');
  }

  @ApiOperation({ summary: 'Editar un huésped' })
  @Patch(':guestId')
  @Permissions('store:lodging:front_desk:operate')
  async update(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Param('guestId', ParseIntPipe) guestId: number,
    @Body() dto: LodgingGuestDto,
  ) {
    const result = await this.guestsService.update(reservationId, guestId, dto);
    return this.responseService.updated(result, 'Huésped actualizado');
  }

  @ApiOperation({ summary: 'Quitar un huésped del registro' })
  @Delete(':guestId')
  @Permissions('store:lodging:front_desk:operate')
  async remove(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Param('guestId', ParseIntPipe) guestId: number,
  ) {
    const result = await this.guestsService.remove(reservationId, guestId);
    return this.responseService.success(result, 'Huésped quitado');
  }
}
