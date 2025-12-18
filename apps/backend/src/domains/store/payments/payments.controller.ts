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
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { PaymentsService } from './payments.service';
import { ResponseService } from '../../../common/responses/response.service';
import {
  CreatePaymentDto,
  CreateOrderPaymentDto,
  RefundPaymentDto,
  PaymentQueryDto,
  CreatePosPaymentDto,
} from './dto';

@ApiTags('Payments')
@Controller('store/payments')
@ApiBearerAuth()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly responseService: ResponseService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Process payment for existing order' })
  @ApiResponse({ status: 200, description: 'Payment processed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async processPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @Request() req,
  ) {
    const result = await this.paymentsService.processPayment(createPaymentDto, req.user);
    return this.responseService.success(result, 'Payment processed successfully');
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
    const result = await this.paymentsService.processPaymentWithOrder(
      createOrderPaymentDto,
      req.user,
    );
    return this.responseService.created(result, 'Order created and payment processed');
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
    const result = await this.paymentsService.refundPayment(
      paymentId,
      refundPaymentDto,
      req.user,
    );
    return this.responseService.success(result, 'Payment refunded successfully');
  }

  @Get(':paymentId/status')
  @ApiOperation({ summary: 'Get payment status' })
  @ApiResponse({ status: 200, description: 'Payment status retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getPaymentStatus(
    @Param('paymentId') paymentId: string,
    @Request() req,
  ) {
    const result = await this.paymentsService.getPaymentStatus(paymentId, req.user);
    return this.responseService.success(result, 'Payment status retrieved');
  }

  @Get()
  @ApiOperation({ summary: 'Get all payments with pagination' })
  @ApiResponse({ status: 200, description: 'Payments retrieved successfully' })
  async findAll(@Query() query: PaymentQueryDto, @Request() req) {
    const result = await this.paymentsService.findAll(query, req.user);
    // Assuming findAll returns { data, total, page, limit } or similar, 
    // but ResponseService.paginated needs explicit args. 
    // If result is just array or standard paginated object, we need to adapt.
    // Ideally PaymentsService.findAll returns a standard paginated structure.
    // For now, wrapping in success to be safe if structure varies.
    return this.responseService.success(result, 'Payments retrieved successfully');
  }

  @Post('pos')
  @ApiOperation({
    summary: 'Process POS payment - unified entry point for all POS sales',
  })
  @ApiResponse({
    status: 201,
    description: 'POS payment processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        order: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            order_number: { type: 'string' },
            status: { type: 'string' },
            payment_status: { type: 'string' },
            total_amount: { type: 'number' },
          },
        },
        payment: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            amount: { type: 'number' },
            payment_method: { type: 'string' },
            status: { type: 'string' },
            transaction_id: { type: 'string' },
            change: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async processPosPayment(
    @Body() createPosPaymentDto: CreatePosPaymentDto,
    @Request() req,
  ) {
    const result = await this.paymentsService.processPosPayment(
      createPosPaymentDto,
      req.user,
    );
    return this.responseService.created(result, 'POS payment processed successfully');
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Get payment methods for the current user store' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods retrieved successfully',
  })
  async getMyStorePaymentMethods(@Request() req) {
    if (!req.user.store_id) {
      return this.responseService.error(
        'User session does not have a specific store context',
        'Missing store_id in user context',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.paymentsService.getStorePaymentMethods(
      req.user.store_id,
      req.user,
    );
    return this.responseService.success(result, 'Payment methods retrieved successfully');
  }

  @Get(':paymentId')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiResponse({ status: 200, description: 'Payment retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async findOne(@Param('paymentId') paymentId: string, @Request() req) {
    const result = await this.paymentsService.findOne(paymentId, req.user);
    return this.responseService.success(result, 'Payment retrieved successfully');
  }

  @Get('stores/:storeId/payment-methods')
  @ApiOperation({ summary: 'Get payment methods for a store' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods retrieved successfully',
  })
  async getStorePaymentMethods(
    @Param('storeId') storeId: string,
    @Request() req,
  ) {
    const result = await this.paymentsService.getStorePaymentMethods(
      parseInt(storeId),
      req.user,
    );
    return this.responseService.success(result, 'Payment methods retrieved successfully');
  }

  @Post('stores/:storeId/payment-methods')
  @ApiOperation({ summary: 'Create payment method for a store' })
  @ApiResponse({
    status: 201,
    description: 'Payment method created successfully',
  })
  async createStorePaymentMethod(
    @Param('storeId') storeId: string,
    @Body() createPaymentMethodDto: any,
    @Request() req,
  ) {
    const result = await this.paymentsService.createStorePaymentMethod(
      parseInt(storeId),
      createPaymentMethodDto,
      req.user,
    );
    return this.responseService.created(result, 'Payment method created successfully');
  }
}
