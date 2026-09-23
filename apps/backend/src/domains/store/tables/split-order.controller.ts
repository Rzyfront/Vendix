import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { SplitOrderService } from './split-order.service';
import { SplitAccountPaymentService } from './split-account-payment.service';
import {
  SplitByItemsDto,
  SplitByAmountDto,
  SplitPreviewDto,
  CancelFinancialSplitDto,
  SplitAccountCustomerDto,
  SplitAccountPayDto,
  ConfirmSplitAccountPaymentDto,
} from './dto/split-order.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/** One physical order, independently payable financial accounts. */
@Controller('store/orders')
@UseGuards(PermissionsGuard)
export class SplitOrderController {
  constructor(
    private readonly splitOrderService: SplitOrderService,
    private readonly responseService: ResponseService,
    private readonly accountPayments: SplitAccountPaymentService,
  ) {}

  @Get(':orderId/split')
  @Permissions(
    'store:pos:access',
    'store:table_sessions:read',
    'store:table_sessions:update',
  )
  async getSplit(@Param('orderId', ParseIntPipe) orderId: number) {
    return this.responseService.success(
      await this.splitOrderService.getSplit(orderId),
    );
  }

  @Post(':orderId/split/reconcile')
  @HttpCode(200)
  @Permissions('store:pos:access')
  async reconcile(@Param('orderId', ParseIntPipe) orderId: number) {
    // Recover only committed collections; no provider call or new payment.
    await this.accountPayments.reconcileReceivedForOrder(orderId);
    return this.responseService.success(
      await this.splitOrderService.getSplit(orderId),
    );
  }

  @Post(':orderId/split/preview')
  @HttpCode(200)
  @Permissions('store:table_sessions:update', 'store:pos:access')
  async preview(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SplitPreviewDto,
  ) {
    return this.responseService.success(
      await this.splitOrderService.preview(orderId, dto),
    );
  }

  @Post(':orderId/split-by-items')
  @Permissions('store:table_sessions:update', 'store:pos:access')
  async splitByItems(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SplitByItemsDto,
  ) {
    const result = await this.splitOrderService.splitByItems(orderId, dto);
    return this.responseService.created(
      result,
      `Saldo dividido en ${result.accounts.length} cuentas`,
    );
  }

  @Post(':orderId/split-by-amount')
  @Permissions('store:table_sessions:update', 'store:pos:access')
  async splitByAmount(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SplitByAmountDto,
  ) {
    const result = await this.splitOrderService.splitByAmount(orderId, dto);
    return this.responseService.created(
      result,
      `Saldo dividido en ${result.accounts.length} cuentas`,
    );
  }

  @Post(':orderId/split/cancel')
  @HttpCode(200)
  @Permissions('store:table_sessions:update', 'store:pos:access')
  async cancel(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CancelFinancialSplitDto,
  ) {
    return this.responseService.success(
      await this.splitOrderService.cancel(orderId, dto),
    );
  }

  @Patch(':orderId/split/accounts/:accountId/customer')
  @Permissions('store:table_sessions:update', 'store:pos:access')
  async updateCustomer(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: SplitAccountCustomerDto,
  ) {
    return this.responseService.updated(
      await this.splitOrderService.updateCustomer(orderId, accountId, dto),
    );
  }

  @Post(':orderId/split/accounts/:accountId/pay')
  @Permissions('store:pos:access')
  async pay(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: SplitAccountPayDto,
  ) {
    return this.responseService.created(
      await this.accountPayments.pay(orderId, accountId, dto),
    );
  }

  @Post(':orderId/split/accounts/:accountId/payments/:paymentId/confirm')
  @HttpCode(200)
  @Permissions('store:pos:access')
  async confirm(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() dto: ConfirmSplitAccountPaymentDto,
  ) {
    return this.responseService.success(
      await this.accountPayments.confirm(orderId, accountId, paymentId, dto),
    );
  }
}
