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
import { AuditService, AuditResource } from '../../../common/audit/audit.service';
import { RequestContextService } from '../../../common/context/request-context.service';

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
 *
 * A.0 P0 — handler→llamador→permiso (CP-POLLO-ARABE-727 / QUI-727).
 *
 * `PermissionsGuard` falla ABIERTO solo cuando un handler NO declara
 * `@Permissions(...)`; el objetivo de A.0 es que NINGÚN endpoint de dinero
 * quede sin decorar. El permiso se mapea POR LLAMADOR REAL, no por el nombre
 * semánticamente obvio — `cashier` NO tiene `store:payments:process` (ese permiso
 * ni siquiera existe como fila en la seed); los flujos del POS se rigen por
 * `store:pos:access`, que `cashier` sí tiene (permissions-roles.seed.ts:4915).
 *
 * | Línea | Handler | Ruta | Permiso | Llamador |
 * |-------|---------|------|---------|----------|
 * | :71  | processPayment          | POST /store/payments                                | `store:pos:access`  | cashier POS — pos-api.service.ts:129 (FB-15) |
 * | :90  | processPaymentWithOrder | POST /store/payments/with-order                     | `store:pos:access`  | cashier POS — pos-api.service.ts:108 |
 * | :111 | refundPayment           | POST /store/payments/:paymentId/refund              | `store:pos:access`  | cashier POS — pos-api.service.ts:136-138 |
 * | :131 | getPaymentStatus        | GET /store/payments/:paymentId/status               | `store:pos:access`  | cashier POS / wompi poll — wompi.service.ts:99-110 |
 * | :146 | confirmPosWompiPayment  | POST /store/payments/pos/confirm-wompi-payment/:id   | `store:pos:access`  | cashier POS — pos-payment.service.ts:1161 (sobreescribe el bucket "admin" del plan: el llamador real es el POS) |
 * | :168 | findAll                 | GET /store/payments                                 | `store:settings:read`  | admin — listado de pagos |
 * | :184 | processPosPayment       | POST /store/payments/pos                           | `store:pos:access`  | cashier POS (ya decorado) |
 * | :413 | getMyStorePaymentMethods| GET /store/payments/payment-methods                 | `store:settings:read`  | admin/settings — lectura de métodos de pago |
 * | :437 | findOne                 | GET /store/payments/:paymentId                     | `store:settings:read`  | admin — detalle de un pago |
 * | :449 | getStorePaymentMethods  | GET /store/payments/stores/:storeId/payment-methods| `store:settings:read`  | admin/settings |
 * | :469 | createStorePaymentMethod| POST /store/payments/stores/:storeId/payment-methods| `store:settings:write` | admin/settings — bloquea a cashier (cashier NO tiene store:settings:write) |
 *
 * Por qué `store:settings:*` para el bucket admin: no existe ninguna fila de
 * permiso `store:payments:*` ni `store:payment_methods:*` en
 * `permissions-roles.seed.ts` (los `includes('store:payments:read/process')` de
 * los filtros casan contra la DB y no corresponden a ninguna fila creada).
 * `store:settings:read`/`store:settings:write` son las filas más próximas que
 * owner/admin ya poseen. El cajero solo tiene `store:settings:read` (nunca el
 * `write`), por eso los writes de :469 (y los de `store-payment-methods`)
 * quedan reservados al admin y el cajero no puede reescribir a qué cuenta
 * bancaria llega el dinero. Los reads siguen abiertos al cajero porque los
 * necesita en el checkout sin riesgo (leer no muta `custom_config.accounts`).
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
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B2.
    // AuditService is now injected at the controller layer (not only in
    // OrderFlowService) so the POS payment timeline has its own three
    // canonical rows: `payment.attempt` BEFORE the service call,
    // `payment.succeeded` AFTER, `payment.failed` ON error. The handler
    // stays thin: each emission lives in the same try/catch so a
    // downstream failure never swallows the timeline signal.
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @Permissions('store:pos:access')
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
  @Permissions('store:pos:access')
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
  @Permissions('store:pos:access')
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
  @Permissions('store:pos:access')
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
  @Permissions('store:pos:access')
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
  @Permissions('store:settings:read')
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
  // QUI-POS-E2E: la seed no crea `store:payments:process` — usa el permiso
  // POS amplio existente `store:pos:access` que ya está asignado a owner/
  // admin/employee. Mantiene el gate de PermissionsGuard sin inventar
  // una nueva fila de permiso.
  @Permissions('store:pos:access')
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
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B2.
    //
    // Emit `payment.attempt` BEFORE the service runs. Best-effort try/catch
    // because an audit write must NEVER block a charge — losing one timeline
    // row is preferable to a 500 masking a real cash event.
    const ctx = (req as any)?.requestContext;
    const requestId =
      ctx?.request_id ??
      RequestContextService.getRequestId() ??
      null;
    const userId = req?.user?.id ?? null;
    const attemptStoreId =
      createPosPaymentDto.store_id ?? ctx?.store_id ?? null;
    const attemptMetadata: Record<string, any> = {
      request_id: requestId,
      store_id: attemptStoreId,
      user_id: userId,
      // The DTO does not declare `amount`/`order_id`/`payment_type`, so we
      // cast to any for the runtime read. The shape is mirrored by the
      // POS UI; an undefined value becomes null in the audit row.
      amount: (createPosPaymentDto as any)?.amount ?? null,
      is_draft: createPosPaymentDto.is_draft ?? false,
      requires_payment: createPosPaymentDto.requires_payment ?? false,
      customer_id: createPosPaymentDto.customer_id ?? null,
      order_id: (createPosPaymentDto as any)?.order_id ?? null,
    };
    try {
      await this.auditService.log({
        userId: userId ?? undefined,
        action: 'payment.attempt',
        resource: AuditResource.PAYMENTS,
        storeId: attemptStoreId ?? undefined,
        metadata: attemptMetadata,
      });
    } catch (err) {
      this.logControllerError(
        `[POS payment.attempt audit failed] store=${attemptStoreId} req=${requestId} user=${userId}`,
        err,
      );
    }

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
      // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B2.
      // `payment.succeeded` row, scoped to the now-known order + payment.
      // Both `result.order.id` and `result.payment?.id` are guaranteed by
      // `processPosPayment` for the happy path; we tolerate nulls so a
      // partial response still leaves a timeline trail.
      try {
        const transactionId =
          (result as any)?.payment?.transaction_id ?? null;
        await this.auditService.log({
          userId: userId ?? undefined,
          action: 'payment.succeeded',
          resource: AuditResource.PAYMENTS,
          storeId: attemptStoreId ?? undefined,
          resourceId: (result as any)?.payment?.id ?? undefined,
          metadata: {
            request_id: requestId,
            store_id: attemptStoreId,
            user_id: userId,
            transaction_id: transactionId,
            payment_amount:
              (result as any)?.payment?.amount ??
              (createPosPaymentDto as any)?.amount ??
              null,
            currency:
              (result as any)?.payment?.currency ??
              createPosPaymentDto.currency ??
              null,
            payment_type:
              (result as any)?.payment?.payment_type ??
              (createPosPaymentDto as any)?.payment_type ??
              null,
            order_id:
              (result as any)?.order?.id ??
              (createPosPaymentDto as any)?.order_id ??
              null,
          },
        });
      } catch (err) {
        this.logControllerError(
          `[POS payment.succeeded audit failed] store=${attemptStoreId} req=${requestId} user=${userId}`,
          err,
        );
      }
      return this.responseService.created(
        result,
        'POS payment processed successfully',
      );
    } catch (error) {
      const storeId =
        ctx?.store_id ?? createPosPaymentDto.store_id ?? 'unknown';
      const orderId =
        (error as any)?.order_id ??
        (createPosPaymentDto as any)?.order_id ??
        'unknown';
      const userIdStr = req?.user?.id ?? 'unknown';
      const errorCode =
        (error as any)?.errorCode ?? (error as any)?.code ?? 'n/a';
      // Use the controller-scoped logger prefix to make the line easy to grep.
      this.logControllerError(
        `[POS payment error] store=${storeId} order=${orderId} req=${requestId} user=${userIdStr} errorCode=${errorCode}`,
        error,
      );
      // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B2.
      // `payment.failed` row, with the typed error_code + the stage at
      // which the failure surfaced (request/validate/commit/etc.). We
      // strip the message body and only carry the error code: the full
      // stack goes through the existing logger line above so a hostile
      // input can never poison an audit row.
      try {
        await this.auditService.log({
          userId: userId ?? undefined,
          action: 'payment.failed',
          resource: AuditResource.PAYMENTS,
          storeId: attemptStoreId ?? undefined,
          metadata: {
            request_id: requestId,
            store_id: storeId,
            user_id: userId,
            order_id:
              typeof orderId === 'number'
                ? orderId
                : (createPosPaymentDto as any)?.order_id ?? null,
            error_code: typeof errorCode === 'string' ? errorCode : 'n/a',
            error_stage:
              (error as any)?.stage ??
              (error as any)?.details?.stage ??
              null,
          },
        });
      } catch (err) {
        this.logControllerError(
          `[POS payment.failed audit failed] store=${storeId} req=${requestId} user=${userIdStr}`,
          err,
        );
      }
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
  @Permissions('store:settings:read')
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
  @Permissions('store:settings:read')
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
  @Permissions('store:settings:read')
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
  @Permissions('store:settings:write')
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
