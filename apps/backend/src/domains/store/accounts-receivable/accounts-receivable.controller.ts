import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccountsReceivableService } from './accounts-receivable.service';
import { ArAgingService } from './services/ar-aging.service';
import { ArCollectionService } from './services/ar-collection.service';
import { PaymentAgreementService } from './services/payment-agreement.service';
import { ResponseService } from '../../../common/responses/response.service';
import { ArQueryDto } from './dto/ar-query.dto';
import { RegisterArPaymentDto } from './dto/register-ar-payment.dto';
import { CreatePaymentAgreementDto } from './dto/create-payment-agreement.dto';

@ApiTags('Accounts Receivable')
@Controller('store/accounts-receivable')
@UseGuards(PermissionsGuard)
export class AccountsReceivableController {
  constructor(
    private readonly ar_service: AccountsReceivableService,
    private readonly aging_service: ArAgingService,
    private readonly collection_service: ArCollectionService,
    private readonly agreement_service: PaymentAgreementService,
    private readonly response_service: ResponseService,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  @Get()
  @Permissions('store:accounts_receivable:read')
  async findAll(@Query() query: ArQueryDto) {
    const result = await this.ar_service.findAll(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  // ─── AGING REPORT ──────────────────────────────────────────
  @Get('aging')
  @Permissions('store:accounts_receivable:read')
  async getAgingReport() {
    const result = await this.aging_service.getAgingReport();
    return this.response_service.success(
      result,
      'Reporte de antigüedad obtenido',
    );
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  @Get('dashboard')
  @Permissions('store:accounts_receivable:read')
  async getDashboard() {
    const result = await this.ar_service.getDashboard();
    return this.response_service.success(
      result,
      'Dashboard de cartera obtenido',
    );
  }

  // ─── COLLECTION: UPCOMING DUE ─────────────────────────────
  @Get('upcoming')
  @Permissions('store:accounts_receivable:read')
  async getUpcomingDue(@Query('days') days?: string) {
    const result = await this.collection_service.getUpcomingDue(
      days ? parseInt(days, 10) : 7,
    );
    return this.response_service.success(
      result,
      'Próximos vencimientos obtenidos',
    );
  }

  // ─── COLLECTION: OVERDUE BY CUSTOMER ──────────────────────
  @Get('overdue-by-customer')
  @Permissions('store:accounts_receivable:read')
  async getOverdueByCustomer() {
    const result = await this.collection_service.getOverdueByCustomer();
    return this.response_service.success(
      result,
      'Deuda vencida por cliente obtenida',
    );
  }

  // --- Parameter Routes (MUST be last) ---

  // ─── DETAIL ────────────────────────────────────────────────
  @Get(':id')
  @Permissions('store:accounts_receivable:read')
  async findOne(@Param('id') id: string) {
    const result = await this.ar_service.findOne(+id);
    return this.response_service.success(result);
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  @Post(':id/payment')
  @Permissions('store:accounts_receivable:payment')
  async registerPayment(
    @Param('id') id: string,
    @Body() dto: RegisterArPaymentDto,
    @Req() req: any,
  ) {
    const result = await this.ar_service.registerPayment(+id, dto, req.user.id);
    return this.response_service.success(
      result,
      'Pago registrado exitosamente',
    );
  }

  // ─── CREATE PAYMENT AGREEMENT ──────────────────────────────
  @Post(':id/agreement')
  @Permissions('store:accounts_receivable:agreement')
  async createAgreement(
    @Param('id') id: string,
    @Body() dto: CreatePaymentAgreementDto,
    @Req() req: any,
  ) {
    const result = await this.agreement_service.create(+id, dto, req.user.id);
    return this.response_service.success(
      result,
      'Acuerdo de pago creado exitosamente',
    );
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  @Post(':id/write-off')
  @Permissions('store:accounts_receivable:write_off')
  async writeOff(@Param('id') id: string, @Req() req: any) {
    const result = await this.ar_service.writeOff(+id, req.user.id);
    return this.response_service.success(
      result,
      'Cuenta castigada exitosamente',
    );
  }
}
