import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Logger,
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
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';

/**
 * CP-POS-CREAR-EDITAR-COBRAR-001 — F.1 · defense in depth.
 *
 * Class-level `PermissionsGuard` so EVERY endpoint declared in this controller
 * must be explicitly decorated with `@Permissions(...)`. The previous behavior
 * (no class guard, ad-hoc checks inside services) let unrelated legacy
 * endpoints answer 200 without going through `PermissionsGuard` — the
 * plan-critical POS create path is hardened below so a missing future decorator
 * on a new sibling endpoint cannot bypass RBAC by accident.
 *
 * Endpoint-by-endpoint permissions stay explicit so the policy lives next to
 * the route, not hidden in a service.
 */
@ApiTags('Payments')
@Controller('store/payments')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Process payment for existing order' })
  @ApiResponse({ status: 200, description: 'Payment processed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async processPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @Request() req,
  ) {
    const result = await this.paymentsService.processPayment(
      createPaymentDto,
      req.user,
    );
    return this.responseService.success(
      result,
      'Payment processed successfully',
    );
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
    return this.responseService.created(
      result,
      'Order created and payment processed',
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
    const result = await this.paymentsService.refundPayment(
      paymentId,
      refundPaymentDto,
      req.user,
    );
    return this.responseService.success(
      result,
      'Payment refunded successfully',
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
    const result = await this.paymentsService.getPaymentStatus(
      paymentId,
      req.user,
    );
    return this.responseService.success(result, 'Payment status retrieved');
  }

  @Post('pos/confirm-wompi-payment/:paymentId')
  @ApiOperation({
    summary:
      'Force-confirm a POS Wompi payment by polling Wompi and applying the canonical state',
  })
  @ApiResponse({ status: 200, description: 'Payment state synced from Wompi' })
  @ApiResponse({
    status: 400,
    description: 'Not a Wompi payment / config missing',
  })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async confirmPosWompiPayment(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Request() req,
  ) {
    const result = await this.paymentsService.confirmPosWompiPayment(
      paymentId,
      req.user,
    );
    return this.responseService.success(result, 'Wompi payment status synced');
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
    return this.responseService.success(
      result,
      'Payments retrieved successfully',
    );
  }

  @Post('pos')
  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — F.1 · explicit POS create permission.
   *
   * `store:payments:process` is the canonical name seeded in
   * `permissions-roles.seed.ts` for the role that may create a payment
   * (cashier, owner, admin). Pinning the permission here makes it impossible
   * to bypass via a JWT that only carries `store:orders:create` — the cashier
   * identity must also satisfy the payment-processing role, otherwise the
   * 403 fires before the service even resolves the request.
   *
   * The customer gate (POS_CUSTOMER_REQUIRED_001), the draft invariant
   * (POS_DRAFT_REQUIRES_PAYMENT_001), and the audit emission
   * (`order.draft_saved`) all live downstream of this guard, so an attacker
   * who somehow reaches the handler still trips the typed errors and the
   * request_id-tagged log.
   */
  @Permissions('store:payments:process')
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
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · structured error logging.
    //
    // `processPosPayment` already throws typed `VendixHttpException` for every
    // business gate (customer required, draft conflict, stock, etc.). The
    // AllExceptionsFilter preserves `error_code` + `details` so the frontend
    // sees the right thing. What this catch adds: a server-side log line
    // tagged with the structured prefix `[store=<id> order=<id> req=<rid>]
    // user=<id>` so support / Sentry can pivot a 4xx from a frontend toast
    // straight to the right stack frame. We rethrow so the filter still owns
    // the HTTP shape — `VendixHttpException` instances are NEVER rewritten,
    // bare `Error` is just logged and propagated as-is.
    try {
      const result = await this.paymentsService.processPosPayment(
        createPosPaymentDto,
        req.user,
      );
      return this.responseService.created(
        result,
        'POS payment processed successfully',
      );
    } catch (error) {
      const ctx = (req as any)?.requestContext;
      const storeId =
        ctx?.store_id ?? createPosPaymentDto.store_id ?? 'unknown';
      const orderId =
        (error as any)?.order_id ??
        createPosPaymentDto.order_id ??
        'unknown';
      const userId = req?.user?.id ?? 'unknown';
      const requestId = ctx?.request_id ?? 'unknown';
      const errorCode =
        (error as any)?.errorCode ?? (error as any)?.code ?? 'n/a';
      // Use the controller-scoped logger prefix to make the line easy to grep.
      this.logControllerError(
        `[POS payment error] store=${storeId} order=${orderId} req=${requestId} user=${userId} errorCode=${errorCode}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Helper for the structured-error log line above. Pulled out so the catch
   * stays readable and so we can swap a real Sentry call here without
   * rewriting the handler.
   */
  private logControllerError(prefix: string, error: unknown): void {
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(prefix, stack);
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
    return this.responseService.success(
      result,
      'Payment methods retrieved successfully',
    );
  }

  @Get(':paymentId')
  @ApiOperation({ summary: 'Get payment by ID' })
  @ApiResponse({ status: 200, description: 'Payment retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async findOne(@Param('paymentId') paymentId: string, @Request() req) {
    const result = await this.paymentsService.findOne(paymentId, req.user);
    return this.responseService.success(
      result,
      'Payment retrieved successfully',
    );
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
    return this.responseService.success(
      result,
      'Payment methods retrieved successfully',
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
    const result = await this.paymentsService.createStorePaymentMethod(
      parseInt(storeId),
      createPaymentMethodDto,
      req.user,
    );
    return this.responseService.created(
      result,
      'Payment method created successfully',
    );
  }
}
