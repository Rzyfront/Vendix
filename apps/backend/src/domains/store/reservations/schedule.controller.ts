import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Delete,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { AvailabilityService } from './availability.service';
import { UpsertScheduleDto, CreateExceptionDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/reservations/schedules')
@UseGuards(PermissionsGuard)
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly availabilityService: AvailabilityService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('service/:productId')
  @Permissions('store:reservations:read')
  async getServiceSchedules(@Param('productId', ParseIntPipe) productId: number) {
    const result = await this.scheduleService.getSchedulesForService(productId);
    return this.responseService.success(result, 'Horarios del servicio obtenidos exitosamente');
  }

  @Put('service/:productId')
  @Permissions('store:reservations:schedules:manage')
  async upsertSchedule(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpsertScheduleDto,
  ) {
    const result = await this.scheduleService.upsertSchedule(productId, dto.items);
    return this.responseService.success(result, 'Horario actualizado exitosamente');
  }

  @Get('exceptions')
  @Permissions('store:reservations:read')
  async getExceptions(
    @Query('product_id') productId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const result = await this.scheduleService.getExceptions(
      productId ? parseInt(productId, 10) : undefined,
      dateFrom,
      dateTo,
    );
    return this.responseService.success(result, 'Excepciones de horario obtenidas exitosamente');
  }

  @Post('exceptions')
  @Permissions('store:reservations:schedules:manage')
  async createException(@Body() dto: CreateExceptionDto) {
    const result = await this.scheduleService.createException(dto);
    return this.responseService.created(result, 'Excepcion de horario creada exitosamente');
  }

  @Delete('exceptions/:id')
  @Permissions('store:reservations:schedules:manage')
  async deleteException(@Param('id', ParseIntPipe) id: number) {
    await this.scheduleService.deleteException(id);
    return this.responseService.deleted('Excepcion de horario eliminada exitosamente');
  }
}
