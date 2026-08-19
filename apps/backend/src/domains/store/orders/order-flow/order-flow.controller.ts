import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import { RefundFlowService } from './services/refund-flow.service';
import { RefundMethodsService } from './services/refund-methods.service';
import {
  PayOrderDto,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  RefundOrderDto,
  CancelPaymentDto,
  CreateRefundDto,
  FastTrackOrderDto,
  ReactivateOrderDto,
} from './dto';
import { ResolveRefundDto } from './dto/resolve-refund.dto';
import { ResponseService } from '@common/responses/response.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

@Controller('store/orders/:orderId/flow')
@UseGuards(PermissionsGuard)
export class OrderFlowController {
  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly refundFlowService: RefundFlowService,
    private readonly refundMethodsService: RefundMethodsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('transitions')
  @Permissions('store:orders:order_flow:read')
  async getValidTransitions(@Param('orderId', ParseIntPipe) orderId: number) {
    const transitions =
      await this.orderFlowService.getValidTransitions(orderId);
    return this.responseService.success(
      transitions,
      'Valid transitions retrieved',
    );
  }

  @Get('available-actions')
  @Permissions('store:orders:order_flow:read')
  async getAvailableActions(@Param('orderId', ParseIntPipe) orderId: number) {
    const actions = await this.orderFlowService.getAvailableActions(orderId);
    return this.responseService.success(actions, 'Available actions retrieved');
  }

  @Post('pay')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async payOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: PayOrderDto,
  ) {
    const result = await this.orderFlowService.payOrder(orderId, dto);
    return this.responseService.success(result, 'Order paid successfully');
  }

  @Post('ship')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async shipOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: ShipOrderDto,
  ) {
    const order = await this.orderFlowService.shipOrder(orderId, dto);
    return this.responseService.success(order, 'Order shipped successfully');
  }

  @Post('deliver')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async deliverOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: DeliverOrderDto,
  ) {
    const order = await this.orderFlowService.deliverOrder(orderId, dto);
    return this.responseService.success(order, 'Order delivered successfully');
  }

  @Post('confirm-delivery')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async confirmDelivery(@Param('orderId', ParseIntPipe) orderId: number) {
    const order = await this.orderFlowService.confirmDelivery(orderId);
    return this.responseService.success(
      order,
      'Delivery confirmed successfully',
    );
  }

  @Post('confirm-payment')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async confirmPayment(@Param('orderId', ParseIntPipe) orderId: number) {
    const order = await this.orderFlowService.confirmPayment(orderId);
    return this.responseService.success(
      order,
      'Payment confirmed successfully',
    );
  }

  @Post('cancel-payment')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'OWNER', 'ADMIN')
  async cancelPayment(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CancelPaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const cancelledBy =
      req.user?.email || req.user?.id?.toString() || 'unknown';
    const order = await this.orderFlowService.cancelPayment(
      orderId,
      dto,
      cancelledBy,
    );
    return this.responseService.success(
      order,
      'Payment cancelled successfully',
    );
  }

  @Post('credit-payment')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async registerCreditPayment(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: PayOrderDto,
  ) {
    const result = await this.orderFlowService.registerCreditPayment(
      orderId,
      dto,
    );
    return this.responseService.success(
      result,
      'Credit payment registered successfully',
    );
  }

  @Post('installments/:installmentId/forgive')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'OWNER', 'ADMIN')
  async forgiveInstallment(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('installmentId', ParseIntPipe) installmentId: number,
  ) {
    const result = await this.orderFlowService.forgiveInstallment(
      orderId,
      installmentId,
    );
    return this.responseService.success(
      result,
      'Installment forgiven successfully',
    );
  }

  @Post('fast-track')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async fastTrackOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: FastTrackOrderDto,
  ) {
    const order = await this.orderFlowService.fastTrackOrder(orderId, dto);
    return this.responseService.success(
      order,
      'Order fast-tracked successfully',
    );
  }

  @Post('cancel')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CancelOrderDto,
  ) {
    const order = await this.orderFlowService.cancelOrder(orderId, dto);
    return this.responseService.success(order, 'Order cancelled successfully');
  }

  @Post('reactivate')
  @Permissions('store:orders:order_flow:reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivateOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: ReactivateOrderDto,
  ) {
    const order = await this.orderFlowService.reactivateOrder(orderId, dto);
    return this.responseService.success(order, 'Order reactivated successfully');
  }

  @Post('refund')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async refundOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateRefundDto,
  ) {
    const refund = await this.refundFlowService.createRefund(orderId, dto);
    return this.responseService.success(refund, 'Order refunded successfully');
  }

  /**
   * refund-gateway-fix (W2-B) — cierre manual de un refund que no terminó
   * vía processor.
   *
   * Caso de uso: un refund creado por el flujo automático queda en
   * `pending_approval` o `processing` y el processor no contesta (o el
   * tenant no tiene processor reversible configurado). El operador lo
   * cierra a mano como `completed` (la plata ya se movió por otro canal,
   * p.ej. transferencia bancaria) o `failed` (el processor devolvió
   * algo que no levantó error pero la operación no se completó).
   *
   * Permisos: misma política que `cancel-payment` y `forgive-installment`
   * (reuso `store:orders:order_flow:create` + `@Roles('owner', 'admin')`).
   * ADR-4 del plan explica por qué no se crea un permiso nuevo.
   */
  @Patch('refunds/:refundId/resolve')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'OWNER', 'ADMIN')
  async resolveRefund(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('refundId', ParseIntPipe) refundId: number,
    @Body() dto: ResolveRefundDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Authenticated user id missing');
    }
    const refund = await this.refundFlowService.manuallyResolveRefund(
      orderId,
      refundId,
      dto.target_state,
      dto.resolution_notes,
      userId,
    );
    return this.responseService.success(
      refund,
      'Refund resolved successfully',
    );
  }

  @Post('refund/preview')
  @Permissions('store:orders:order_flow:read')
  @HttpCode(HttpStatus.OK)
  async previewRefund(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateRefundDto,
  ) {
    const preview = await this.refundFlowService.previewRefund(orderId, dto);
    return this.responseService.success(preview, 'Refund preview calculated');
  }

  @Get('refund/available-methods')
  @Permissions('store:orders:order_flow:read')
  async getAvailableRefundMethods(
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    const available = await this.refundMethodsService.getAvailableMethods(
      orderId,
    );
    return this.responseService.success(
      available,
      'Available refund methods retrieved',
    );
  }
}

@Controller('store/orders/:orderId/refunds')
@UseGuards(PermissionsGuard)
export class OrderRefundsController {
  constructor(
    private readonly refundFlowService: RefundFlowService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:orders:order_flow:read')
  async getOrderRefunds(@Param('orderId', ParseIntPipe) orderId: number) {
    const refunds = await this.refundFlowService.getOrderRefunds(orderId);
    return this.responseService.success(refunds, 'Order refunds retrieved');
  }
}
