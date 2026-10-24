import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  CreateServiceStationExceptionDto,
  ReplaceServiceStationSchedulesDto,
} from './dto/service-station-calendar.dto';
import { ServiceStationCalendarService } from './service-station-calendar.service';

@Controller('store/service-stations')
@UseGuards(PermissionsGuard)
export class ServiceStationCalendarController {
  constructor(
    private readonly calendar: ServiceStationCalendarService,
    private readonly response: ResponseService,
  ) {}

  @Get(':stationId/calendar')
  @Permissions('store:reservations:read')
  async read(@Param('stationId', ParseIntPipe) stationId: number) {
    return this.response.success(await this.calendar.read(stationId), 'Calendario de estaciÃ³n obtenido');
  }

  @Put(':stationId/schedules')
  @Permissions('store:reservations:update')
  async replaceSchedules(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Body() dto: ReplaceServiceStationSchedulesDto,
  ) {
    return this.response.updated(await this.calendar.replaceSchedules(stationId, dto), 'Horarios de estaciÃ³n actualizados');
  }

  @Post(':stationId/exceptions')
  @Permissions('store:reservations:update')
  async addException(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Body() dto: CreateServiceStationExceptionDto,
  ) {
    return this.response.created(await this.calendar.createException(stationId, dto), 'Cierre de estaciÃ³n registrado');
  }

  @Delete(':stationId/exceptions/:exceptionId')
  @Permissions('store:reservations:update')
  async removeException(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Param('exceptionId', ParseIntPipe) exceptionId: number,
  ) {
    await this.calendar.removeException(stationId, exceptionId);
    return this.response.deleted('Cierre de estación eliminado');
  }
}