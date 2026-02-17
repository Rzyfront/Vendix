import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import {
  PayOrderDto,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  RefundOrderDto,
  CancelPaymentDto,
} from './dto';
import { ResponseService } from '@common/responses/response.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

@Controller('store/orders/:orderId/flow')
export class OrderFlowController {
  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('transitions')
  async getValidTransitions(@Param('orderId', ParseIntPipe) orderId: number) {
    const transitions = await this.orderFlowService.getValidTransitions(orderId);
    return this.responseService.success(transitions, 'Valid transitions retrieved');
  }

  @Post('pay')
  @HttpCode(HttpStatus.OK)
  async payOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: PayOrderDto,
  ) {
    const result = await this.orderFlowService.payOrder(orderId, dto);
    return this.responseService.success(result, 'Order paid successfully');
  }

  @Post('ship')
  @HttpCode(HttpStatus.OK)
  async shipOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: ShipOrderDto,
  ) {
    const order = await this.orderFlowService.shipOrder(orderId, dto);
    return this.responseService.success(order, 'Order shipped successfully');
  }

  @Post('deliver')
  @HttpCode(HttpStatus.OK)
  async deliverOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: DeliverOrderDto,
  ) {
    const order = await this.orderFlowService.deliverOrder(orderId, dto);
    return this.responseService.success(order, 'Order delivered successfully');
  }

  @Post('confirm-delivery')
  @HttpCode(HttpStatus.OK)
  async confirmDelivery(@Param('orderId', ParseIntPipe) orderId: number) {
    const order = await this.orderFlowService.confirmDelivery(orderId);
    return this.responseService.success(order, 'Delivery confirmed successfully');
  }

  @Post('confirm-payment')
  @HttpCode(HttpStatus.OK)
  async confirmPayment(@Param('orderId', ParseIntPipe) orderId: number) {
    const order = await this.orderFlowService.confirmPayment(orderId);
    return this.responseService.success(order, 'Payment confirmed successfully');
  }

  @Post('cancel-payment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'OWNER', 'ADMIN')
  async cancelPayment(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CancelPaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const cancelledBy = req.user?.email || req.user?.id?.toString() || 'unknown';
    const order = await this.orderFlowService.cancelPayment(orderId, dto, cancelledBy);
    return this.responseService.success(order, 'Payment cancelled successfully');
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CancelOrderDto,
  ) {
    const order = await this.orderFlowService.cancelOrder(orderId, dto);
    return this.responseService.success(order, 'Order cancelled successfully');
  }

  @Post('refund')
  @HttpCode(HttpStatus.OK)
  async refundOrder(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: RefundOrderDto,
  ) {
    const order = await this.orderFlowService.refundOrder(orderId, dto);
    return this.responseService.success(order, 'Order refunded successfully');
  }
}
