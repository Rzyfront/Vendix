import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  CreateOrderPaymentDto,
  RefundPaymentDto,
  PaymentQueryDto,
} from './dto';

@ApiTags('Payments')
@Controller('payments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Process payment for existing order' })
  @ApiResponse({ status: 200, description: 'Payment processed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async processPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @Request() req,
  ) {
    return this.paymentsService.processPayment(createPaymentDto, req.user);
  }

  @Post('with-order')
  @ApiOperation({ summary: 'Create order and process payment' })
  @ApiResponse({
    status: 201,
    description: 'Order created and payment processed',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async processPaymentWithOrder(
    @Body() createOrderPaymentDto: CreateOrderPaymentDto,
    @Request() req,
  ) {
    return this.paymentsService.processPaymentWithOrder(
      createOrderPaymentDto,
      req.user,
    );
  }

  @Post(':paymentId/refund')
  @ApiOperation({ summary: 'Refund payment' })
  @ApiResponse({ status: 200, description: 'Payment refunded successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async refundPayment(
    @Param('paymentId') paymentId: string,
    @Body() refundPaymentDto: RefundPaymentDto,
    @Request() req,
  ) {
    return this.paymentsService.refundPayment(
      paymentId,
      refundPaymentDto,
      req.user,
    );
  }

  @Get(':paymentId/status')
  @ApiOperation({ summary: 'Get payment status' })
  @ApiResponse({ status: 200, description: 'Payment status retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getPaymentStatus(
    @Param('paymentId') paymentId: string,
    @Request() req,
  ) {
    return this.paymentsService.getPaymentStatus(paymentId, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Get all payments with pagination' })
  @ApiResponse({ status: 200, description: 'Payments retrieved successfully' })
  async findAll(@Query() query: PaymentQueryDto, @Request() req) {
    return this.paymentsService.findAll(query, req.user);
  }

  @Get(':paymentId')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiResponse({ status: 200, description: 'Payment retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async findOne(@Param('paymentId') paymentId: string, @Request() req) {
    return this.paymentsService.findOne(paymentId, req.user);
  }
}
