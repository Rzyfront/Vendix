import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import {
  PayOrderDto,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  RefundOrderDto,
} from './dto';
import { ResponseService } from '@common/responses/response.service';

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
