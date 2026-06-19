import {
  Controller,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '@common/responses/response.service';
import { WeeklyReportService } from '../../store/weekly-report/weekly-report.service';
import { WeeklyReportSnapshot } from '../../store/weekly-report/types';

/**
 * Endpoints de super admin para ejecutar manualmente la generación del
 * reporte semanal de una tienda o de todas las tiendas activas.
 *
 * Pensado para:
 *   - Re-ejecutar la generación tras un fix de cálculo sin esperar al cron.
 *   - Forzar la generación de una semana histórica para una tienda nueva.
 *   - Vista de UI "Módulo de Tiendas" del super admin: botón "Generar
 *     reporte semanal" por tienda, o "Generar para todas".
 *
 * La notificación `weekly_report` se emite en cada generación exitosa
 * (igual que el cron), por lo que la UI de admin debe ser consciente
 * de que el SSE + push se disparará.
 */
@ApiTags('Admin Weekly Report')
@Controller('superadmin/weekly-report')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperadminWeeklyReportController {
  constructor(
    private readonly service: WeeklyReportService,
    private readonly response_service: ResponseService,
  ) {}

  /**
   * Genera (o re-genera idempotente) el reporte semanal para una tienda
   * específica y emite la notificación `weekly_report`.
   */
  @Post('stores/:storeId/run')
  @Permissions('superadmin:stores:update')
  @ApiOperation({
    summary: 'Generar el reporte semanal de una tienda ahora',
  })
  @ApiResponse({
    status: 201,
    description: 'Reporte generado y notificación emitida',
  })
  async runForStore(
    @Param('storeId', ParseIntPipe) storeId: number,
  ): Promise<{ success: boolean; data: WeeklyReportSnapshot | null; message: string }> {
    const result = await this.service.generateForStore(storeId, {
      sendNotification: true,
    });
    return this.response_service.created(
      result,
      result
        ? 'Reporte semanal generado. Notificación emitida.'
        : 'Tienda inactiva o no encontrada; nada que generar.',
    );
  }

  /**
   * Genera el reporte semanal para todas las tiendas activas. Útil para
   * recuperación tras incidente del cron o para re-generar la semana
   * completa con datos corregidos.
   */
  @Post('run-all')
  @Permissions('superadmin:stores:update')
  @ApiOperation({
    summary: 'Generar el reporte semanal para todas las tiendas activas',
  })
  @ApiResponse({
    status: 201,
    description: 'Batch ejecutado. Devuelve contadores generated/skipped',
  })
  async runForAll(): Promise<{
    success: boolean;
    data: { generated: number; skipped: number };
    message: string;
  }> {
    const result = await this.service.generateForAllActiveStores();
    return this.response_service.created(
      result,
      `Batch ejecutado: ${result.generated} generados, ${result.skipped} saltados.`,
    );
  }
}
