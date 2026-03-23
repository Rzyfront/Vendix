import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CreateCreditDto, RegisterInstallmentPaymentDto, CreditQueryDto, CancelCreditDto } from './dto';

@Controller('store/credits')
@UseGuards(PermissionsGuard)
export class CreditsController {
  constructor(
    private readonly credits_service: CreditsService,
    private readonly response_service: ResponseService,
  ) {}

  @Permissions('store:credits:create')
  @Post()
  async createCredit(@Body() dto: CreateCreditDto) {
    const result = await this.credits_service.createCredit(dto);
    return this.response_service.success(result, 'Credit created successfully');
  }

  @Permissions('store:credits:read')
  @Get()
  async findAll(@Query() query: CreditQueryDto) {
    const result = await this.credits_service.findAll(query);
    return this.response_service.success(result.data, undefined, { pagination: result.meta });
  }

  @Permissions('store:credits:read')
  @Get('stats')
  async getStats() {
    const result = await this.credits_service.getStats();
    return this.response_service.success(result);
  }

  @Permissions('store:credits:read')
  @Get('reports/overdue')
  async getOverdueReport() {
    const result = await this.credits_service.getOverdueReport();
    return this.response_service.success(result);
  }

  @Permissions('store:credits:read')
  @Get('reports/upcoming')
  async getUpcomingInstallments() {
    const result = await this.credits_service.getUpcomingInstallments();
    return this.response_service.success(result);
  }

  @Permissions('store:credits:read')
  @Get('customer/:customerId/available-credit')
  async getAvailableCredit(@Param('customerId') customer_id: string) {
    const result = await this.credits_service.getAvailableCredit(+customer_id);
    return this.response_service.success(result);
  }

  @Permissions('store:credits:read')
  @Get('reports/customer/:customerId')
  async getCustomerHistory(@Param('customerId') customer_id: string) {
    const result = await this.credits_service.getCustomerHistory(+customer_id);
    return this.response_service.success(result);
  }

  @Permissions('store:credits:read')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.credits_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Permissions('store:credits:create')
  @Post(':id/pay')
  async registerPayment(@Param('id') id: string, @Body() dto: RegisterInstallmentPaymentDto) {
    const result = await this.credits_service.registerPayment(+id, dto);
    return this.response_service.success(result, 'Payment registered successfully');
  }

  @Permissions('store:credits:update')
  @Post(':id/installments/:installmentId/forgive')
  async forgiveInstallment(@Param('id') id: string, @Param('installmentId') installment_id: string) {
    const result = await this.credits_service.forgiveInstallment(+id, +installment_id);
    return this.response_service.success(result, 'Installment forgiven successfully');
  }

  @Permissions('store:credits:update')
  @Post(':id/cancel')
  async cancelCredit(@Param('id') id: string, @Body() dto: CancelCreditDto) {
    const result = await this.credits_service.cancelCredit(+id, dto);
    return this.response_service.success(result, 'Credit cancelled successfully');
  }
}
