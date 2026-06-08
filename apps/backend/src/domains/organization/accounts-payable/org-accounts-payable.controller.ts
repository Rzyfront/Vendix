import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../common/responses/response.service';

import { OrgAccountsPayableService } from './org-accounts-payable.service';
import { ApQueryDto } from '../../store/accounts-payable/dto/ap-query.dto';
import { RegisterApPaymentDto } from '../../store/accounts-payable/dto/register-ap-payment.dto';
import { ScheduleApPaymentDto } from '../../store/accounts-payable/dto/schedule-ap-payment.dto';

/**
 * Org-native accounts-payable (cartera CxP) controller. Mirrors
 * `/store/accounts-payable` so the ORG_ADMIN frontend can read & operate on
 * payables under its own domain.
 *
 * Optional `?store_id=<n>` selects the target store when the org runs
 * `fiscal_scope=STORE`, or pins a specific store under `fiscal_scope=ORGANIZATION`.
 * Reads consolidate org-wide automatically (`accounts_payable` is org-scoped at
 * the data layer); writes + the bank batch-export require a concrete store.
 */
@ApiTags('Organization Accounts Payable')
@Controller('organization/accounts-payable')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgAccountsPayableController {
  constructor(
    private readonly ap: OrgAccountsPayableService,
    private readonly responseService: ResponseService,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  @Get()
  @Permissions('organization:accounts_payable:read')
  async list(@Query() query: ApQueryDto, @Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.list(query, store_id);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  // ─── AGING REPORT ──────────────────────────────────────────
  @Get('aging')
  @Permissions('organization:accounts_payable:read')
  async getAging(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.getAging(store_id);
    return this.responseService.success(
      result,
      'Reporte de antigüedad obtenido',
    );
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  @Get('dashboard')
  @Permissions('organization:accounts_payable:read')
  async getDashboard(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.getDashboard(store_id);
    return this.responseService.success(
      result,
      'Dashboard de cuentas por pagar obtenido',
    );
  }

  // ─── UPCOMING SCHEDULES ────────────────────────────────────
  @Get('upcoming')
  @Permissions('organization:accounts_payable:read')
  async getUpcoming(
    @Query('store_id') storeIdRaw?: string,
    @Query('days') daysRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const days = daysRaw ? parseInt(daysRaw, 10) : undefined;
    const result = await this.ap.getUpcoming(store_id, days);
    return this.responseService.success(
      result,
      'Pagos programados próximos obtenidos',
    );
  }

  // ─── BATCH EXPORT ──────────────────────────────────────────
  @Post('batch-export')
  @Permissions('organization:accounts_payable:export')
  async batchExport(
    @Body()
    body: {
      supplier_ids?: number[];
      date_from?: string;
      date_to?: string;
    },
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.batchExport(body, store_id);
    return this.responseService.success(
      result,
      'Archivo de exportación generado',
    );
  }

  // --- Parameter Routes (MUST be last) ---

  // ─── DETAIL ────────────────────────────────────────────────
  @Get(':id')
  @Permissions('organization:accounts_payable:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.findOne(id, store_id);
    return this.responseService.success(result);
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  @Post(':id/payment')
  @Permissions('organization:accounts_payable:payment')
  async registerPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterApPaymentDto,
    @Req() req: any,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.registerPayment(id, dto, req.user.id, store_id);
    return this.responseService.success(result, 'Pago registrado exitosamente');
  }

  // ─── SCHEDULE PAYMENT ──────────────────────────────────────
  @Post(':id/schedule')
  @Permissions('organization:accounts_payable:payment')
  async schedulePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ScheduleApPaymentDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.schedulePayment(id, dto, store_id);
    return this.responseService.success(
      result,
      'Pago programado exitosamente',
    );
  }

  // ─── CANCEL SCHEDULE ───────────────────────────────────────
  @Post('schedules/:scheduleId/cancel')
  @Permissions('organization:accounts_payable:payment')
  async cancelSchedule(
    @Param('scheduleId', ParseIntPipe) scheduleId: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.cancelSchedule(scheduleId, store_id);
    return this.responseService.success(
      result,
      'Pago programado cancelado exitosamente',
    );
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  @Post(':id/write-off')
  @Permissions('organization:accounts_payable:write_off')
  async writeOff(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ap.writeOff(id, req.user.id, store_id);
    return this.responseService.success(
      result,
      'Cuenta castigada exitosamente',
    );
  }
}
