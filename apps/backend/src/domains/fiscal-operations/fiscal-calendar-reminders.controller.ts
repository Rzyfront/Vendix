import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { VAT_PERIODICITIES, VatPeriodicity } from './constants/fiscal-responsibilities.catalog';
import { FiscalContextResolverService } from './services/fiscal-context-resolver.service';
import { FiscalCalendarRemindersService } from './services/fiscal-calendar-reminders.service';

export class FiscalCalendarPreviewQueryDto {
  @IsIn(VAT_PERIODICITIES)
  vat_periodicity!: VatPeriodicity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;
}

/**
 * Calendario tributario (F3): antes de guardar un cambio de periodicidad de
 * IVA, el formulario de datos legales pregunta cuántos recordatorios y
 * obligaciones NO iniciadas de la periodicidad actual se reemplazarían, para
 * mostrar el diálogo «¿Reemplazarlos o conservarlos?». Solo lectura.
 *
 * Exige el mismo permiso que guardar los datos fiscales: quien puede cambiar
 * la periodicidad puede ver qué afecta.
 */
@Controller('store/fiscal/calendar-reminders')
@UseGuards(PermissionsGuard)
export class StoreFiscalCalendarController {
  constructor(
    private readonly contextResolver: FiscalContextResolverService,
    private readonly calendar: FiscalCalendarRemindersService,
    private readonly response: ResponseService,
  ) {}

  @Get('preview')
  @Permissions('store:settings:fiscal_data:write')
  async preview(@Query() query: FiscalCalendarPreviewQueryDto) {
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(
      await this.calendar.previewPeriodicityChange(context, query.vat_periodicity),
    );
  }
}

@Controller('organization/fiscal/calendar-reminders')
@UseGuards(PermissionsGuard)
export class OrganizationFiscalCalendarController {
  constructor(
    private readonly contextResolver: FiscalContextResolverService,
    private readonly calendar: FiscalCalendarRemindersService,
    private readonly response: ResponseService,
  ) {}

  @Get('preview')
  @Permissions('organization:settings:fiscal_data:write')
  async preview(@Query() query: FiscalCalendarPreviewQueryDto) {
    const context = await this.contextResolver.resolveForOrganization({
      store_id: query.store_id,
      require_single_entity: true,
    });
    return this.response.success(
      await this.calendar.previewPeriodicityChange(context, query.vat_periodicity),
    );
  }
}
