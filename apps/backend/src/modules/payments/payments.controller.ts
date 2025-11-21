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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  CreateOrderPaymentDto,
  RefundPaymentDto,
  PaymentQueryDto,
  CreatePosPaymentDto,
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
    return this.paymentsService.processPosPayment(
      createPosPaymentDto,
      req.user,
    );
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Get payment methods for the current user store' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods retrieved successfully',
  })
  async getMyStorePaymentMethods(@Request() req) {
    if (!req.user.store_id) {
      // Si el usuario no tiene scope de tienda (ej. es org admin global),
      // intentamos usar la primera tienda a la que tiene acceso o lanzamos error.
      // Para POS, se asume que hay un contexto de tienda.
      // Sin embargo, el error original venía de intentar usar ID 1.
      // Vamos a permitir que el servicio maneje o lanzar error si no hay contexto.
      throw new BadRequestException(
        'User session does not have a specific store context',
      );
    }
    return this.paymentsService.getStorePaymentMethods(
      req.user.store_id,
      req.user,
    );
  }

  @Get(':paymentId')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiResponse({ status: 200, description: 'Payment retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async findOne(@Param('paymentId') paymentId: string, @Request() req) {
    return this.paymentsService.findOne(paymentId, req.user);
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
    return this.paymentsService.getStorePaymentMethods(
      parseInt(storeId),
      req.user,
    );
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
    return this.paymentsService.createStorePaymentMethod(
      parseInt(storeId),
      createPaymentMethodDto,
      req.user,
    );
  }
}
