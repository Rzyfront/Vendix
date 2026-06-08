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

import { OrgAccountsReceivableService } from './org-accounts-receivable.service';
import { ArQueryDto } from '../../store/accounts-receivable/dto/ar-query.dto';
import { RegisterArPaymentDto } from '../../store/accounts-receivable/dto/register-ar-payment.dto';
import { CreatePaymentAgreementDto } from '../../store/accounts-receivable/dto/create-payment-agreement.dto';

/**
 * Org-native accounts-receivable (cartera CxC) controller. Mirrors
 * `/store/accounts-receivable` so the ORG_ADMIN frontend can read & operate on
 * receivables under its own domain.
 *
 * Optional `?store_id=<n>` forces a per-store breakdown when the org
 * `fiscal_scope=ORGANIZATION` (read paths), or selects the target store when
 * `fiscal_scope=STORE` (read + write paths). Writes require a concrete store.
 */
@ApiTags('Organization Accounts Receivable')
@Controller('organization/accounts-receivable')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgAccountsReceivableController {
  constructor(
    private readonly ar: OrgAccountsReceivableService,
    private readonly responseService: ResponseService,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  @Get()
  @Permissions('organization:accounts_receivable:read')
  async list(
    @Query() query: ArQueryDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.list(query, store_id);
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
  @Permissions('organization:accounts_receivable:read')
  async getAging(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.getAging(store_id);
    return this.responseService.success(
      result,
      'Reporte de antigüedad obtenido',
    );
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  @Get('dashboard')
  @Permissions('organization:accounts_receivable:read')
  async getDashboard(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.getDashboard(store_id);
    return this.responseService.success(
      result,
      'Dashboard de cartera obtenido',
    );
  }

  // ─── COLLECTION: UPCOMING DUE ─────────────────────────────
  @Get('upcoming')
  @Permissions('organization:accounts_receivable:read')
  async getUpcoming(
    @Query('store_id') storeIdRaw?: string,
    @Query('days') daysRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const days = daysRaw ? parseInt(daysRaw, 10) : undefined;
    const result = await this.ar.getUpcoming(store_id, days);
    return this.responseService.success(
      result,
      'Próximos vencimientos obtenidos',
    );
  }

  // ─── COLLECTION: OVERDUE BY CUSTOMER ──────────────────────
  @Get('overdue-by-customer')
  @Permissions('organization:accounts_receivable:read')
  async getOverdueByCustomer(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.getOverdueByCustomer(store_id);
    return this.responseService.success(
      result,
      'Deuda vencida por cliente obtenida',
    );
  }

  // --- Parameter Routes (MUST be last) ---

  // ─── DETAIL ────────────────────────────────────────────────
  @Get(':id')
  @Permissions('organization:accounts_receivable:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.findOne(id, store_id);
    return this.responseService.success(result);
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  @Post(':id/payment')
  @Permissions('organization:accounts_receivable:payment')
  async registerPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterArPaymentDto,
    @Req() req: any,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.registerPayment(
      id,
      dto,
      req.user.id,
      store_id,
    );
    return this.responseService.success(result, 'Pago registrado exitosamente');
  }

  // ─── CREATE PAYMENT AGREEMENT ──────────────────────────────
  @Post(':id/agreement')
  @Permissions('organization:accounts_receivable:payment')
  async createAgreement(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePaymentAgreementDto,
    @Req() req: any,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.createAgreement(
      id,
      dto,
      req.user.id,
      store_id,
    );
    return this.responseService.success(
      result,
      'Acuerdo de pago creado exitosamente',
    );
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  @Post(':id/write-off')
  @Permissions('organization:accounts_receivable:write_off')
  async writeOff(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.ar.writeOff(id, req.user.id, store_id);
    return this.responseService.success(
      result,
      'Cuenta castigada exitosamente',
    );
  }
}
