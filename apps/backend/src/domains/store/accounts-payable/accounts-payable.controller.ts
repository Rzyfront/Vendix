import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccountsPayableService } from './accounts-payable.service';
import { ApAgingService } from './services/ap-aging.service';
import { ApSchedulingService } from './services/ap-scheduling.service';
import { ApBankExportService } from './services/ap-bank-export.service';
import { ResponseService } from '../../../common/responses/response.service';
import { ApQueryDto } from './dto/ap-query.dto';
import { RegisterApPaymentDto } from './dto/register-ap-payment.dto';
import { ScheduleApPaymentDto } from './dto/schedule-ap-payment.dto';

@ApiTags('Accounts Payable')
@Controller('store/accounts-payable')
@UseGuards(PermissionsGuard)
export class AccountsPayableController {
  constructor(
    private readonly ap_service: AccountsPayableService,
    private readonly aging_service: ApAgingService,
    private readonly scheduling_service: ApSchedulingService,
    private readonly bank_export_service: ApBankExportService,
    private readonly response_service: ResponseService,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  @Get()
  @Permissions('store:accounts_payable:read')
  async findAll(@Query() query: ApQueryDto) {
    const result = await this.ap_service.findAll(query);
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
  @Permissions('store:accounts_payable:read')
  async getAgingReport() {
    const result = await this.aging_service.getAgingReport();
    return this.response_service.success(
      result,
      'Reporte de antigüedad obtenido',
    );
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  @Get('dashboard')
  @Permissions('store:accounts_payable:read')
  async getDashboard() {
    const result = await this.ap_service.getDashboard();
    return this.response_service.success(
      result,
      'Dashboard de cuentas por pagar obtenido',
    );
  }

  // ─── UPCOMING SCHEDULES ────────────────────────────────────
  @Get('upcoming')
  @Permissions('store:accounts_payable:read')
  async getUpcomingSchedules(@Query('days') days?: string) {
    const result = await this.scheduling_service.getUpcomingSchedules(
      days ? parseInt(days, 10) : 7,
    );
    return this.response_service.success(
      result,
      'Pagos programados próximos obtenidos',
    );
  }

  // ─── BATCH EXPORT ──────────────────────────────────────────
  @Post('batch-export')
  @Permissions('store:accounts_payable:export')
  async batchExport(
    @Body()
    body: {
      supplier_ids?: number[];
      date_from?: string;
      date_to?: string;
    },
  ) {
    const result = await this.bank_export_service.generateBatchExport(body);
    return this.response_service.success(
      result,
      'Archivo de exportación generado',
    );
  }

  // --- Parameter Routes (MUST be last) ---

  // ─── DETAIL ────────────────────────────────────────────────
  @Get(':id')
  @Permissions('store:accounts_payable:read')
  async findOne(@Param('id') id: string) {
    const result = await this.ap_service.findOne(+id);
    return this.response_service.success(result);
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  @Post(':id/payment')
  @Permissions('store:accounts_payable:payment')
  async registerPayment(
    @Param('id') id: string,
    @Body() dto: RegisterApPaymentDto,
    @Req() req: any,
  ) {
    const result = await this.ap_service.registerPayment(+id, dto, req.user.id);
    return this.response_service.success(
      result,
      'Pago registrado exitosamente',
    );
  }

  // ─── SCHEDULE PAYMENT ──────────────────────────────────────
  @Post(':id/schedule')
  @Permissions('store:accounts_payable:schedule')
  async schedulePayment(
    @Param('id') id: string,
    @Body() dto: ScheduleApPaymentDto,
  ) {
    const result = await this.scheduling_service.schedulePayment(+id, dto);
    return this.response_service.success(
      result,
      'Pago programado exitosamente',
    );
  }

  // ─── CANCEL SCHEDULE ───────────────────────────────────────
  @Post('schedules/:scheduleId/cancel')
  @Permissions('store:accounts_payable:schedule')
  async cancelSchedule(@Param('scheduleId') scheduleId: string) {
    const result = await this.scheduling_service.cancelSchedule(+scheduleId);
    return this.response_service.success(
      result,
      'Pago programado cancelado exitosamente',
    );
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  @Post(':id/write-off')
  @Permissions('store:accounts_payable:write_off')
  async writeOff(@Param('id') id: string, @Req() req: any) {
    const result = await this.ap_service.writeOff(+id, req.user.id);
    return this.response_service.success(
      result,
      'Cuenta castigada exitosamente',
    );
  }
}
