import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ProviderCommissionsService } from './services/provider-commissions.service';
import {
  ListEmployeeCommissionsDto,
  DeclineCommissionDto,
  MarkCommissionPaidDto,
} from './dto/commissions.dto';

/**
 * Endpoints del feature de comisiones dueño/mecánico (QUI-678).
 *
 * Rutas:
 *   GET    /store/users/:id/commissions         → historial de un mecánico
 *   GET    /store/users/:id/commissions/summary → KPIs (pendiente, pagado, declinado)
 *   POST   /store/commissions/:id/decline      → marca declined (con motivo)
 *   POST   /store/commissions/:id/mark-paid    → marca paid (con reference)
 *   POST   /store/commissions/:id/reopen       → reverse del decline
 *
 * Permisos:
 *   store:commissions:read    → GETs (cualquier usuario autenticado)
 *   store:commissions:manage  → POSTs (solo owner/admin de la tienda)
 */
@ApiTags('User Commissions (QUI-678)')
@Controller('store')
@UseGuards(PermissionsGuard)
export class UserCommissionsController {
  constructor(
    private readonly commissions: ProviderCommissionsService,
    private readonly response_service: ResponseService,
    private readonly request_context: RequestContextService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────

  @Get('users/:id/commissions')
  @Permissions('store:commissions:read')
  async listByEmployee(
    @Param('id', ParseIntPipe) employeeId: number,
    @Query() query: ListEmployeeCommissionsDto,
  ) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new Error('store_id no presente en el contexto de la request');
    }

    const status = query.status
      ? query.status.split(',').map((s) => s.trim()) as any
      : undefined;

    const result = await this.commissions.listByEmployee({
      employee_id: employeeId,
      store_id: storeId,
      status,
      date_from: query.date_from ? new Date(query.date_from) : undefined,
      date_to: query.date_to ? new Date(query.date_to) : undefined,
      page: query.page,
      limit: query.limit,
    });

    return this.response_service.paginated(
      result.items,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Get('users/:id/commissions/summary')
  @Permissions('store:commissions:read')
  async getEmployeeSummary(@Param('id', ParseIntPipe) employeeId: number) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new Error('store_id no presente en el contexto de la request');
    }

    const summary = await this.commissions.getEmployeeSummary({
      employee_id: employeeId,
      store_id: storeId,
    });

    return this.response_service.success(
      summary,
      'Resumen de comisiones del empleado',
    );
  }

  // ─── Acciones ─────────────────────────────────────────────────────────

  @Post('commissions/:id/decline')
  @Permissions('store:commissions:manage')
  async decline(
    @Param('id', ParseIntPipe) accrualId: number,
    @Body() dto: DeclineCommissionDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new Error('user_id no presente en el contexto de la request');
    }

    await this.commissions.decline({
      accrual_id: accrualId,
      reason: dto.reason,
      declined_by_user_id: userId,
    });

    return this.response_service.success(
      { accrual_id: accrualId, status: 'declined' },
      'Comisión declinada exitosamente',
    );
  }

  @Post('commissions/:id/mark-paid')
  @Permissions('store:commissions:manage')
  async markPaid(
    @Param('id', ParseIntPipe) accrualId: number,
    @Body() dto: MarkCommissionPaidDto,
  ) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new Error('user_id no presente en el contexto de la request');
    }

    await this.commissions.markPaid({
      accrual_id: accrualId,
      paid_by_user_id: userId,
      payment_reference: dto.payment_reference,
      notes: dto.notes,
    });

    return this.response_service.success(
      { accrual_id: accrualId, status: 'paid' },
      'Comisión marcada como pagada',
    );
  }

  @Post('commissions/:id/reopen')
  @Permissions('store:commissions:manage')
  async reopen(@Param('id', ParseIntPipe) accrualId: number) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new Error('user_id no presente en el contexto de la request');
    }

    await this.commissions.reopen({
      accrual_id: accrualId,
      user_id: userId,
    });

    return this.response_service.success(
      { accrual_id: accrualId, status: 'accrued' },
      'Comisión re-abierta',
    );
  }
}