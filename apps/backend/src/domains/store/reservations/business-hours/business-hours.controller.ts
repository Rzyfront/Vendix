import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { BusinessHoursService } from './business-hours.service';
import { UpsertBusinessHoursDto } from './dto';

@Controller('store/business-hours')
@UseGuards(PermissionsGuard)
export class BusinessHoursController {
  constructor(
    private readonly businessHoursService: BusinessHoursService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Returns the full week (7 rows) for the store in the request context.
   */
  @Get()
  @Permissions('store:business_hours:read')
  async getAll() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new BadRequestException(
        'No se pudo determinar la tienda del contexto de la solicitud',
      );
    }
    const result = await this.businessHoursService.getAllForStore(storeId);
    return this.responseService.success(
      result,
      'Horario de tienda obtenido exitosamente',
    );
  }

  /**
   * Batch upsert: replaces the rows for any day present in the payload.
   */
  @Put()
  @Permissions('store:business_hours:write')
  async upsert(@Body() dto: UpsertBusinessHoursDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new BadRequestException(
        'No se pudo determinar la tienda del contexto de la solicitud',
      );
    }
    const result = await this.businessHoursService.upsertAll(storeId, dto);
    return this.responseService.success(
      result,
      'Horario de tienda actualizado exitosamente',
    );
  }

  /**
   * Returns one row (single day) for the store in context.
   */
  @Get('day/:d')
  @Permissions('store:business_hours:read')
  async getDay(@Param('d', ParseIntPipe) day: number) {
    if (day < 0 || day > 6) {
      throw new BadRequestException('day_of_week debe estar entre 0 y 6');
    }
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new BadRequestException(
        'No se pudo determinar la tienda del contexto de la solicitud',
      );
    }
    const result = await this.businessHoursService.getForDay(storeId, day);
    return this.responseService.success(
      result ?? {
        day_of_week: day,
        start_time: null,
        end_time: null,
        is_active: false,
      },
      'Día específico del horario de tienda',
    );
  }
}