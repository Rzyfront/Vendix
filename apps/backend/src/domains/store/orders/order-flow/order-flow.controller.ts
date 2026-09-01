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
import {
  AuditService,
  AuditResource,
} from '@common/audit/audit.service';
import { VendixHttpException } from '@common/errors';
import { ErrorCodes } from '@common/errors/error-codes';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

@Controller('store/orders/:orderId/flow')
@UseGuards(PermissionsGuard)
export class OrderFlowController {
  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly refundFlowService: RefundFlowService,
    private readonly refundMethodsService: RefundMethodsService,
    private readonly responseService: ResponseService,
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · emits the timeline rows
    // (`payment.attempt`, `payment.succeeded`, `payment.failed`) for the
    // canonical pay endpoint. AuditModule is `@Global()` so the import is
    // resolved without touching the OrderFlowModule wiring.
    private readonly auditService: AuditService,
    // Round 3 MAJOR #8 — needed by the controller to enrich `payment.attempt`
    // with `amount`, `customer_id`, `is_draft` and `requires_payment`. The
    // service's `getOrder` is private, so the controller reads the order
    // directly via the store-scoped prisma. The query is single-row, scoped
    // to the store already in context.
    private readonly prisma: StorePrismaService,
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
    @Req() req: AuthenticatedRequest,
  ) {
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · payment lifecycle observ.
    //
    // Emit three distinct timeline rows for the canonical pay path:
    //  - `payment.attempt`: as soon as the request reaches the controller
    //    (intent recorded even if the service throws before any DB write).
    //  - `payment.succeeded`: after the service returns without throwing —
    //    the cashier sees a 200 and the timeline agrees.
    //  - `payment.failed`: every error from the service — `VendixHttpException`
    //    (typed code in `details`) and bare errors (HTTP 500) alike. We always
    //    rethrow so the filter owns the HTTP shape; the audit row is purely
    //    observability, never a blocker.
    //
    // Correlation: `request_id` comes from `RequestContextService` (set by the
    // request-context interceptor on every request, possibly caller-supplied
    // via `X-Request-Id`). The structured prefix
    // `[store=<id> order=<id> req=<rid> user=<id>]` matches the editor
    // pattern so a single grep covers both flows.
    const ctxUser = req?.user;
    const auditCtx = () => ({
      store_id: ctxUser?.store_id,
      user_id: ctxUser?.id,
      request_id: RequestContextService.getRequestId(),
    });

    // Round 3 MAJOR #9 — gate `payment.attempt` so it does NOT fire when the
    // order is already past `pay`. Previously a stale POST against a refunded
    // order still emitted `payment.attempt`, polluting the timeline with a row
    // for an intent that was structurally rejected by the service. We peek at
    // the available actions and skip the audit (and the call) when `pay` is
    // no longer in the action list. The action-set lookup is read-only and
    // uses the same `getOrder`/`state` resolution as the rest of the flow.
    //
    // QUI-POS-E2E: BUT `getAvailableActions` no incluye `pay` para `draft`
    // (el SFM espera `created`+), aunque `OrderFlowService.payOrder` SÍ
    // auto-promueve `draft → created` con `promoteDraftToCreated`. Si
    // aplicáramos el gate ciegamente, los drafts POS nuevos no podrían
    // pagarse nunca desde el editor (CP-POS-CREAR-EDITAR-COBRAR-001 happy
    // path). Excluimos `draft` del gate y dejamos que `payOrder` haga la
    // promoción idempotente.
    const availableActions =
      await this.orderFlowService.getAvailableActions(orderId);
    const payAction = (availableActions as any[])?.find?.(
      (a) => a?.code === 'pay',
    );
    const orderRow = await this.orderFlowService.getOrder(orderId);
    const isDraft = orderRow?.state === 'draft';
    const payEnabled = isDraft || !!payAction?.enabled;

    if (!payEnabled) {
      // Mirror the canonical error shape so the cashier sees the same code
      // the editor / order-detail pages already handle, AND the timeline is
      // left clean of `payment.attempt` rows for terminal states.
      throw new VendixHttpException(
        ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001,
        undefined,
        {
          order_id: orderId,
          available_actions: (availableActions as any[])?.map?.(
            (a) => a?.code,
          ),
          reason: 'pay is not in the available actions for this order state',
        },
      );
    }

    // Round 3 MAJOR #8 — enrich `payment.attempt` with the financial context
    // a timeline reader needs: amount, customer_id, is_draft and
    // requires_payment. Without these the audit row only told you "someone
    // tried to pay" — support couldn't pivot from a row to the actual
    // order state or who was being invoiced.
    const storeCtx = RequestContextService.getContext();
    const orderForAudit = await this.prisma.orders
      .findFirst({
        where: {
          id: orderId,
          ...(storeCtx?.store_id ? { store_id: storeCtx.store_id } : {}),
        },
        select: {
          grand_total: true,
          customer_id: true,
          state: true,
        },
      })
      .catch(() => null);
    const orderCtx = {
      amount: orderForAudit ? Number(orderForAudit.grand_total ?? 0) : null,
      customer_id: orderForAudit?.customer_id ?? null,
      is_draft: orderForAudit?.state === 'draft',
      requires_payment: true,
    };

    try {
      await this.auditService.logCustom(
        ctxUser?.id,
        'payment.attempt',
        AuditResource.PAYMENTS,
        {
          order_id: orderId,
          payment_type: dto?.payment_type,
          store_payment_method_id: dto?.store_payment_method_id,
          ...orderCtx,
          ...auditCtx(),
        },
        orderId,
      );

      const result = await this.orderFlowService.payOrder(orderId, dto);
      await this.auditService.logCustom(
        ctxUser?.id,
        'payment.succeeded',
        AuditResource.PAYMENTS,
        {
          order_id: orderId,
          payment_type: dto?.payment_type,
          // Pull the transaction id the service returned so support can pivot
          // from a timeline row straight to the provider-side payment.
          transaction_id:
            (result as any)?.payment?.transaction_id ?? null,
          ...orderCtx,
          ...auditCtx(),
        },
        orderId,
      );
      return this.responseService.success(result, 'Order paid successfully');
    } catch (error) {
      // DO NOT swallow: the filter still owns the HTTP shape (typed code
      // preserved when `error instanceof VendixHttpException`, generic 500
      // otherwise). The audit row + structured log are additive.
      const errorCode =
        error instanceof VendixHttpException
          ? (error as any).errorCode
          : (error as any)?.code ?? 'n/a';
      const ctx = auditCtx();
      this.payOrderLog.error(
        `[OrderFlow.payOrder failed] store=${ctx.store_id ?? 'unknown'} order=${orderId} req=${ctx.request_id ?? 'unknown'} user=${ctx.user_id ?? 'unknown'} errorCode=${errorCode} message=${
          (error as Error)?.message ?? 'unknown'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      try {
        await this.auditService.logCustom(
          ctxUser?.id,
          'payment.failed',
          AuditResource.PAYMENTS,
          {
            order_id: orderId,
            payment_type: dto?.payment_type,
            error_code: errorCode,
            error_message:
              (error as Error)?.message ?? 'unknown',
            ...ctx,
          },
          orderId,
        );
      } catch (auditErr) {
        // Audit failure must never mask the original error. Log and rethrow.
        this.payOrderLog.warn(
          `[OrderFlow.payOrder audit.failed] order=${orderId} message=${(auditErr as Error).message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Per-handler logger so the structured prefix above is grep-friendly without
   * adding instance state to every controller.
   */
  private readonly payOrderLog = new (require('@nestjs/common').Logger)(
    OrderFlowController.name + '.payOrder',
  );

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

  // T9 / QUI-652 — entrega a NIVEL DE ITEM (un plato, una cerveza, etc).
  // Antes solo existía el endpoint nivel-sesion
  // (`PATCH /store/tables/sessions/:id/items/:orderItemId/deliver`),
  // inaccesible para ordenes sin mesa (POS / take-away / domicilio). Esta
  // ruta abre ese hueco y usa el mismo permiso de flujo de orden que el
  // resto del namespace `store/orders/:orderId/flow`, para que un mesero
  // con `order_flow:create` pueda entregar items en cualquier orden de su
  // tienda sin escalar privilegio.
  //
  // Va acá (no en `orders.controller.ts`) porque el `@Controller` del
  // namespace de flow ya agrupa las acciones de progreso de la orden
  // (`ship`, `deliver`, `confirm-delivery`, `finish`, ...); el CRUD plano
  // de orden queda para lo que es (lectura, edicion de borrador).
  @Patch('items/:orderItemId/deliver')
  @Permissions('store:orders:order_flow:create')
  @HttpCode(HttpStatus.OK)
  async deliverOrderItem(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Param('orderItemId', ParseIntPipe) orderItemId: number,
  ) {
    const order = await this.orderFlowService.deliverOrderItem(
      orderId,
      orderItemId,
    );
    return this.responseService.success(
      order,
      'Order item delivered successfully',
    );
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
