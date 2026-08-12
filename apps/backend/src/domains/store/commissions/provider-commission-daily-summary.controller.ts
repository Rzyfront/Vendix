import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { ProviderCommissionsService } from './services/provider-commissions.service';
import { DailyCommissionSummaryQueryDto } from './dto/commissions.dto';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Resumen diario del split dueño/mecánico para reportes al cierre del día.
 * Usa el nuevo modelo `user_commissions` (QUI-678).
 *
 * Ruta: GET /store/reservations/commissions/daily-summary
 * Permiso: store:reservations:read
 */
@ApiTags('Reservations / Commissions')
@Controller('store/reservations/commissions')
@UseGuards(PermissionsGuard)
export class ProviderCommissionDailySummaryController {
  constructor(
    private readonly commissions: ProviderCommissionsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('daily-summary')
  @Permissions('store:reservations:read')
  async getDailySummary(@Query() query: DailyCommissionSummaryQueryDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new Error('store_id no presente en el contexto de la request');
    }

    const date = query.date ? new Date(query.date) : new Date();
    if (query.date) {
      // Ajustar a inicio del día local
      const [y, m, d] = query.date.split('-').map(Number);
      date.setFullYear(y, m - 1, d);
      date.setHours(0, 0, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }

    const result = await this.commissions.getDailySummary({
      store_id: storeId,
      date,
    });

    return this.response_service.success(
      result,
      'Resumen diario de comisiones obtenido',
    );
  }
}