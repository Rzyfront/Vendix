import { assertNoActiveFinancialSplit } from '../shared/financial-split-policy';
import { lockOrderLifecycle } from './order-lifecycle-lock.util';
import {
  getCancellationBlocker,
  SETTLED_PAYMENT_STATES,
  CANCELABLE_ORDER_STATES,
  hasNonDirectSettledPayment,
  FULFILLED_PAYMENT_CANCELABLE_STATES,
  PAYMENT_CANCELABLE_STATES,
} from './order-cancellation-policy.util';
import {
  canPay,
  canCancelPayment,
  canCancelPaymentAsRole,
  canRefund,
  canCancel,
  canAssignShipping,
  canConfirmDelivery,
  canDeliverItem,
  canEditOrder,
  canReactivateAsRole,
  canFastTrack,
  canCreditPayment,
  requiresPaymentRegistration,
  canDispatchOrder,
  canManualShip,
  canReadyForPickupBeforePayment,
  canDirectDeliver,
  canCollectViaShip,
  hasKitchenLinesAwaitingHandoff,
  describeKitchenHandoffBlocker,
  kitchenHandoffBlocker,
  OrderActionSnapshot,
} from './order-action-policy.util';
import { OrderSseService } from '../services/order-sse.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { Prisma, order_delivery_type_enum, order_state_enum, payments_state_enum } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { resolveTip } from '@common/utils/tip.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FinancialSplitErrors } from 'src/common/errors/financial-split-error-codes';
import {
  PayOrderDto,
  PaymentType,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  CancelPaymentDto,
  FastTrackOrderDto,
  ReactivateOrderDto,
} from './dto';
import { SettingsService } from '../../settings/settings.service';
import { DEFAULT_POS_AUTO_EMIT } from '../../settings/interfaces/store-settings.interface';
import {
  POS_SALE_COMPLETED_EVENT,
  PosSaleCompletedEvent,
} from '../../invoicing/pos/pos-sale-completed.event';
import { isPresentialPosSale } from '../../invoicing/pos/presential-pos-sale';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../cash-registers/movements/movements.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { AutoEntryService } from '../../accounting/auto-entries/auto-entry.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';
import {
  StockValidatorService,
  type InsufficientStockItem,
} from '../../inventory/shared/services/stock-validator.service';
import { SellableStockAllocator } from '../../inventory/shared/services/sellable-stock-allocator.service';
import { storeIsRestaurant } from '@common/helpers/industry-capabilities.helper';
import { OrderEtaService } from '../services/order-eta.service';
import { KitchenFireService } from '../../kitchen-fire/kitchen-fire.service';
import { deriveDeliveryType } from '../../shipping/shipping-derivation.util';
import { ShippingTaxService } from '../../shipping/services/shipping-tax.service';
import { ShippingCalculatorService } from '../../shipping/shipping-calculator.service';
import {
  EMPTY_SHIPPING_TAX,
  type ShippingTaxSnapshot,
} from '../../shipping/utils/shipping-tax.util';
import {
  AuditService,
  AuditResource,
} from '@common/audit/audit.service';
import { RefundFlowService, type CancellationPendingLeg } from './services/refund-flow.service';
import {
  getSettledOrderAmount,
  isOrderFullyPaid,
} from '../../payments/services/payment-validator.service';
import {
  normalizePaymentLegs,
  type NormalizedLeg,
  type PaymentLegMethodInfo,
} from '../../payments/utils/payment-legs.util';
import { PaymentError, LEGACY_TO_NEW } from '../../payments/utils/payment-errors';
import { PaymentGatewayService } from '../../payments/services/payment-gateway.service';
import { OrderHistoryService } from '../order-history/order-history.service';
import type { OrderEventSource } from '../order-history/order-history.types';
import {
  prorateWithholdingLines,
  resolvePaymentReceivedSaleFields,
  type PaymentReceivedSaleFields,
} from '../../payments/utils/payment-sale-share.util';
import type { WithholdingLine } from '@common/interfaces/withholding-breakdown.interface';
import { resolvePaymentInvoiceBranch } from '../../accounting/auto-entries/payment-invoice-branch.util';
import { buildOrderSaleTaxPayload } from '../../payments/utils/order-sale-tax-payload.util';
import { buildPaymentReceivedEvents } from '../../payments/utils/payment-received-event.util';
import {
  WithholdingFlowService,
  type WithholdingResolution,
} from '../../withholding-tax/withholding-flow.service';

type OrderState = order_state_enum;
type DraftReservationKey = {
  productId: number;
  variantId: number | undefined;
  locationId: number;
  /** Stock units THIS claim added on top of whatever was already reserved
   * for the order/identity. Bounds `compensateClaimedDraftPayment`'s release
   * so a failed payment never releases an older reservation on the order
   * (docs/plans/no-overselling-stock-guard-plan.md step 4). */
  quantity: number;
};

type ConsumedLeafDisposition = {
  product_id: number;
  product_variant_id: number | null;
  location_id: number | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  unknown_cost: boolean;
};

/**
 * Máquina de estados de la orden. Se EXPORTA (QUI-599) para que el dry-run del
 * carril masivo pueda decir de antemano si una transición será canónica o
 * forzada, sin duplicar el mapa — una copia en el servicio de bulk se
 * desincronizaría en cuanto se abriera una arista nueva aquí.
 *
 * Solo lectura para los consumidores externos: la autoridad sobre las aristas
 * sigue siendo este archivo.
 */
export const VALID_TRANSITIONS: Record<OrderState, OrderState[]> = {
  draft: ['created', 'cancelled'],
  created: ['pending_payment', 'processing', 'finished', 'cancelled'],
  pending_payment: ['processing', 'finished', 'cancelled'],
  processing: ['shipped', 'delivered', 'finished', 'cancelled'],
  shipped: ['delivered'],
  // 'processing' pertenece SOLO a revertKitchenOrderDelivery (puente KDS).
  // El PATCH genérico no puede usarla como transición legal: necesita forzado
  // explícito con motivo del operador y auditoría forced:true.
  delivered: ['finished', 'refunded', 'processing'],
  finished: ['refunded'],
  cancelled: ['pending_payment', 'created', 'processing'],
  refunded: [],
  // Bug 7: estado intermedio post-cobro con envío a domicilio + platos.
  // Sólo avanza a shipped (Despachar) o delivered (Marcar entregado).
  // Finalizar va por PATCH /store/orders/:id?state=finished (atajo).
  pending_delivery: ['shipped', 'delivered'],
};

const CANCELABLE_STATES: OrderState[] = [...CANCELABLE_ORDER_STATES];
const REFUNDABLE_STATES: OrderState[] = ['delivered', 'finished'];

// Una mesa se consume en el local: dine_in, pickup y direct_delivery no
// requieren despacho. Mantener esta lista alineada con la del detalle de orden.
const SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES = new Set<order_delivery_type_enum>([
  order_delivery_type_enum.pickup,
  order_delivery_type_enum.direct_delivery,
  order_delivery_type_enum.dine_in,
]);

/**
 * Resultado del puente de cocina (KDS → orden).
 *
 * Los listeners SSE deciden con `transitioned`, NO con el `state` devuelto:
 * un no-op idempotente devuelve la fila tal cual (p.ej. una orden que ya
 * estaba en `delivered`), y chequear solo `order.state` emitiría un
 * `status_changed` fantasma con un `old_state` inventado. `previousState` es
 * el estado real observado antes de intentar la transición — el listener lo
 * usa como `old_state` sin literales hardcodeados.
 */
export interface KitchenBridgeResult {
  order: any;
  transitioned: boolean;
  previousState: order_state_enum | null;
}

/**
 * Monotonic reconciliation ladder for `reconcileOrderFromDispatch`.
 *
 * The COD lifecycle advances a linked order only forward along this exact path:
 *   pending_payment → processing → shipped → delivered → finished
 *
 * Every consecutive edge here is a real edge in {@link VALID_TRANSITIONS}
 * (pending_payment→processing, processing→shipped, shipped→delivered,
 * delivered→finished), so walking rung-by-rung never produces an invalid
 * transition. States NOT on this ladder (draft/created/cancelled/refunded) are
 * never advanced by the reconciler. `indexOf` gives each rung its rank; the
 * reconciler computes `finalRank = max(currentRank, cappedTargetRank)` so it
 * can only move up, never back.
 */
const RECONCILE_LADDER: OrderState[] = [
  'pending_payment',
  'processing',
  'shipped',
  'delivered',
  'finished',
];

/** COD describes timing, not the eventual tender. Stripe/gateway cards are
 * not physical datáfono payments; the seeded voucher method is. */
export function isActualCodTender(method: { type?: string | null; processing_mode?: string | null } | null | undefined): boolean {
  if (!method || method.processing_mode === 'ON_DELIVERY') return false;
  return ['cash', 'bank_transfer', 'voucher'].includes(method.type ?? '') ||
    (method.type === 'card' && method.processing_mode === 'DIRECT');
}

/**
 * Fase 2 paso 5 — pago `pending` de confirmación MANUAL: todo lo que NO es
 * `wallet`/`wompi` ni contra entrega (`ON_DELIVERY`). Es el pago que el
 * checkout online deja pendiente (`bank_transfer`, `voucher`, tarjeta manual…)
 * y que el personal REGISTRA por `flow/pay` en vez de confirmar con un clic
 * (el paso 6 lo rechaza en `confirmPayment` con
 * `ORD_MANUAL_PAYMENT_REQUIRES_REGISTER_001`; el webhook sigue confirmando).
 *
 * Fail-closed: sin método resoluble no se clasifica (nunca se anula lo que no
 * se puede verificar). Criterio hermano de `MANUAL_METHODS` en
 * `table-sessions.service.ts` (confirmación de mesa que sí escribe en caja),
 * pero inclusivo por tipo: lo que no es billetera/pasarela/contraentrega es
 * manual.
 */
export function isManualConfirmationPending(
  payment: {
    state?: string | null;
    store_payment_method?: {
      system_payment_method?: {
        type?: string | null;
        processing_mode?: string | null;
      } | null;
    } | null;
  } | null | undefined,
): boolean {
  if (!payment || payment.state !== 'pending') return false;
  const system = payment.store_payment_method?.system_payment_method;
  if (!system || system.processing_mode === 'ON_DELIVERY') return false;
  return !['wallet', 'wompi'].includes(system.type ?? '');
}

@Injectable()
export class OrderFlowService {
  private readonly logger = new Logger(OrderFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsService: SettingsService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly orderEtaService: OrderEtaService,
    private readonly orderStockCommit: OrderStockCommitService,
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · audit emission for the pay flow.
    // `payment.attempt` / `payment.succeeded` / `payment.failed` ride this
    // service so the timeline reflects exactly what happened to the cash /
    // state machine. Injected (not global lookup) so the constructor stays
    // the single source of truth for what the service depends on.
    private readonly auditService: AuditService,
    // Seam `cancelOrderItem` (item-scope): cancela el ticket KDS en `pending`
    // in-tx + emite su SSE post-commit vía este servicio. `@Optional()` para
    // no romper las construcciones manuales de 9 args de los specs
    // históricos (ts-jest typecheckea); en prod el provider siempre resuelve
    // vía `KitchenFireModule` (ver `order-flow.module.ts`). Si alguna vez
    // llega `undefined`, `cancelOrderItem` falla fuerte (500 explícito),
    // nunca salta el KDS en silencio.
    @Optional() private readonly kitchenFireService?: KitchenFireService,
    // Copia del impuesto del envío al asignar método + tarifa en `shipOrder`.
    // `@Optional()` por la misma razón que arriba (specs con construcción
    // manual). Sin servicio ⇒ copia vacía (envío sin impuesto), nunca falla.
    @Optional() private readonly shippingTaxService?: ShippingTaxService,
    private readonly moduleRef?: ModuleRef,
    @Optional() private readonly refundFlowService?: RefundFlowService,
    @Optional() private readonly autoEntryService?: AutoEntryService,
    // SSE `order.payment_updated` en `confirmPayment` (pago en vivo guest).
    // `@Optional()` por la misma razón que arriba (specs con construcción
    // manual). En prod siempre resuelve vía `forwardRef(() => OrdersModule)`
    // en `order-flow.module.ts` — mismo patrón que los listeners KDS.
    @Optional() private readonly orderSse?: OrderSseService,
    // Plan order-truth-and-invoice-tz — Paso 6. Único escritor de
    // `order_events` (ver `OrderHistoryModule`). `@Optional()` por la misma
    // razón que el resto de dependencias tardías: no romper las specs
    // históricas que construyen el servicio a mano con una lista corta de
    // args. Cuando no resuelve (specs), cada llamada usa `?.record(...)` y
    // se vuelve un no-op silencioso — nunca lanza y nunca cambia el
    // resultado del flujo (regla del plan). En prod siempre resuelve vía
    // `OrderHistoryModule` (ver `order-flow.module.ts`).
    @Optional() private readonly orderHistoryService?: OrderHistoryService,
    // docs/plans/no-overselling-stock-guard-plan.md step 4 —
    // `promoteDraftToCreated`'s strict guard. `@Optional()` + trailing
    // position for the same reason as the deps above: ~20 positional `new
    // OrderFlowService(...)` constructions in order-flow.service.spec.ts /
    // order-flow-forced-state.spec.ts must not break. In prod always
    // resolves (`orders.module.ts` provides `StockValidatorService`
    // directly). When undefined (legacy specs), the strict pre-check is a
    // no-op and `reserveStock`'s own `validate_availability` still enforces
    // the hard floor per identity.
    @Optional() private readonly stockValidator?: StockValidatorService,
    @Optional() private readonly sellableStockAllocator?: SellableStockAllocator,
    // Plan PLAN-pago-multimetodo-fixes paso 1 — objetivo 4: `createLegPayments`
    // valida `bank_account_id` con el mismo gateway que usa el POS
    // (`payments.service.ts:5275/5544`) antes de persistir el tramo.
    // `forwardRef` porque `PaymentsModule` ya declara `forwardRef(() =>
    // OrderFlowModule)` (payments.module.ts) — ciclo existente, mismo patrón
    // que `RefundFlowService.paymentGatewayService`
    // (order-flow/services/refund-flow.service.ts:149). `@Optional()` +
    // posición final por la misma razón que el resto de dependencias
    // tardías: no romper las ~20 construcciones posicionales de los specs
    // históricos. Sin resolver (specs), un tramo con `bank_account_id`
    // rechaza fail-closed en vez de confiar en el id crudo del navegador.
    @Optional()
    @Inject(forwardRef(() => PaymentGatewayService))
    private readonly paymentGatewayService?: PaymentGatewayService,
    // Paso 4 (unificación del cálculo de envío —
    // `vendix-shipping-distance-pricing`) — `shipOrder` cotiza la tarifa con
    // el mismo cálculo único que orders/payments (umbral de envío gratis,
    // costo por unidad/peso y distancia) en vez del atajo
    // `chargeForRate(base_cost)`, que los ignoraba todos. `@Optional()` +
    // posición final por la misma razón que el resto de dependencias
    // tardías: no romper las ~20 construcciones posicionales de los specs
    // históricos. Sin resolver (specs, o tarifa fuera de las opciones
    // calculadas) `shipOrder` cae al atajo histórico.
    @Optional() private readonly shippingCalculatorService?: ShippingCalculatorService,
    // Plan PLAN-pago-multimetodo-pendientes paso 2 — `payment.received` para
    // cobros directos de `payOrder`/`confirmPayment` reconoce retención
    // sufrida igual que el POS (`payments.service.ts`).
    // `@Optional()` + posición final por la misma razón que el resto de
    // dependencias tardías: no romper las ~20 construcciones posicionales de
    // los specs históricos. Sin resolver, `emitLegPaymentReceivedEvents`
    // degrada a retención vacía (`logger.warn`), nunca falla el cobro.
    @Optional() private readonly withholdingFlow?: WithholdingFlowService,
  ) {}

  /**
   * Plan order-truth-and-invoice-tz — mapea el `opts.source` interno de
   * `updateOrderState` (string libre, usado también para el payload del
   * evento `order.status_changed`) al `OrderEventSource` cerrado de
   * `order_events`. Los callers HTTP no pasan `source` — `record` ya
   * resuelve 'http'/'system' por su cuenta a partir del contexto de
   * petición. Los que sí lo pasan son puentes no-HTTP: el bridge KDS
   * (`kitchen_bridge`) y el job de auto-finalización (`job`).
   */
  private mapUpdateStateSource(source?: string): OrderEventSource | undefined {
    if (source === 'kitchen_bridge' || source === 'listener') return 'listener';
    if (source === 'job') return 'job';
    if (source === 'webhook') return 'webhook';
    return undefined;
  }

  /**
   * The fire transaction is the source of truth; never restock the sold dish.
   *
   * H2 — `ticketId` scopes the `inventory_transactions` lookup to the ONE
   * kitchen ticket that owns this disposition. A resend/remake reconsumes
   * the SAME `order_item_id` under a NEW ticket, so an unscoped lookup would
   * return every fire's consumption, not just this one's. `ticketId` is
   * `null` only for legacy/edge rows with no resolvable kitchen ticket, in
   * which case this falls back to the previous (unscoped) behavior — never
   * worse than before.
   */
  private async disposeConsumedPreparedLeaves(
    tx: Prisma.TransactionClient,
    orderId: number,
    orderItemId: number,
    organizationId: number,
    disposition: 'reuse' | 'waste',
    reason: string,
    afterCommit: Array<() => void>,
    ticketId: number | null = null,
  ): Promise<ConsumedLeafDisposition[]> {
    // H2 — idempotency keyed by (order_item_id, ticket_id), NOT
    // order_item_id alone: a second ticket for the same dish (remake/resend)
    // must not be swallowed by the first ticket's already-recorded audit row.
    const priorDisposition = await tx.audit_logs.findFirst({
      where: {
        action: 'order_item.prepared_disposition',
        resource_id: orderId,
        AND: ticketId != null
          ? [
              { metadata: { path: ['order_item_id'], equals: orderItemId } },
              { metadata: { path: ['ticket_id'], equals: ticketId } },
            ]
          : [{ metadata: { path: ['order_item_id'], equals: orderItemId } }],
      },
      select: { id: true },
    });
    if (priorDisposition) return [];
    // Defensive: some callers wire a partial/stub `kitchenFireService` (older
    // test doubles, edge DI paths) that lacks the new method — fall back
    // instead of throwing, same as the `ticketId == null` case.
    const consumed = ticketId != null && typeof this.kitchenFireService?.findTicketConsumedLeaves === 'function'
      ? await this.kitchenFireService.findTicketConsumedLeaves(tx, ticketId, orderItemId)
      : await tx.inventory_transactions.findMany({
          where: { order_item_id: orderItemId, quantity_change: { lt: 0 } },
          select: {
            id: true, product_id: true, product_variant_id: true,
            quantity_change: true, unit_cost: true, total_cost: true,
          },
        });
    const leaves: ConsumedLeafDisposition[] = [];
    for (const ct of consumed) {
      const quantity = Math.abs(ct.quantity_change);
      const locationId = disposition === 'reuse'
        ? await this.stockLevelManager.getDefaultLocationForProduct(
            ct.product_id, ct.product_variant_id ?? undefined,
          )
        : null;
      const totalCost = Number(ct.total_cost ?? 0);
      const unitCost = Number(ct.unit_cost ?? (quantity > 0 ? totalCost / quantity : 0));
      const leaf: ConsumedLeafDisposition = {
        product_id: ct.product_id,
        product_variant_id: ct.product_variant_id,
        location_id: locationId,
        quantity,
        unit_cost: unitCost,
        total_cost: totalCost,
        unknown_cost: ct.total_cost == null || totalCost <= 0,
      };
      if (disposition === 'reuse') {
        await this.stockLevelManager.updateStock({
          product_id: ct.product_id,
          variant_id: ct.product_variant_id ?? undefined,
          location_id: locationId!,
          quantity_change: quantity,
          movement_type: 'return',
          movement_unit_cost: unitCost > 0 ? unitCost : undefined,
          reason: `REUSO-INSUMO: orden #${orderId} ítem #${orderItemId} (${reason})`,
          source_module: 'order_item_cancellation',
          create_movement: true,
          validate_availability: false,
          // Keep an existing negative ingredient balance when restoring just
          // this item's consumed units; the default floor would mint stock.
          allow_negative: true,
          afterCommit,
        }, tx);
        // updateStock(return) restores quantity/value snapshots but does not
        // recreate a cost layer. Without this, a later FIFO/CPP sale sees
        // physical stock with no layer. Only the per-transaction consumed
        // average is persisted, so restore one layer at that historical cost.
        await tx.inventory_cost_layers.create({
          data: {
            organization_id: organizationId,
            product_id: ct.product_id,
            product_variant_id: ct.product_variant_id,
            location_id: locationId!,
            quantity_remaining: quantity,
            unit_cost: new Prisma.Decimal(unitCost),
            received_at: new Date(),
          },
        });
      }
      leaves.push(leaf);
    }
    return leaves;
  }

  private async postPreparedDispositionAfterCommit(
    orderId: number,
    orderItemId: number,
    organizationId: number,
    storeId: number,
    disposition: 'reuse' | 'waste',
    leaves: ConsumedLeafDisposition[],
  ): Promise<void> {
    const totalCost = leaves.reduce((sum, leaf) => sum + leaf.total_cost, 0);
    if (totalCost <= 0) return; // Zero/unknown cost stays in the audit, not the ledger.
    if (!this.autoEntryService) {
      this.logger.error(`AutoEntryService no disponible: disposición de ítem #${orderItemId} requiere conciliación desde audit_logs`);
      return;
    }
    try {
      // createAutoEntry records disabled/missing-mapping skips and enqueues
      // active failures; neither may undo an already-committed cancellation.
      await this.autoEntryService.onPreparedDishDisposition({
        order_id: orderId,
        order_item_id: orderItemId,
        organization_id: organizationId,
        store_id: storeId,
        disposition,
        total_cost: totalCost,
        user_id: RequestContextService.getUserId() ?? undefined,
      });
    } catch (error) {
      this.logger.error(
        `Reclasificación pendiente para ítem #${orderItemId}; auditar order_item.prepared_disposition: ${(error as Error).message}`,
      );
    }
  }

  /**
   * H4 — `ticketId` is persisted in the metadata so
   * `KitchenFireService.revertTicket` can recognize (and block reverting) a
   * cancelled ticket whose order_item already went through this disposition
   * path. Also feeds H2's (order_item_id, ticket_id) idempotency key.
   */
  private async auditPreparedDispositionInTx(
    tx: Prisma.TransactionClient,
    orderId: number,
    orderItemId: number,
    organizationId: number,
    storeId: number,
    reason: string,
    disposition: 'reuse' | 'waste',
    leaves: ConsumedLeafDisposition[],
    ticketId: number | null = null,
  ): Promise<void> {
    const priorDisposition = await tx.audit_logs.findFirst({
      where: {
        action: 'order_item.prepared_disposition',
        resource_id: orderId,
        AND: ticketId != null
          ? [
              { metadata: { path: ['order_item_id'], equals: orderItemId } },
              { metadata: { path: ['ticket_id'], equals: ticketId } },
            ]
          : [{ metadata: { path: ['order_item_id'], equals: orderItemId } }],
      },
      select: { id: true },
    });
    if (priorDisposition) return;
    const requestId = RequestContextService.getRequestId();
    await tx.audit_logs.create({
      data: {
        user_id: RequestContextService.getUserId() ?? null,
        organization_id: organizationId,
        store_id: storeId,
        action: 'order_item.prepared_disposition',
        resource: AuditResource.ORDERS,
        resource_id: orderId,
        request_id: requestId && requestId.length <= 100 ? requestId : null,
        metadata: {
          order_id: orderId, order_item_id: orderItemId, ticket_id: ticketId,
          reason, destination: disposition, leaves,
          consumed_cost: leaves.reduce((sum, leaf) => sum + leaf.total_cost, 0),
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Read the canonical order shape used by the controller's pre-flight
   * gate (`payOrder`) and by every flow method below. Made public so the
   * `OrderFlowController` can re-read the freshest `state` after the row
   * lock in `promoteDraftToCreated` commits — that's how the FB-10
   * race-claim rejects concurrent second waves with 409.
   */
  async getOrder(orderId: number, client: Prisma.TransactionClient | StorePrismaService = this.prisma) {
    const order = await client.orders.findFirst({
      where: { id: orderId },
      include: {
        // `industries` added for the H3 fix — kitchen hand-off gates
        // (`assertKitchenReadyForWholeOrder`, `deliverOrderItem`) must know
        // whether THIS store is currently a restaurant before requiring a
        // never-fired prepared line to reach the kitchen.
        stores: { select: { id: true, name: true, store_code: true, organization_id: true, industries: true } },
        payments: {
          include: { store_payment_method: {
            select: { system_payment_method: {
              select: { type: true, processing_mode: true },
            } },
          } },
        },
        order_items: { include: { products: true, product_variants: true } },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    return order;
  }

  private async assertUnsplitOrderAfterLock(
    tx: Prisma.TransactionClient,
    orderId: number,
    storeId: number,
  ): Promise<{ state: string }> {
    const locked = await lockOrderLifecycle(tx, orderId, storeId);
    const current = await tx.orders.findFirst({
      where: { id: orderId, store_id: storeId },
      select: { active_financial_split_id: true },
    });
    if (!current) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
    assertNoActiveFinancialSplit(current);
    return locked;
  }

  private async assertNoOpenTableForDraft(
    order: { id: number; store_id: number; state: order_state_enum },
    client: Prisma.TransactionClient | StorePrismaService = this.prisma,
  ): Promise<void> {
    if (order.state !== 'draft') return;
    const session = await client.table_sessions.findFirst({
      where: { order_id: order.id, store_id: order.store_id, closed_at: null },
      select: { id: true },
    });
    if (session) {
      throw new VendixHttpException(
        ErrorCodes.ORD_CANCEL_OPEN_TABLE_001,
        undefined,
        { table_session_id: session.id },
      );
    }
  }

  /**
   * F2-guard — Restaurant Suite: an order must NEVER move to `finished`
   * while it still has kitchen items the cook has not handed off. "Pending"
   * means `kitchen_ticket_items.status NOT IN ('delivered','cancelled')`.
   *
   * Scope-safe: `kitchen_ticket_items` is registered in `StorePrismaService`
   * (auto-scoped through `kitchen_ticket.store_id`), so counting through the
   * `kitchen_ticket.order_id` relation never leaks across tenants. Accepts an
   * optional transaction client so callers inside a `$transaction` see their
   * own uncommitted writes.
   *
   * Returns `true` when at least one undelivered kitchen item exists. For
   * non-restaurant / non-fired orders the count is 0, so it returns `false`
   * and never blocks the normal retail/ecommerce finish path.
   */
  private async hasPendingKitchenItems(
    orderId: number,
    client: { kitchen_ticket_items: { count: (args: any) => Promise<number> } } = this
      .prisma,
  ): Promise<boolean> {
    const pendingCount = await client.kitchen_ticket_items.count({
      where: {
        kitchen_ticket: { order_id: orderId },
        status: { notIn: ['delivered', 'cancelled'] },
      },
    });
    return pendingCount > 0;
  }

  /**
   * Devuelve el nombre de la primera línea NO cancelada cuya última fila
   * `kitchen_ticket_items` no está `delivered`/`cancelled`, o `null` si ninguna
   * bloquea. Las líneas sin filas de cocina (retail / skip_kds) no bloquean.
   */
  private async findLineAwaitingKitchenDelivery(
    orderId: number,
    client: any = this.prisma,
  ): Promise<string | null> {
    const lines = await client.order_items.findMany({
      where: {
        order_id: orderId,
        cancelled_at: null,
        kitchen_ticket_items: { some: {} },
      },
      select: {
        product_name: true,
        kitchen_ticket_items: {
          orderBy: { id: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });
    for (const line of lines ?? []) {
      const status = line.kitchen_ticket_items?.[0]?.status;
      if (status != null && status !== 'delivered' && status !== 'cancelled') {
        return line.product_name || 'este producto';
      }
    }
    return null;
  }

  /** Whole-order fulfillment is never allowed to use a retail line as a
   * shortcut around an un-fired or undelivered prepared line. Item-level
   * delivery has its own guard and remains available for retail lines.
   *
   * H3 fix: `isRestaurant` gates whether a never-fired prepared line blocks
   * at all (see `kitchenHandoffBlocker`) — a store that dropped the
   * `restaurant` industry but kept legacy prepared/skip_kds:false catalog
   * rows must still be able to ship/deliver/finish those orders. A line with
   * a REAL kitchen ticket keeps blocking regardless of the flag; a
   * `cancelled` ticket blocks with its own explanatory message instead of the
   * generic one. */
  private async assertKitchenReadyForWholeOrder(
    orderId: number,
    isRestaurant: boolean,
  ): Promise<void> {
    const items = await this.prisma.order_items.findMany({
      where: { order_id: orderId },
      select: {
        cancelled_at: true,
        skip_kds: true,
        product_name: true,
        products: { select: { product_type: true } },
        kitchen_ticket_items: {
          select: { status: true }, orderBy: { id: 'desc' }, take: 1,
        },
      },
    });
    const blocker = kitchenHandoffBlocker(items, { isRestaurant });
    if (blocker) {
      throw new VendixHttpException(
        ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS,
        describeKitchenHandoffBlocker(blocker),
      );
    }
  }

  private validateTransition(
    currentState: OrderState,
    targetState: OrderState,
    owner?: 'kitchen_bridge',
  ): void {
    // QUI-POS-E2E-R8-LIVE: idempotent no-op when the caller already
    // pre-claimed the order into the target state (the FB-10 race-claim
    // in `payOrder` transitions to `processing` BEFORE this validator
    // runs, so the subsequent `validateTransition(state, 'processing')`
    // is a no-op transition, not an error).
    if (currentState === targetState) {
      return;
    }
    if (currentState === 'delivered' && targetState === 'processing' && owner !== 'kitchen_bridge') {
      throw new VendixHttpException(ErrorCodes.ORD_DELIVERED_REVERSAL_OWNER_001);
    }
    const validTargets = VALID_TRANSITIONS[currentState];
    if (!validTargets.includes(targetState)) {
      throw new BadRequestException(
        `Invalid state transition: cannot change from '${currentState}' to '${targetState}'. ` +
          `Valid transitions from '${currentState}': [${validTargets.join(', ') || 'none'}]`,
      );
    }
  }

  /**
   * Fusiona un parche dentro de `internal_notes._flow_metadata` SIN tocar
   * `orders.state` — ese sigue siendo territorio exclusivo de
   * {@link updateOrderState}.
   *
   * `orders` no tiene columnas para la traza del flujo, así que la metadata
   * vive como JSON en `internal_notes` con la forma
   * `{ _flow_metadata, notes }` que escribe `updateOrderState`. Este helper
   * respeta ese contrato en los tres casos: JSON con metadata previa (fusiona),
   * JSON sin ella (arranca la metadata y preserva `notes`) y texto plano de un
   * operador (lo mueve a `notes` en vez de perderlo).
   */
  private async appendFlowMetadata(
    orderId: number,
    patch: Record<string, any>,
  ): Promise<void> {
    const current = await this.prisma.orders.findUnique({
      where: { id: orderId },
      select: { internal_notes: true },
    });

    let flow: Record<string, any> = {};
    let notes = '';

    if (current?.internal_notes) {
      try {
        const parsed = JSON.parse(current.internal_notes);
        flow = parsed?._flow_metadata ?? {};
        notes = parsed?.notes ?? '';
      } catch {
        // Nota en texto plano escrita a mano: se conserva como nota.
        notes = current.internal_notes;
      }
    }

    await this.prisma.orders.update({
      where: { id: orderId },
      data: {
        internal_notes: JSON.stringify({
          _flow_metadata: { ...flow, ...patch },
          notes,
        }),
        updated_at: new Date(),
      },
    });
  }

  private async updateOrderState(
    orderId: number,
    newState: OrderState,
    metadata: Record<string, any> = {},
    opts?: {
      source?: string;
      deliveredReversalOwner?: 'forced';
      /** `payOrder` pre-claims the row into `processing` before this write;
       * the history must show the state the user actually saw (the
       * pre-claim one), not the transient claim. */
      historyFromState?: OrderState | null;
    },
  ) {
    // Filter out non-schema fields and store them in internal_notes as JSON metadata
    const schemaFields: Record<string, any> = {
      state: newState,
      updated_at: new Date(),
    };

    // Map some common fields to existing schema columns
    if (metadata.paid_at || metadata.finished_at) {
      schemaFields.completed_at =
        metadata.paid_at || metadata.finished_at || new Date();
    }
    if (metadata.placed_at) {
      schemaFields.placed_at = metadata.placed_at;
    }
    if (metadata.total_paid !== undefined) {
      schemaFields.total_paid = metadata.total_paid;
    }
    if (metadata.remaining_balance !== undefined) {
      schemaFields.remaining_balance = metadata.remaining_balance;
    }

    // Store additional metadata as JSON in internal_notes
    const metadataKeys = Object.keys(metadata).filter(
      (k) => !['paid_at', 'finished_at', 'placed_at', 'total_paid', 'remaining_balance'].includes(k),
    );

    if (metadataKeys.length > 0) {
      const currentOrder = await this.prisma.orders.findUnique({
        where: { id: orderId },
        select: { internal_notes: true },
      });

      let existingMetadata: Record<string, any> = {};
      if (currentOrder?.internal_notes) {
        try {
          // Try to parse existing notes as JSON metadata
          const parsed = JSON.parse(currentOrder.internal_notes);
          if (parsed._flow_metadata) {
            existingMetadata = parsed._flow_metadata;
          }
        } catch {
          // Not JSON, keep as is
          existingMetadata = { original_notes: currentOrder.internal_notes };
        }
      }

      const flowMetadata = {
        ...existingMetadata,
        ...metadataKeys.reduce(
          (acc, key) => ({ ...acc, [key]: metadata[key] }),
          {},
        ),
      };

      schemaFields.internal_notes = JSON.stringify({
        _flow_metadata: flowMetadata,
        notes: existingMetadata.original_notes || '',
      });
    }

    const previous_order = await this.prisma.orders.findUnique({
      where: { id: orderId },
      select: {
        state: true,
        store_id: true,
        order_number: true,
        stores: { select: { organization_id: true } },
      },
    });
    const previousOrganizationId = previous_order?.stores?.organization_id ?? null;
    const historySource = this.mapUpdateStateSource(opts?.source);

    // R4 — una orden NUNCA pasa a `finished` con una línea viva (no cancelada)
    // cuya última fila de cocina no esté `delivered`/`cancelled`. Cubre todos
    // los caminos (finish explícito, forceOrderState, fast-track, cobro,
    // reconciliación). Los cierres automáticos ya lo pre-chequean y saltan en
    // silencio; acá se falla fuerte para el resto.
    if (newState === 'finished') {
      const blockedLine = await this.findLineAwaitingKitchenDelivery(orderId);
      if (blockedLine) {
        throw new VendixHttpException(
          ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS,
          `La orden tiene platos sin entregar en cocina ("${blockedLine}"). Entrégalos o cancélalos antes de finalizar.`,
        );
      }
    }

    if (
      previous_order?.state === 'delivered' &&
      newState === 'processing' &&
      opts?.source !== 'kitchen_bridge' &&
      opts?.deliveredReversalOwner !== 'forced'
    ) {
      throw new VendixHttpException(ErrorCodes.ORD_DELIVERED_REVERSAL_OWNER_001);
    }

    // `finished` AND `delivered` mutate inventory (docs/plans/
    // no-overselling-stock-guard-plan.md step 5: consume on delivery, not
    // only on finish — `deliverOrder`, `markKitchenOrderDelivered` and
    // `forceOrderState('delivered')` all funnel through this method). Route
    // the stock deduction through the canonical OrderStockCommitService and
    // make the commit + state write ATOMIC: the deduction runs FIRST inside
    // the same $transaction, so if it throws (INV_STOCK_002 /
    // SERIAL_REQUIRED_001) the state write is rolled back and the order
    // stays in its previous state. All the skip rules (service /
    // !track_inventory / consumed-at-fire / already-committed /
    // restaurant-prepared-pending-fire) live inside the canonical service —
    // they are NOT replicated here. `commitOrderDelivery`'s per-item
    // `inventory_committed` claim makes running it again from `finished`
    // (after an order already committed at `delivered`) an idempotent no-op:
    // no double deduction. Side-effect events are emitted only AFTER the
    // transaction commits (never on rollback).
    if (newState === 'finished' || newState === 'delivered') {
      const stockEvents: Array<() => void> = [];
      // docs/plans/no-overselling-stock-guard-plan.md step 9 — additive to
      // the response, only when the store's "Permitir sobreventa" switch
      // accepted a real shortfall during this commit.
      const stockWarnings: InsufficientStockItem[] = [];
      try {
        const { updated_order, commit } = await this.prisma.$transaction(
          async (tx) => {
            const inventoryPolicy = await this.stockValidator?.resolveInventoryPolicy(
              previous_order?.store_id as number,
              tx,
            );
            const allowOversell = inventoryPolicy?.allowOversell === true;
            const commit = await this.orderStockCommit.commitOrderDelivery(
              orderId,
              {
                movementType: 'sale',
                blockOnInsufficient: !allowOversell,
                allowNegativeOnShortfall: allowOversell,
                onShortfall: allowOversell
                  ? (item) => stockWarnings.push({ ...item, kind: 'product' })
                  : undefined,
                consumeSerials: true,
                reason:
                  newState === 'finished' ? 'Order completed' : 'Order delivered',
                afterCommit: stockEvents,
                userId: RequestContextService.getUserId(),
              },
              tx,
            );

            const updated_order = await tx.orders.update({
              where: { id: orderId },
              data: schemaFields,
              include: {
                stores: {
                  select: {
                    id: true,
                    name: true,
                    store_code: true,
                    organization_id: true,
                  },
                },
                order_items: {
                  include: { products: true, product_variants: true },
                },
                payments: true,
              },
            });

            await this.orderHistoryService?.record(tx, {
              orderId,
              storeId: updated_order.store_id,
              organizationId:
                updated_order.stores?.organization_id ?? previousOrganizationId,
              type: 'state_changed',
              fromState: opts?.historyFromState ?? previous_order?.state,
              toState: newState,
              source: historySource,
            });

            return { updated_order, commit };
          },
          // Multi-line + serial commits do more work per line than a plain
          // state write; widen the interactive-transaction budget.
          { timeout: 20000 },
        );

        for (const publish of stockEvents) {
          try { publish(); } catch (error) {
            this.logger.warn(`Stock committed; notification failed: ${(error as Error).message}`);
          }
        }
        // Emitted only after a successful commit → never fires on rollback.
        this.eventEmitter.emit('order.status_changed', {
          store_id: updated_order.store_id,
          order_id: orderId,
          order_number: previous_order?.order_number || '',
          old_state: previous_order?.state || '',
          new_state: newState,
          ...(opts?.source ? { source: opts.source } : {}),
        });

        if (commit.totalCost > 0) {
          this.eventEmitter.emit('order.completed', {
            order_id: orderId,
            order_number: previous_order?.order_number || '',
            organization_id: updated_order.stores?.organization_id,
            store_id: updated_order.store_id,
            total_cost: commit.totalCost,
            user_id: RequestContextService.getUserId(),
          });
        }

        return stockWarnings.length > 0
          ? { ...updated_order, stock_warnings: stockWarnings }
          : updated_order;
      } catch (error) {
        // The commit failed → the state write was rolled back with it, so the
        // order is still in its previous state. Business rules
        // (INV_STOCK_002 / SERIAL_REQUIRED_001) MUST propagate so the finish
        // fails loudly instead of silently completing without deducting
        // stock/serials. Genuine infra errors also propagate (the order was
        // NOT finished, so reporting success would be a lie).
        if (error instanceof VendixHttpException) {
          throw error;
        }
        this.logger.error(
          `Failed to ${newState === 'finished' ? 'finish' : 'deliver'} order #${orderId}: ${error.message}`,
        );
        throw error;
      }
    }

    // All other states: single non-transactional write (no inventory mutation).
    const updated_order = await this.prisma.orders.update({
      where: { id: orderId },
      data: schemaFields,
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: true,
      },
    });

    await this.orderHistoryService?.record(this.prisma, {
      orderId,
      storeId: updated_order.store_id,
      organizationId: previousOrganizationId,
      type: 'state_changed',
      fromState: opts?.historyFromState ?? previous_order?.state,
      toState: newState,
      source: historySource,
    });

    this.eventEmitter.emit('order.status_changed', {
      store_id: updated_order.store_id,
      order_id: orderId,
      order_number: previous_order?.order_number || '',
      old_state: previous_order?.state || '',
      new_state: newState,
      ...(opts?.source ? { source: opts.source } : {}),
    });

    return updated_order;
  }

  /**
   * Reserve stock for a draft promotion, without releasing payOrder's claim.
   *
   * Table/POS drafts can be born without a stock reservation. Reserve each
   * tracked, non-service item before charging. The standalone table/split
   * path transitions draft -> created; payOrder has already claimed the row
   * as processing and must keep that state until the charge completes.
   *
   * IDEMPOTENT: if the row is not in the expected state it returns false, and
   * each item is skipped when an active order reservation already exists.
   *
   * Reservation is NON-BLOCKING (`validate_availability = false`): the table
   * flow must never refuse a payment because of stock, matching POS semantics.
   * Items already consumed at fire (`inventory_consumed_at_fire`) pass
   * `skip_reservation = true`; the manager does no further stock mutation.
   */
  private async promoteDraftToCreated(
    orderId: number,
    storeId: number,
    alreadyClaimedForPayment = false,
    createdForPayment?: DraftReservationKey[],
  ): Promise<boolean> {
    // QUI-POS-E2E-R8-LIVE: FB-10 double-click race. 10 concurrent flow/pay
    // calls previously produced 8 succeeded payments on a $100 order ($800
    // overcharge) because the original flow read state then mutated state
    // in two separate statements: (1) reservation loop ran inside a $tx but
    // the state change ran AFTER commit through `updateOrderState`, so every
    // concurrent caller saw state='draft' and proceeded. Fix: take a row
    // lock with `SELECT ... FOR UPDATE` AT THE TOP of the same transaction
    // that performs the reservation AND the state change. Concurrent
    // promoteDraftToCreated calls for the same order_id serialize on the
    // row lock; the second wave sees state != 'draft' and bails. The state
    // is updated inside the same tx so the lock covers the full claim
    // window.
    const createdInTransaction: DraftReservationKey[] = [];
    const promoted = await this.prisma.$transaction(
      async (tx) => {
        // 1) Lock the order row + read its state under the lock.
        const locked = await tx.$queryRaw<
          Array<{ id: number; state: OrderState }>
        >`SELECT id, state FROM orders WHERE id = ${orderId} AND store_id = ${storeId} FOR UPDATE`;

        if (!locked.length) {
          throw new NotFoundException(`Order #${orderId} not found`);
        }

        // IDEMPOTENT: if another concurrent caller already promoted this
        // order, bail without touching reservations. The FOR UPDATE lock
        // guarantees we observe the latest committed state. We return
        // `false` so `payOrder` knows WE did not win the claim and must
        // bail with `state_not_payable` instead of inserting a duplicate
        // payment.
        // payOrder already owns the atomic draft -> processing claim. Its
        // reservation must run under that claim WITHOUT resetting the state
        // to created: doing so would let a second flow/pay claim and charge.
        const expectedState = alreadyClaimedForPayment ? 'processing' : 'draft';
        if (locked[0].state !== expectedState) {
          return false;
        }

        // 2) Load order items + products for the reservation loop. Use `tx`
        // so the read is part of the same locked transaction.
        const order = await tx.orders.findFirst({
          where: { id: orderId, store_id: storeId },
          include: {
            stores: { select: { industries: true } },
            order_items: {
              include: {
                products: {
                  select: {
                    id: true,
                    name: true,
                    track_inventory: true,
                    product_type: true,
                  },
                },
                product_variants: {
                  select: { id: true, name: true, track_inventory_override: true },
                },
              },
            },
          },
        });

        if (!order) {
          throw new NotFoundException(`Order #${orderId} not found`);
        }

        const userId = RequestContextService.getUserId();
        const isRestaurant = storeIsRestaurant((order as any).stores?.industries);

        // 3) Reserve stock. The lock is held for the entire loop.
        //
        // docs/plans/no-overselling-stock-guard-plan.md step 4 (reverses
        // QUI-557): the previous dedup only checked whether ANY active
        // reservation existed for (order, product, variant) — when two
        // sibling lines shared the same product/variant, the first line's
        // check found nothing and reserved its quantity; the second line's
        // check then found the FIRST line's row and skipped its OWN quantity
        // entirely, silently under-reserving the order. Fix: aggregate
        // demand per (product_id, product_variant_id) across every sibling
        // line, subtract what is ALREADY actively reserved for this order
        // under that identity, and reserve only the resulting DIFFERENCE.
        //
        // Kitchen dishes (`isRestaurant && product_type==='prepared' &&
        // !skip_kds`) are excluded: their ingredients are validated/consumed
        // at fire by kitchen-fire.service.ts, never by their own
        // finished-good stock. Lines already `inventory_consumed_at_fire`
        // are excluded too — their stock was already deducted, not reserved.
        type ReservationGroup = {
          product_id: number;
          product_variant_id: number | undefined;
          demand: number; // total stock units this order needs reserved
          product_name: string;
        };
        const groups = new Map<string, ReservationGroup>();

        for (const item of order.order_items) {
          const product = item.products;
          if (!product || product.product_type === 'service') continue;

          const effectiveTracking =
            item.product_variants?.track_inventory_override ??
            product.track_inventory ??
            false;
          if (!effectiveTracking) continue;

          if (item.inventory_consumed_at_fire === true) continue;

          // BUG 1 (no-overselling-stock-guard-plan.md, 2026-09-26): una línea
          // ya ENTREGADA (`inventory_committed=true`, su stock ya se descontó
          // en `commitOrderLines` y la reserva que la cubría ya fue consumida)
          // o CANCELADA (`cancelled_at`, su reserva ya fue liberada) no tiene
          // nada pendiente que reclamar. Re-demandarla aquí duplicaba stock
          // que ya salió o que nunca se iba a vender.
          if (item.inventory_committed === true || item.cancelled_at != null) {
            continue;
          }

          const isKitchenDish =
            isRestaurant && product.product_type === 'prepared' && !item.skip_kds;
          if (isKitchenDish) continue;

          const variantId = item.product_variant_id ?? undefined;
          const key = `${item.product_id}-${variantId ?? 'null'}`;
          const qty = item.stock_units_consumed ?? item.quantity;
          const productName = item.product_variants?.name
            ? `${product.name} - ${item.product_variants.name}`
            : product.name;

          const existing = groups.get(key);
          if (existing) {
            existing.demand += qty;
          } else {
            groups.set(key, {
              product_id: item.product_id,
              product_variant_id: variantId,
              demand: qty,
              product_name: productName,
            });
          }
        }

        if (groups.size > 0) {
          // Strict guard (reverses QUI-557): a draft/table order is only
          // payable when the order's TOTAL demand per identity is covered by
          // sellable stock plus its own already-reserved quantity. Throws
          // `INV_STOCK_INSUFFICIENT_LINES` naming every short product in one
          // shot — must run BEFORE any reservation write in this loop and
          // BEFORE `payOrder` writes a payment row (the caller's try/catch
          // around this call wraps and rethrows as a typed 409 without
          // inserting anything).
          // docs/plans/no-overselling-stock-guard-plan.md step 9 — a store
          // with "Permitir sobreventa" active does not block this claim on a
          // shortfall; it logs a warning and reserves the full demand anyway
          // (allow_negative_available), same contract as the other seams.
          const inventoryPolicy = await this.stockValidator?.resolveInventoryPolicy(
            storeId,
            tx,
          );
          const allowOversell = inventoryPolicy?.allowOversell === true;
          await this.stockValidator?.assertLinesAvailable(
            Array.from(groups.values()).map((g) => ({
              product_id: g.product_id,
              product_variant_id: g.product_variant_id ?? null,
              quantity: g.demand,
              product_name: g.product_name,
            })),
            { orderId, tx, allowOversell },
          );

          for (const group of groups.values()) {
            const alreadyReserved = await tx.stock_reservations.aggregate({
              where: {
                reserved_for_type: 'order',
                reserved_for_id: orderId,
                product_id: group.product_id,
                product_variant_id: group.product_variant_id ?? null,
                status: 'active',
              },
              _sum: { quantity: true },
            });
            const toReserve =
              group.demand - Number(alreadyReserved?._sum?.quantity ?? 0);
            if (toReserve <= 0) continue;

            const allocation = await this.sellableStockAllocator?.allocateForLine(
              storeId, group.product_id, group.product_variant_id,
              toReserve, [], tx,
            );
            if (allocation && allocation.shortfall > 0 && !allowOversell) {
              throw new VendixHttpException(
                ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
                `Stock insuficiente para ${group.product_name}: requiere ${toReserve}, disponible ${allocation.available}.`,
                { items: [{
                  product_id: group.product_id,
                  product_variant_id: group.product_variant_id ?? null,
                  product_name: group.product_name,
                  kind: 'product',
                  requested: toReserve,
                  available: allocation.available,
                }] },
              );
            }
            if (allocation && allocation.shortfall > 0 && allowOversell) {
              this.logger.warn(
                `Sobreventa permitida — ${group.product_name}: requiere ${toReserve}, disponible ${allocation.available}.`,
              );
            }
            // Legacy direct-construction specs do not inject the allocator;
            // Nest production always resolves it from OrderStockCommitModule.
            const slices = allocation
              ? (allocation.shortfall > 0 && allowOversell
                  ? this.sellableStockAllocator!.absorbShortfall(
                      allocation,
                      allocation.slices[0]?.location_id ??
                        (await this.stockLevelManager.getDefaultLocationForProduct(
                          group.product_id, group.product_variant_id, tx,
                        )),
                    )
                  : allocation.slices)
              : [{
                  location_id: await this.stockLevelManager.getDefaultLocationForProduct(
                    group.product_id, group.product_variant_id,
                  ),
                  quantity: toReserve,
                }];
            for (const slice of slices) {
              await this.stockLevelManager.reserveStock(
                group.product_id,
                group.product_variant_id,
                slice.location_id,
                slice.quantity,
                'order',
                orderId,
                userId,
                !allowOversell,
                tx,
                undefined,
                false,
                undefined, // quantity already expressed in stock units
                allowOversell,
              );
              createdInTransaction.push({
                productId: group.product_id,
                variantId: group.product_variant_id,
                locationId: slice.location_id,
                quantity: slice.quantity,
              });
            }
          }
        }

        // 4) Standalone table/split promotion changes state under the lock.
        // Payment promotion only reserves: the processing claim must remain
        // intact so a second payOrder cannot claim the same order.
        if (!alreadyClaimedForPayment) {
          this.validateTransition('draft', 'created');
          await tx.orders.update({
            where: { id: orderId },
            data: { state: 'created', updated_at: new Date() },
          });
        }
        return true;
      },
      { timeout: 30_000 },
    );

    if (!promoted) return false;
    createdForPayment?.push(...createdInTransaction);

    // 5) Flow metadata is best effort after the reservation commits. In the
    // payment path, append without changing processing back to created.
    try {
      const metadata = {
        promoted_from_draft: true,
        promoted_at: new Date(),
      };
      if (alreadyClaimedForPayment) {
        await this.appendFlowMetadata(orderId, metadata);
      } else {
        await this.updateOrderState(orderId, 'created', metadata);
      }
    } catch (metaErr) {
      this.logger.warn(
        `[promoteDraftToCreated metadata failed] order=${orderId}: ${(metaErr as Error).message}`,
      );
    }

    this.logger.log(
      `Order #${orderId} promoted from draft${alreadyClaimedForPayment ? ' under payment claim' : ' to created'}`,
    );
    return true;
  }

  /**
   * Pay an order from POS (created state)
   * - Direct payment: goes to finished
   * - Online payment: goes to pending_payment
   *
   * Round 1 MAJOR #11: cada rechazo de negocio por CONFLICTO DE ESTADO
   * (estado ilegal, método desconocido, falta de stock del finish, cocina
   * pendiente, etc.) se traduce a `ORD_FLOW_PAYMENT_FAILED_001` con el
   * código tipado original en `details.cause_code`. El cliente ve un
   * 409 con un único código de superficie (`ORD_FLOW_PAYMENT_FAILED_001`)
   * y el `cause_code` lo mapea a la causa real para soporte y la UI.
   *
   * PLAN-pago-multimetodo-pendientes paso 3: esto NO aplica a un rechazo de
   * VALIDACIÓN de payload (Σ de tramos ≠ total, método no directo, más de
   * un tramo en efectivo, monto recibido menor al tramo en efectivo, cuenta
   * bancaria inválida/ajena) — esos ya vienen tipados de
   * `normalizePaymentLegs`/`resolveAndValidateBankAccount` y se relanzan tal
   * cual: 400 con su propio `error_code` (`PAY_MULTI_TENDER_*`,
   * `PAY_INVALID_AMOUNT_001`, `PAY_VALIDATE_001`), nunca el 409 genérico.
   */
  async payOrder(
    orderId: number,
    dto: PayOrderDto,
    options?: { strictKitchenPending?: boolean },
  ) {
    // Gate único de caja: con el switch activo, quien cobra debe tener SU
    // sesión abierta. Primero que todo — antes del claim de estado — para no
    // dejar la orden varada en `processing` cuando se rechaza.
    await this.sessionsService.assertSessionForSales(
      RequestContextService.getUserId(),
    );

    // A.2 CP-facturacion-fixes — charge-time shipping gate (ADR-02). Creation stays
    // open (whatsapp/assisted orders choose the method later), but a physical order
    // that needs dispatch cannot be CHARGED without a shipping method: assign it
    // first, then charge. Read-only and placed BEFORE the state claim, so rejection
    // touches nothing; a concurrent assignment races toward a retryable error, never
    // toward a shippyless charge. La mesa (`dine_in`), `direct_delivery` y
    // `pickup` no requieren despacho; services-only carts have no physical items.
    // NOTE: checkout's extra
    // `requires_shipping === false` carve-out is skipped here — it is not a Prisma
    // column (hydrated cart object only), and `product_type !== 'service'` covers it.
    {
      const probe = await this.prisma.orders.findFirst({
        where: { id: orderId },
        select: {
          active_financial_split_id: true,
          delivery_type: true,
          shipping_method_id: true,
          order_items: {
            select: {
              products: { select: { product_type: true } },
            },
          },
        },
      });
      if (probe) assertNoActiveFinancialSplit(probe);
      const needsDispatch =
        (!probe?.delivery_type ||
          !SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES.has(probe.delivery_type)) &&
        (probe?.order_items ?? []).some((item: any) => {
          const product = item.products;
          if (!product) return true;
          return product.product_type !== 'service';
        });
      if (needsDispatch && probe?.shipping_method_id == null) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_CHARGE_001);
      }
    }

    // QUI-POS-E2E-R8-LIVE: FB-10 double-click race (v2 — atomic state claim).
    //
    // The state-claim inside `promoteDraftToCreated` correctly rejects
    // concurrent promotes, BUT callers who read state='created' AFTER
    // the winner committed skip the if-block entirely and still reach
    // the payment-insert path. v1's `updateMany` that only touched
    // `updated_at` did not actually serialize because the state filter
    // kept matching for every concurrent caller (state never changed).
    //
    // Fix v2: at the TOP of payOrder, atomically transition the order
    // into `processing` via `updateMany` with the pre-charge state
    // filter. PostgreSQL serializes UPDATE statements on the same row
    // (row-level lock) — the second wave blocks until the first
    // commits, then re-evaluates the WHERE and sees state='processing'
    // (not in the IN clause), so count=0 and we bail with 409
    // ORD_FLOW_PAYMENT_FAILED_001. No data is persisted when count=0.
    //
    // `processing` is also the legitimate next state for online payments,
    // so we end every successful charge either in `finished` (direct) or
    // `pending_payment`/`processing` (online) — the same state machine
    // already in use. Direct path mutates back via the existing
    // `updateOrderState` calls below; online stays in processing until
    // the gateway callback lands.
    //
    // 1060 paso 3 — capturar el estado previo al claim (lectura read-only):
    // si el finish falla tras el claim, la orden se restaura a este estado
    // en vez de quedar varada en `processing`. El pago compensado con su
    // motivo se conserva.
    const preClaimRow = await this.prisma.orders
      .findFirst({ where: { id: orderId }, select: { state: true, payment_form: true } });
    const preClaimState = (preClaimRow?.state as OrderState | undefined) ?? null;
    // B8/B4 — `delivered`/`finished` sólo son cobrables SIN pago liquidado
    // (COD huérfana o pago anulado por `cancelPayment`). Una orden ya pagada
    // en esos estados conserva el contrato previo: 409 tipado sin tocar el
    // estado (doble submit, reintentos de red).
    if (preClaimState === 'delivered' || preClaimState === 'finished') {
      // Guardia de crédito — ANTES del claim de estado (que mueve la orden a
      // `processing`): una venta a crédito (`payment_form === '2'`, ver
      // `registerCreditPayment`) que ya salió/terminó no puede cobrarse de
      // contado por este método. Hacerlo dejaría la CxC/cuotas de crédito
      // abiertas mientras la orden queda marcada como pagada de contado. NO
      // se toca `pending_payment` (comportamiento preexistente, fuera de
      // alcance): esta guardia sólo aplica a `delivered`/`finished`.
      if (preClaimRow?.payment_form === '2') {
        throw new VendixHttpException(ErrorCodes.ORD_PAY_CREDIT_ORDER_001, undefined, {
          order_id: orderId,
          state: preClaimState,
        });
      }
      const settledCount = await this.prisma.payments.count({
        where: { order_id: orderId, state: { in: ['succeeded', 'captured'] } },
      });
      if (settledCount > 0) {
        throw this.wrapPaymentFailure('state_not_payable', {
          message: `Cannot pay order in state '${preClaimState}': it already has a settled payment.`,
          state: preClaimState,
          reason: 'already_settled',
        });
      }
    }
    // B8/B4 — `delivered`/`finished` also claimable: an ecommerce COD order
    // can reach `delivered`/`finished` with its balance still outstanding
    // (see checkout.service.ts ON_DELIVERY fix), and `cancelPayment` can send
    // a fully-delivered order back through here to be re-charged after
    // voiding its legs. The `isOrderFullyPaid` guard right after the claim
    // (below) is what actually rejects a double-charge on an order that is
    // ALREADY settled — widening this list only makes the row claimable; it
    // does not by itself let an already-paid order be charged again.
    const claim = await this.prisma.orders.updateMany({
      where: {
        id: orderId,
        state: {
          in: [
            'draft',
            'created',
            'shipped',
            'pending_payment',
            'delivered',
            'finished',
          ],
        },
      },
      data: { state: 'processing', updated_at: new Date() },
    });
    if (claim.count === 0) {
      throw this.wrapPaymentFailure('state_not_payable', {
        message: `Cannot pay order: another concurrent charge already claimed it.`,
        state: 'unknown',
        reason: 'lost_pay_order_claim_race',
      });
    }

    const draftReservations: DraftReservationKey[] = [];
    let draftStoreId: number | null = null;
    let paymentPersisted = false;
    let paymentCompensated = false;
    try {
    let order = await this.getOrder(orderId);
    draftStoreId = order.store_id;

    // The winning state claim serializes flow/pay attempts. Re-read settled
    // payments AFTER it, before draft reservation or any new payment row.
    // m3 invariant (CP-REFUND-FLOW-REDESIGN step 2): `getOrder` carries no
    // `refunds`, so `isOrderFullyPaid` discounts zero here — safe because
    // this claim only admits pre-fulfillment states
    // (draft/created/shipped/pending_payment), which can never hold a
    // completed refund (REFUNDABLE_STATES = delivered/finished).
    const settledAmount = getSettledOrderAmount(order);
    if (isOrderFullyPaid(order, settledAmount)) {
      if (preClaimState && preClaimState !== 'draft') {
        await this.prisma.orders.updateMany({
          where: { id: orderId, state: 'processing' },
          data: { state: preClaimState, updated_at: new Date() },
        });
      }
      throw new VendixHttpException(ErrorCodes.ORD_PAY_ALREADY_PAID_001);
    }

    // A reserved wallet/Wompi payment must be resumed through its payment id,
    // not by creating another pending row (or paying directly while the
    // provider may still confirm the first one). The claim serializes this
    // check with competing flow/pay calls; the outer catch restores the
    // pre-claim state when rejecting it.
    const activeDigitalReservation = preClaimState === 'pending_payment'
      ? (order.payments ?? []).find((payment) =>
          payment.state === 'pending' &&
          ['wallet', 'wompi'].includes(
            payment.store_payment_method?.system_payment_method?.type ?? '',
          ),
        )
      : undefined;
    if (activeDigitalReservation) {
      throw this.wrapPaymentFailure('digital_payment_pending', {
        order_id: orderId,
        payment_id: activeDigitalReservation.id,
      });
    }

    // CP-POS-MODAL-SCOPE-001 / Phase C.4 — defense in depth: edit→pay without
    // customer is only allowed when the POS escape hatch is on
    // (`pos.allow_anonymous_sales=true`). Otherwise the cashier must
    // Actualizar (PUT /editor) with a customer selected before Cobrar.
    if (order.customer_id == null) {
      const settings = await this.prisma.store_settings.findFirst({
        where: { store_id: order.store_id ?? -1 },
        select: { settings: true },
      });
      const pos = (settings?.settings as any)?.pos ?? {};
      const allowAnonymous = pos?.allow_anonymous_sales === true;
      // QUI-737 (B.4) — una orden por alias (customer_id null + customer_alias
      // poblado) es otra venta legítima de "sin cliente formal": avanzar cuando
      // el flag POS `allow_alias_sales` está activo y la orden trae alias.
      const allowAlias = pos?.allow_alias_sales === true;
      const hasAlias = !!(order as any).customer_alias;
      if (!allowAnonymous && !(allowAlias && hasAlias)) {
        // Roll back the state claim we just did so the order returns to its
        // pre-attempt state and the cashier can fix the customer field.
        try {
          await this.prisma.orders.updateMany({
            where: { id: orderId, state: 'processing' },
            data: {
              state: (order.state as any) ?? 'created',
              updated_at: new Date(),
            },
          });
        } catch {
          /* swallow — surface the user-facing error anyway */
        }
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_PAY_NOT_ALLOWED_001,
        );
      }
    }

    // The post-claim reload is always processing. The pre-claim state tells us
    // whether this winning payment owns a draft's missing stock reservation.
    // Keep the order in processing throughout the charge; only the standalone
    // table/split path physically transitions draft -> created.
    if (preClaimState === 'draft') {
      try {
        // QUI-POS-E2E-R8-LIVE: FB-10 double-click race. promoteDraftToCreated
        // returns `false` when another concurrent caller already won the
        // FOR UPDATE claim and changed the state. Without this check, every
        // concurrent flow/pay would still pass `allowedPayStates` below
        // (because `order` was reloaded to 'created' by the winner) and
        // insert duplicate payment rows. Reject the second wave here with
        // the same `state_not_payable` shape every other terminal-order
        // attempt produces.
        const didPromote = await this.promoteDraftToCreated(
          orderId,
          order.store_id,
          true,
          draftReservations,
        );
        if (!didPromote) {
          throw this.wrapPaymentFailure('state_not_payable', {
            message: `Cannot pay order: another concurrent charge already claimed the draft promotion.`,
            state: 'draft',
            reason: 'lost_promotion_claim_race',
          });
        }
        // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B3.
        // Emit `order.promoted_to_created` AFTER the promotion commits.
        // Carries the reservation count so a SIEM rule can flag a
        // promotion that committed without ANY reservation (e.g. a
        // service-only table order where the loop ran zero times).
        const reservationCount = await this.prisma.stock_reservations.count({
          where: {
            reserved_for_type: 'order',
            reserved_for_id: orderId,
            status: 'active',
          },
        });
        try {
          await this.auditService.logCustom(
            (RequestContextService.getUserId() ?? 0) as number,
            'order.promoted_to_created',
            AuditResource.ORDERS,
            {
              request_id:
                RequestContextService.getRequestId() ?? null,
              store_id: order.store_id ?? null,
              order_id: orderId,
              customer_id: order.customer_id ?? null,
              reservation_count: reservationCount,
            },
            orderId,
          );
        } catch (auditErr) {
          // Audit is observability, never blocks the commit.
          this.logger.warn(
            `[order.promoted_to_created audit failed] order=${orderId}: ${(auditErr as Error).message}`,
          );
        }
      } catch (err) {
        // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 BLOCKER B3.
        // `order.draft_promotion_failed` row carries the typed
        // error_code and the failing stage so a support operator can
        // triage without having to dig through nested wraps. We swallow
        // audit failures the same way the success path does.
        try {
          await this.auditService.logCustom(
            (RequestContextService.getUserId() ?? 0) as number,
            'order.draft_promotion_failed',
            AuditResource.ORDERS,
            {
              request_id:
                RequestContextService.getRequestId() ?? null,
              store_id: order.store_id ?? null,
              order_id: orderId,
              customer_id: order.customer_id ?? null,
              error_code:
                (err as any)?.errorCode ?? (err as any)?.code ?? 'n/a',
              error_stage:
                (err as any)?.stage ??
                (err as any)?.details?.stage ??
                'draft_promote_failed',
              error_message:
                err instanceof Error ? err.message : String(err),
            },
            orderId,
          );
        } catch (auditErr) {
          this.logger.warn(
            `[order.draft_promotion_failed audit failed] order=${orderId}: ${(auditErr as Error).message}`,
          );
        }
        throw this.wrapPaymentFailure('draft_promote_failed', err);
      }
      order = await this.getOrder(orderId); // reload while the payment claim remains processing
    }

    const allowedPayStates: OrderState[] = ['created', 'shipped', 'processing'];
    if (!allowedPayStates.includes(order.state as OrderState)) {
      // QUI-POS-E2E-R8-LIVE: if we just claimed the order into `processing`
      // for the race-claim above but the rest of payOrder then decides the
      // order is not pay-able (e.g. an unknown state we never expected),
      // restore the prior state so the cashier can retry. We do a best-
      // effort transition back; if it fails, the operator will see the
      // order stuck in `processing` and can flip it manually.
      if (preClaimState !== 'draft') {
        try {
          await this.prisma.orders.update({
            where: { id: orderId },
            data: { state: 'created', updated_at: new Date() },
          });
        } catch (rollbackErr) {
          this.logger.error(
            `[payOrder claim rollback failed] order=${orderId}: ${(rollbackErr as Error).message}`,
          );
        }
      }
      throw this.wrapPaymentFailure('state_not_payable', {
        message: `Cannot pay order in state '${order.state}'. Order must be in 'created', 'shipped' or 'processing' state.`,
        state: order.state,
      });
    }

    const paymentMethod = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id },
      include: { system_payment_method: true },
    });

    if (!paymentMethod) {
      throw this.wrapPaymentFailure('payment_method_not_found', {
        store_payment_method_id: dto.store_payment_method_id,
      });
    }

    const isCodSettlement = (order.payments ?? []).some((payment) =>
      payment.state === 'pending' &&
      payment.store_payment_method?.system_payment_method?.processing_mode === 'ON_DELIVERY',
    );
    if (isCodSettlement && dto.payment_type !== PaymentType.DIRECT) {
      throw new VendixHttpException(
        ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED,
        'Al confirmar un pago contra entrega selecciona el medio recibido: efectivo, transferencia o datáfono.',
      );
    }

    if (
      preClaimState === 'pending_payment' &&
      dto.payment_type === PaymentType.ONLINE &&
      ['wallet', 'wompi'].includes(paymentMethod.system_payment_method?.type ?? '')
    ) {
      const existingPending = (order.payments ?? []).find((payment) => payment.state === 'pending');
      if (existingPending) {
        throw this.wrapPaymentFailure('payment_pending', {
          order_id: orderId,
          payment_id: existingPending.id,
        });
      }
    }

    // Cobro multimétodo de contado — guarda upfront: `payments[]` sólo se
    // acepta con `payment_type: 'direct'`. Va AQUÍ (y no en cada rama) porque
    // la rama shipped ignora `payment_type`: sin esta guarda, un
    // shipped+online+tramos cobraría de contado un pago de pasarela. Se lanza
    // SIN envolver para que la superficie sea 400
    // `PAY_MULTI_TENDER_METHOD_NOT_ALLOWED` (no el 409 genérico del wrap).
    if (
      dto.payment_type === PaymentType.ONLINE &&
      Array.isArray(dto.payments) &&
      dto.payments.length > 0
    ) {
      throw new VendixHttpException(
        ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED,
        'El cobro multimétodo de contado sólo se acepta con payment_type direct.',
        { payment_type: dto.payment_type, legs: dto.payments.length },
      );
    }

    // -- Propina (T3) ------------------------------------------------------
    // El cobro desde el detalle de orden acepta propina igual que el POS y el
    // cierre de mesa. La resolucion vive en `resolveTip`
    // (common/utils/tip.util.ts), compartida con
    // `PaymentsService.applyPosPaymentToTableSession`: dos implementaciones de
    // la misma regla divergen, y una propina que se calcula distinto segun por
    // donde cobro el operador es un descuadre que nadie ve hasta la
    // conciliacion.
    //
    // Convencion heredada del POS: la propina es ADITIVA al `grand_total` y
    // queda FUERA de `subtotal_amount` y `tax_amount` -- no es ingreso ni base
    // gravable. Se persiste aparte en `orders.tip_amount` y la contabilidad la
    // reconoce como pasivo custodio (propinas por pagar).
    //
    // Se persiste ANTES de cualquier cargo y `order` se recarga, para que los
    // TRES sitios de cobro de abajo lean un `grand_total` ya con la propina
    // incluida. Tocarlos uno por uno es como se consigue que dos de los tres
    // cobren la cifra correcta.
    const roundTipMoney = (value: number) =>
      Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
    if (dto.tip_amount != null || dto.tip_type != null) {
      // E.6: the percentage base is gross products, before discounts and
      // excluding shipping or any previously persisted tip.
      const grossProductsBase = roundTipMoney(
        Number(order.subtotal_amount || 0) + Number(order.tax_amount || 0),
      );
      const incomingTip = resolveTip(
        dto,
        grossProductsBase,
        roundTipMoney,
      );
      // Una propina sobre un abono de credito descuadra el plan de cuotas ya
      // calculado: el `grand_total` subiria DESPUES de que las cuotas fijaron
      // sus montos, y la ultima cuota quedaria corta sin que nada avise. Se
      // rechaza en voz alta; ignorar el campo en silencio es peor.
      if (incomingTip.amount > 0 && dto.installment_id != null) {
        if (preClaimState !== 'draft') {
          try {
            await this.prisma.orders.update({
              where: { id: orderId },
              data: { state: 'created', updated_at: new Date() },
            });
          } catch (rollbackErr) {
            this.logger.error(
              `[payOrder tip rollback failed] order=${orderId}: ${(rollbackErr as Error).message}`,
            );
          }
        }
        throw this.wrapPaymentFailure('tip_not_allowed_on_installment', {
          message:
            'No se puede registrar propina en el abono de una cuota: alteraria el plan de cuotas ya calculado.',
          order_id: orderId,
          installment_id: dto.installment_id,
          tip_amount: incomingTip.amount,
        });
      }
      // Idempotente: `grand_total` ya incluye cualquier propina persistida en
      // un intento anterior, asi que se descuenta antes de sumar la nueva. Sin
      // esto, un reintento tras un cargo fallido cobra la propina dos veces.
      const previousTip = Number((order as any).tip_amount || 0);
      const baseTotal = roundTipMoney(
        Number(order.grand_total || 0) - previousTip,
      );
      const newGrandTotal = roundTipMoney(baseTotal + incomingTip.amount);
      if (
        incomingTip.amount !== previousTip ||
        newGrandTotal !== Number(order.grand_total || 0)
      ) {
        await this.prisma.orders.update({
          where: { id: orderId },
          data: {
            tip_amount: incomingTip.amount,
            tip_type: incomingTip.type,
            tip_value: incomingTip.value,
            tip_waiter_id: dto.tip_waiter_id ?? null,
            grand_total: newGrandTotal,
            updated_at: new Date(),
          },
        });
        order = await this.getOrder(orderId); // recarga: grand_total con propina
      }
    }

    // Existing partial abonos remain valid; charge only the outstanding
    // balance, including any tip just persisted above.
    const amountToCharge = new Prisma.Decimal(order.grand_total)
      .minus(settledAmount).toNumber();
    const paidBalance = new Prisma.Decimal(order.grand_total).toNumber();
    const settledBalanceMetadata = {
      total_paid: paidBalance,
      remaining_balance: 0,
    };
    // Fase 2 paso 5 — `flow/pay` sobre una orden con pago manual pendiente lo
    // CONFIRMA en sitio (ver `confirmInPlaceMarker`); el marcador contra
    // entrega se anula (`cancelled`) y se crea el pago real. En ambos casos
    // nunca quedan dos pagos que sumen doble.
    const manualPendingPayments = (order.payments ?? []).filter((payment) =>
      isManualConfirmationPending(payment),
    );
    const isManualSettlement = manualPendingPayments.length > 0;
    const settlementPendingPaymentIds = (order.payments ?? [])
      .filter((payment) =>
        (payment.state === 'pending' &&
          payment.store_payment_method?.system_payment_method?.processing_mode === 'ON_DELIVERY') ||
        isManualConfirmationPending(payment),
      )
      .map((payment) => payment.id);
    // Origen para `gateway_response.metadata`/`payment_registered`: COD manda
    // (compatibilidad histórica) cuando hay ambos marcadores; sin COD, manual.
    // Sin marcadores no se usa (el bloque de metadata no se escribe).
    const settlementOrigin = isCodSettlement
      ? 'cash_on_delivery'
      : 'manual_confirmation';
    // Comprobante del pago manual anulado → metadata del pago real. Gana el
    // primer marcador (el checkout crea uno por orden); sólo viaja si al menos
    // un campo trae valor.
    const firstManualMarker = manualPendingPayments[0];
    const settlementReceipt =
      firstManualMarker &&
      (firstManualMarker.receipt_s3_key != null ||
        firstManualMarker.receipt_uploaded_at != null ||
        firstManualMarker.bank_account_id != null)
        ? {
            receipt_s3_key: firstManualMarker.receipt_s3_key ?? null,
            receipt_uploaded_at: firstManualMarker.receipt_uploaded_at ?? null,
            bank_account_id: firstManualMarker.bank_account_id ?? null,
          }
        : null;
    // Registrar pago sobre un pago online MANUAL pendiente (transferencia con
    // comprobante, voucher…): el primer tramo CONFIRMA esa misma fila en vez
    // de anularla y crear otra — el pago que el cliente hizo online es el que
    // se registra. Sólo contra entrega (`ON_DELIVERY`) conserva el
    // anular+crear histórico: su marcador no es un pago, es una promesa.
    const confirmInPlaceMarker =
      !isCodSettlement && firstManualMarker ? firstManualMarker : null;
    const markerIdsToVoid = confirmInPlaceMarker
      ? settlementPendingPaymentIds.filter((id) => id !== confirmInPlaceMarker.id)
      : settlementPendingPaymentIds;
    const paymentHistoryCtx = {
      storeId: order.store_id,
      organizationId: order.stores?.organization_id,
      settlementPendingPaymentIds,
      settlementOrigin,
      settlementReceipt,
      confirmInPlacePayment: confirmInPlaceMarker,
    };
    // Fase 2 paso 5 — carril "registrar pago": SÓLO aquí `dto.amount` define lo
    // cobrado. Cubre el marcador manual y los parciales siguientes (el primer
    // registro ya anuló el marcador, así que `pending_payment` + abonos
    // `succeeded` también es carril). Fuera del carril `amount` se ignora como
    // siempre. Comparación en centavos enteros, igual que
    // `normalizePaymentLegs`.
    const toChargeCents = (value: number) =>
      Math.round(Number(value || 0) * 100);
    // Mismo predicado que la acción "Registrar pago" (`requiresPaymentRegistration`):
    // una orden WhatsApp/contra entrega en `pending_payment` con
    // `remaining_balance > 0` es carril, así que el parcial que manda el modal
    // se respeta en vez de cobrar el saldo completo en silencio. Se evalúa con
    // el estado PREVIO al claim (la orden recargada ya está en `processing`).
    const isManualLane =
      isManualSettlement ||
      (preClaimState === 'pending_payment' &&
        (settledAmount.gt(0) ||
          requiresPaymentRegistration({
            state: preClaimState,
            remaining_balance: (order as any).remaining_balance,
            payments: order.payments,
          })));
    const isChargeAmountLane =
      isManualLane && dto.payment_type === PaymentType.DIRECT;
    let chargeAmount = amountToCharge;
    if (isChargeAmountLane && dto.amount != null) {
      chargeAmount = Number(dto.amount);
      if (!Number.isFinite(chargeAmount) || toChargeCents(chargeAmount) <= 0) {
        throw new VendixHttpException(
          ErrorCodes.PAY_INVALID_AMOUNT_001,
          'El monto a cobrar debe ser mayor a cero.',
          { amount: dto.amount },
        );
      }
      // Lo cobrado nunca supera el saldo, en ningún método: el "de más" en
      // efectivo entra por `amount_received` y sale como vuelto (`change`).
      if (toChargeCents(chargeAmount) > toChargeCents(amountToCharge)) {
        throw new VendixHttpException(
          ErrorCodes.PAY_INVALID_AMOUNT_001,
          'El monto a cobrar no puede superar el saldo pendiente.',
          { amount: dto.amount, outstanding_balance: amountToCharge },
        );
      }
    }
    // Parcial = monto explícito menor al saldo. Sólo vive en `pending_payment`
    // (la orden "permanece" ahí); en cualquier otro estado se rechaza en voz
    // alta en vez de cobrar de más en silencio.
    const wantsPartialAmount =
      isChargeAmountLane &&
      dto.amount != null &&
      toChargeCents(chargeAmount) < toChargeCents(amountToCharge);
    if (wantsPartialAmount && preClaimState !== 'pending_payment') {
      throw new VendixHttpException(
        ErrorCodes.PAY_PARTIAL_NOT_ALLOWED_001,
        undefined,
        {
          order_id: orderId,
          pre_claim_state: preClaimState,
          amount: dto.amount,
        },
      );
    }
    const isPartialCharge = wantsPartialAmount;
    // Lo que el normalizador debe cuadrar: el parcial, o el saldo exacto (sin
    // polvo flotante de `dto.amount`) cuando se salda.
    const payableAmount = isPartialCharge ? chargeAmount : amountToCharge;

    // Cobro multimétodo de contado — normalización única (escalar → 1 tramo).
    // Sólo en los carriles que cobran de inmediato (shipped/direct): el carril
    // online crea un pago `pending` y admite pasarela, así que no normaliza.
    // El escalar reutiliza el `paymentMethod` ya cargado (sin `findMany`
    // extra); con `payments[]` los métodos se cargan por `id IN (...)` bajo
    // el scope de tienda. PLAN-pago-multimetodo-pendientes paso 3 — el
    // contrato de la app móvil distingue las dos superficies: un payload
    // inválido (montos, método no permitido, Σ≠total) es un rechazo de
    // VALIDACIÓN y sale como 400 con su propio `error_code`
    // (`PAY_MULTI_TENDER_*`/`PAY_INVALID_AMOUNT_001`), tal cual lo tipa el
    // normalizador — ya NO se envuelve. Sólo un conflicto de ESTADO del
    // flujo (orden no cobrable, cocina pendiente, finish bloqueado, etc.)
    // sigue siendo 409 `ORD_FLOW_PAYMENT_FAILED_001` con la causa tipada en
    // `details.cause_code`.
    const isPreClaimDeliveredOrFinished =
      preClaimState === 'delivered' || preClaimState === 'finished';
    const isImmediateCharge =
      preClaimState === 'shipped' ||
      isPreClaimDeliveredOrFinished ||
      dto.payment_type === PaymentType.DIRECT;
    let legs: NormalizedLeg[] = [];
    let change = 0;
    let legMethodTypes: Record<number, string> = {};
    if (isImmediateCharge) {
      const requestedLegs = Array.isArray(dto.payments) ? dto.payments : [];
      let methodsById: Record<number, PaymentLegMethodInfo>;
      if (requestedLegs.length > 0) {
        const legMethodIds = [
          ...new Set(requestedLegs.map((leg) => leg.store_payment_method_id)),
        ];
        const legRows = await this.prisma.store_payment_methods.findMany({
          where: { id: { in: legMethodIds } },
          include: { system_payment_method: true },
        });
        if (isCodSettlement && legRows.some((row) => !isActualCodTender(row.system_payment_method))) {
          throw new VendixHttpException(
            ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED,
            'Contra entrega solo admite el método realmente recibido: efectivo, transferencia o datáfono.',
          );
        }
        methodsById = {};
        for (const row of legRows) {
          methodsById[row.id] = {
            type: row?.system_payment_method?.type ?? '',
            processing_mode:
              row?.system_payment_method?.processing_mode ?? null,
            // Plan PLAN-pago-multimetodo-fixes paso 2 — mismo fallback que
            // ya usa la respuesta del POS (payments.service.ts ~2088):
            // nombre visible de la tienda, luego el del sistema, nunca vacío.
            display_name:
              (row as any)?.display_name ||
              row?.system_payment_method?.display_name ||
              'Unknown',
            // PR #858 hallazgo 1 — etiqueta CONTABLE, separada de la de UI:
            // `payment.received` la lleva como `payment_method` y
            // `resolveCashBankKey` elige Caja/Bancos con ella. Un efectivo
            // que la tienda renombró «Caja» no debe caer en Bancos. Misma
            // fuente que el POS (`payments.service.ts` ~1880).
            accounting_method:
              row?.system_payment_method?.display_name || 'Unknown',
          };
        }
      } else {
        if (isCodSettlement && !isActualCodTender(paymentMethod.system_payment_method)) {
          throw new VendixHttpException(
            ErrorCodes.PAY_MULTI_TENDER_METHOD_NOT_ALLOWED,
            'Contra entrega solo admite el método realmente recibido: efectivo, transferencia o datáfono.',
          );
        }
        methodsById = {
          [dto.store_payment_method_id]: {
            type: paymentMethod.system_payment_method?.type ?? '',
            processing_mode:
              paymentMethod.system_payment_method?.processing_mode ?? null,
            display_name:
              (paymentMethod as any)?.display_name ||
              paymentMethod.system_payment_method?.display_name ||
              'Unknown',
            accounting_method:
              paymentMethod.system_payment_method?.display_name || 'Unknown',
          },
        };
      }
      for (const [id, info] of Object.entries(methodsById)) {
        legMethodTypes[Number(id)] = info.type;
      }
      try {
        const normalized = normalizePaymentLegs(
          dto,
          payableAmount,
          methodsById,
        );
        legs = normalized.legs;
        change = normalized.change;
      } catch (err) {
        // PLAN-pago-multimetodo-pendientes paso 3 — el normalizador ya tipa
        // el rechazo (`PAY_MULTI_TENDER_SUM_MISMATCH`,
        // `PAY_MULTI_TENDER_METHOD_NOT_ALLOWED`,
        // `PAY_MULTI_TENDER_MULTIPLE_CASH`, `PAY_INVALID_AMOUNT_001`, …): es
        // un rechazo de VALIDACIÓN de payload, no un conflicto de estado del
        // flujo. Se relanza tal cual SIN envolver para que la superficie sea
        // 400 con su propio `error_code` — mismo criterio que la guarda
        // `payment_type: 'online' + payments[]` de arriba (~:1537). Sólo un
        // error no tipado (infra) cae al 409 genérico de `wrapPaymentFailure`.
        if (err instanceof VendixHttpException) {
          throw err;
        }
        throw this.wrapPaymentFailure('multi_tender_legs', err as Error);
      }
    }

    // Fase 2 paso 5 — pago PARCIAL del carril manual (`amount` < saldo, orden
    // en `pending_payment`): registra los pagos `succeeded`, actualiza
    // `total_paid`/`remaining_balance` y restaura el claim, SIN transición de
    // estado (nada de `updateOrderState`: sin consumo de stock, sin factura,
    // sin ETA, sin proyección a mesa; el cupón se consume al saldar). La acción
    // "Registrar pago" sigue disponible para el saldo (paso 6).
    if (isPartialCharge) {
      const legPayments = await this.createLegPayments(
        orderId,
        order.currency,
        legs,
        change,
        paymentHistoryCtx,
      );
      paymentPersisted = true;

      const partialBalanceMetadata = {
        total_paid: settledAmount.plus(chargeAmount).toNumber(),
        remaining_balance: new Prisma.Decimal(amountToCharge)
          .minus(chargeAmount)
          .toNumber(),
      };
      try {
        await this.prisma.orders.update({
          where: { id: orderId },
          data: { ...partialBalanceMetadata, updated_at: new Date() },
        });
      } catch (e) {
        // Mismo contrato que las demás ramas: si el saldo no persiste, los
        // tramos se compensan y la orden vuelve a su estado previo.
        await this.cancelLegPayments(legPayments, 'partial_balance_blocked');
        paymentCompensated = true;
        await this.restorePreClaimState(orderId, preClaimState);
        throw this.wrapPaymentFailure(
          'partial_balance_blocked',
          { order_id: orderId },
          (e as any)?.errorCode ?? 'n/a',
        );
      }
      // El claim movió `pending_payment` → `processing`: devolverla a su
      // estado, donde espera el resto del saldo.
      await this.restorePreClaimState(orderId, preClaimState);
      await this.voidSettlementPendingMarkers(markerIdsToVoid);

      this.logger.log(
        `Order #${orderId} partial payment registered (${partialBalanceMetadata.total_paid} of ${paidBalance}); remaining ${partialBalanceMetadata.remaining_balance}`,
      );

      // Movimiento de caja por tramo, neto de vuelto (`leg.amount`).
      for (const { payment, leg } of legPayments) {
        this.recordPayOrderCashMovement(
          order.store_id,
          orderId,
          leg.amount,
          legMethodTypes[leg.store_payment_method_id] ?? '',
          payment.id,
        ).catch(() => {});
      }

      // Un `payment.received` por tramo (el asiento resuelve su rama
      // con/sin factura; la retención se prorratea a la porción de este
      // cobro). Sin `emitPosSaleCompletedIfFullyPaid`: un abono no cierra
      // la venta.
      await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);

      const updatedOrder = await this.prisma.orders.findFirst({
        where: { id: orderId },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
          payments: true,
        },
      });

      return {
        order: updatedOrder,
        ...this.buildLeggedPaymentResponse(legPayments, change),
      };
    }

    // Shipped orders: register payment without changing state
    if (preClaimState === 'shipped') {
      // Multimétodo: una fila `succeeded` por tramo (el escalar es 1 tramo).
      // El `if` falsy de efectivo + `amount_received_short` vivían aquí: la
      // validación ahora es la del normalizador (ver bloque de arriba).
      const legPayments = await this.createLegPayments(
        orderId,
        order.currency,
        legs,
        change,
        paymentHistoryCtx,
      );
      paymentPersisted = true;

      // The claim temporarily moved shipped -> processing. Restore its
      // logistics state and persist the settled balance with the payment.
      await this.updateOrderState(orderId, 'shipped', settledBalanceMetadata, { historyFromState: preClaimState });
      await this.voidSettlementPendingMarkers(markerIdsToVoid);

      // Round 1 MAJOR #13 — cupón en `flow/pay` (shipped):
      // si la orden trae `coupon_id` y no existe `coupon_uses` aún,
      // crea la fila + incrementa `current_uses` UNA vez.
      await this.commitCouponUseForOrder(orderId);

      const updatedOrder = await this.prisma.orders.findFirst({
        where: { id: orderId },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
          payments: true,
        },
      });

      this.logger.log(`Order #${orderId} payment registered while shipped`);

      // Record cash register movement per leg (non-blocking)
      for (const { payment, leg } of legPayments) {
        this.recordPayOrderCashMovement(
          order.store_id,
          orderId,
          leg.amount,
          legMethodTypes[leg.store_payment_method_id] ?? '',
          payment.id,
        ).catch(() => {});
      }

      // Compute and persist ETA
      await this.computeAndPersistEta(orderId, new Date());

      // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received` por
      // tramo, SÓLO en el camino de éxito (el `updateOrderState` de arriba ya
      // terminó bien).
      await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);

      // Contra entrega de una orden POS: el pago de este cobro la deja saldada.
      await this.emitPosSaleCompletedIfFullyPaid(orderId, 'pay_order.shipped');
      // La proyección a mesa es first-wins e idempotente (`markSessionPaid`
      // reclama con `paid_at IS NULL`): un solo llamado con el primer tramo
      // basta y conserva el comportamiento escalar.
      await this.projectPaidOrderToTable(orderId, legPayments[0].payment.id);

      return {
        order: updatedOrder,
        ...this.buildLeggedPaymentResponse(legPayments, change),
      };
    }

    // B1b (order-truth-and-invoice-tz plan) — `delivered` orders settle
    // money ONLY. The goods already left; finishing (stock commit,
    // `order.completed`, the POS invoice) is a SEPARATE, explicit action
    // (`confirm_delivery`/`finishOrder`), not a side effect of collecting a
    // payment. Mirrors the `shipped` branch above (register the legs without
    // driving the state machine through `validateTransition`) but, unlike
    // `shipped`, deliberately does NOT call `emitPosSaleCompletedIfFullyPaid`
    // here — invoicing a `delivered` payment now would emit before the sale
    // is actually closed; the finalize step is what has to trigger it.
    if (preClaimState === 'delivered') {
      const legPayments = await this.createLegPayments(
        orderId,
        order.currency,
        legs,
        change,
        paymentHistoryCtx,
      );
      paymentPersisted = true;

      await this.commitCouponUseForOrder(orderId);

      let updatedOrder;
      try {
        updatedOrder = await this.updateOrderState(orderId, 'delivered', {
          paid_at: new Date(),
          ...settledBalanceMetadata,
        }, { historyFromState: preClaimState });
      } catch (e) {
        // Same contract as every other branch: a state-write failure after
        // the legs were created compensates instead of leaving them orphaned.
        await this.cancelLegPayments(legPayments, 'finish_blocked');
        paymentCompensated = true;
        await this.restorePreClaimState(orderId, preClaimState);
        throw this.wrapPaymentFailure(
          'finish_blocked',
          { order_id: orderId },
          (e as any)?.errorCode ?? 'n/a',
        );
      }

      // Void the settlement pending marker(s) (COD o manual) so they never
      // count as a second, parallel settlement of the same order
      // (analytics/cash-register dedupe by `payments.state`, not by count).
      await this.voidSettlementPendingMarkers(markerIdsToVoid);

      this.logger.log(
        `Order #${orderId} payment registered while delivered (settled, awaiting finalize)`,
      );

      // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received` por
      // tramo, SÓLO en el camino de éxito (el `updateOrderState` de arriba ya
      // terminó bien). A diferencia de `shipped`/`finished`, esta rama no
      // llama a `emitPosSaleCompletedIfFullyPaid` (la venta aún no se cierra
      // aquí), pero el pago SÍ existe y debe reconocer su caja/banco.
      await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);

      for (const { payment, leg } of legPayments) {
        this.recordPayOrderCashMovement(
          order.store_id,
          orderId,
          leg.amount,
          legMethodTypes[leg.store_payment_method_id] ?? '',
          payment.id,
        ).catch(() => {});
      }

      await this.projectPaidOrderToTable(orderId, legPayments[0].payment.id);

      return {
        order: updatedOrder,
        ...this.buildLeggedPaymentResponse(legPayments, change),
      };
    }

    // B8/B4 — `finished` orders without a succeeded payment: an ecommerce
    // COD order whose `payment.pending` marker never got replaced (checkout
    // persisted `remaining_balance = grand_total`, see checkout.service.ts
    // ON_DELIVERY fix). `isOrderFullyPaid` above already rejected any order
    // that is genuinely settled, so reaching here means this charge is
    // legitimate. Unchanged by B1b: a `finished` order that receives its
    // orphaned payment simply keeps its state.
    if (preClaimState === 'finished') {
      const legPayments = await this.createLegPayments(
        orderId,
        order.currency,
        legs,
        change,
        paymentHistoryCtx,
      );
      paymentPersisted = true;

      await this.commitCouponUseForOrder(orderId);

      let updatedOrder;
      try {
        updatedOrder = await this.updateOrderState(orderId, 'finished', {
          paid_at: new Date(),
          finished_at: new Date(),
          ...settledBalanceMetadata,
        }, { historyFromState: preClaimState });
      } catch (e) {
        // Mismo contrato que el cobro directo: el finish falló tras crear los
        // tramos → se compensan y la orden vuelve a su estado previo.
        await this.cancelLegPayments(legPayments, 'finish_blocked');
        paymentCompensated = true;
        await this.restorePreClaimState(orderId, preClaimState);
        throw this.wrapPaymentFailure(
          'finish_blocked',
          { order_id: orderId },
          (e as any)?.errorCode ?? 'n/a',
        );
      }

      // Void the settlement pending marker(s) (COD o manual) so they never
      // count as a second, parallel settlement of the same order
      // (analytics/cash-register dedupe by `payments.state`, not by count).
      await this.voidSettlementPendingMarkers(markerIdsToVoid);

      this.logger.log(
        `Order #${orderId} payment registered while finished (orphaned/COD) -> finished`,
      );

      for (const { payment, leg } of legPayments) {
        this.recordPayOrderCashMovement(
          order.store_id,
          orderId,
          leg.amount,
          legMethodTypes[leg.store_payment_method_id] ?? '',
          payment.id,
        ).catch(() => {});
      }

      // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received` por
      // tramo, SÓLO en el camino de éxito (el `updateOrderState` de arriba ya
      // terminó bien).
      await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);

      await this.emitPosSaleCompletedIfFullyPaid(
        orderId,
        `pay_order.${preClaimState}`,
      );
      await this.projectPaidOrderToTable(orderId, legPayments[0].payment.id);

      return {
        order: updatedOrder,
        ...this.buildLeggedPaymentResponse(legPayments, change),
      };
    }

    if (dto.payment_type === PaymentType.DIRECT) {
      // Direct payment (cash, card at POS) - goes straight to finished.
      // Multimétodo: una fila `succeeded` por tramo (el escalar es 1 tramo).
      // El `if` falsy de efectivo + `amount_received_short` vivían aquí: la
      // validación ahora es la del normalizador (ver bloque de arriba).
      const legPayments = await this.createLegPayments(
        orderId,
        order.currency,
        legs,
        change,
        paymentHistoryCtx,
      );
      paymentPersisted = true;

      // Round 1 MAJOR #13 — cupón en `flow/pay` (direct):
      // consume una vez si la orden aún no tiene `coupon_uses` para este cupón.
      await this.commitCouponUseForOrder(orderId);

      // Only auto-finish for direct_delivery (POS) or other (no shipping method).
      // Orders with home_delivery or pickup need fulfillment stages.
      const requiresFulfillment =
        order.delivery_type !== 'direct_delivery' &&
        order.delivery_type !== 'other';

      if (requiresFulfillment) {
        this.validateTransition(order.state as OrderState, 'processing');
        const updatedOrder = await this.updateOrderState(
          orderId,
          'processing',
          {
            paid_at: new Date(),
            ...settledBalanceMetadata,
          },
          { historyFromState: preClaimState },
        );
        await this.voidSettlementPendingMarkers(markerIdsToVoid);

        this.logger.log(
          `Order #${orderId} paid directly, moved to processing (requires fulfillment)`,
        );

        // Record cash register movement per leg (non-blocking)
        for (const { payment, leg } of legPayments) {
          this.recordPayOrderCashMovement(
            order.store_id,
            orderId,
            leg.amount,
            legMethodTypes[leg.store_payment_method_id] ?? '',
            payment.id,
          ).catch(() => {});
        }

        // Compute and persist ETA
        await this.computeAndPersistEta(orderId, new Date());

        // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received`
        // por tramo, SÓLO en el camino de éxito.
        await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);

        await this.emitPosSaleCompletedIfFullyPaid(
          orderId,
          'pay_order.processing',
        );
        await this.projectPaidOrderToTable(orderId, legPayments[0].payment.id);

        return {
          order: updatedOrder,
          ...this.buildLeggedPaymentResponse(legPayments, change),
        };
      }

      // F2-guard (fast-track "other vía"): a direct_delivery/other order
      // whose kitchen has not handed off every fired item cannot go
      // straight to `finished` from this branch. B13: from the normal
      // "pagar" call (order detail / `/flow/pay`), that used to CANCEL the
      // just-created payment and fail the whole charge — the cashier saw a
      // rejected sale for a plate that was already in the kitchen. The
      // fixed behavior keeps the payment and lands the order in
      // `processing` (paid, pending delivery), same shape as the
      // `requiresFulfillment` branch above; the kitchen keeps owning
      // delivery through the normal `deliverOrderItem`/`confirmDelivery`
      // path once it hands the items off.
      //
      // `fastTrackOrder` reaches this same branch (not via
      // `confirmDelivery`) and its one-shot state machine (pay → ship →
      // deliver → finish, see ~5410) DOES depend on the previous
      // throw-and-abort: without it, a `processing` order with kitchen
      // items still pending would fall into fastTrackOrder's
      // `current.state === 'processing'` step and get auto-`shipOrder`'d
      // and auto-delivered, bypassing the kitchen entirely (the exact
      // double-discount/bypass risk B13 is fixing, just moved one level
      // up). So `fastTrackOrder` opts into the OLD strict behavior via
      // `options.strictKitchenPending`, preserving its existing contract;
      // only the direct "pagar" call gets the new lenient one.
      if (await this.hasPendingKitchenItems(orderId)) {
        if (options?.strictKitchenPending) {
          // Los pagos `succeeded` ya están creados arriba. Los cancelamos TODOS
          // con el mismo motivo para mantener la regla "un payment por intento
          // de cobro" y propagamos como `ORD_FLOW_PAYMENT_FAILED_001` con el
          // código tipado original como causa.
          await this.cancelLegPayments(legPayments, 'kitchen_items_pending');
          paymentCompensated = true;
          // El claim del inicio ya movió la orden a `processing`. Sin restaurar,
          // queda varada en `processing` con el pago anulado: ni cobrable (el
          // claim sólo acepta draft/created/shipped/pending_payment) ni cerrable.
          if (preClaimState !== 'draft') {
            await this.restorePreClaimState(orderId, preClaimState);
          }
          throw this.wrapPaymentFailure(
            'kitchen_pending',
            { order_id: orderId },
            ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code,
          );
        }

        this.validateTransition(order.state as OrderState, 'processing');
        const updatedOrder = await this.updateOrderState(
          orderId,
          'processing',
          {
            paid_at: new Date(),
            ...settledBalanceMetadata,
          },
          { historyFromState: preClaimState },
        );
        await this.voidSettlementPendingMarkers(markerIdsToVoid);

        this.logger.log(
          `Order #${orderId} paid directly with pending kitchen items, moved to processing`,
        );

        for (const { payment, leg } of legPayments) {
          this.recordPayOrderCashMovement(
            order.store_id,
            orderId,
            leg.amount,
            legMethodTypes[leg.store_payment_method_id] ?? '',
            payment.id,
          ).catch(() => {});
        }

        await this.computeAndPersistEta(orderId, new Date());
        // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received`
        // por tramo, SÓLO en el camino de éxito.
        await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);
        await this.emitPosSaleCompletedIfFullyPaid(
          orderId,
          'pay_order.processing_kitchen_pending',
        );
        await this.projectPaidOrderToTable(orderId, legPayments[0].payment.id);

        return {
          order: updatedOrder,
          ...this.buildLeggedPaymentResponse(legPayments, change),
        };
      }

      this.validateTransition(order.state as OrderState, 'finished');
      // The succeeded payment was created above, BEFORE the finish. If the
      // finish is blocked by insufficient stock (INV_STOCK_002) or missing
      // serials (SERIAL_REQUIRED_001), the order stays 'created' and that
      // payment would be orphaned. Business rule (confirmed): keep + compensate
      // — cancel the payment (preserving the audit trail) and propagate the 409.
      // NOTE: the pending-kitchen guard above compensates the same way — it
      // cancels the payment (cancellation_reason 'kitchen_items_pending') and
      // restores the pre-claim state before throwing; this block covers the
      // finish throw.
      let updatedOrder;
      try {
        updatedOrder = await this.updateOrderState(orderId, 'finished', {
          paid_at: new Date(),
          finished_at: new Date(),
          ...settledBalanceMetadata,
        }, { historyFromState: preClaimState });
        await this.voidSettlementPendingMarkers(markerIdsToVoid);
      } catch (e) {
        if (e instanceof VendixHttpException) {
          await this.cancelLegPayments(
            legPayments,
            'finish_blocked_insufficient_stock',
          );
          paymentCompensated = true;
          // 1060 paso 3 — el finish falló tras el claim: restaurar el estado
          // previo al claim para no dejar la orden varada en `processing`
          // (el pago compensado con motivo se conserva arriba).
          if (preClaimState !== 'draft') {
            await this.restorePreClaimState(orderId, preClaimState);
          }
          // Round 1 MAJOR #11: el código de superficie que ve el caller es
          // SIEMPRE `ORD_FLOW_PAYMENT_FAILED_001`. El código tipado original
          // (p.ej. `INV_STOCK_002` / `SERIAL_REQUIRED_001`) viaja en
          // `details.cause_code` para que la UI y soporte puedan pivotar.
          throw this.wrapPaymentFailure('finish_blocked', e);
        }
        // Error de infra (no Vendix): envolvemos también, pero sin un
        // cause_code tipado. La restauración aplica igual: el claim ya se
        // tomó y el finish no comprometió nada.
        if (preClaimState !== 'draft') {
          await this.restorePreClaimState(orderId, preClaimState);
        }
        throw this.wrapPaymentFailure('finish_blocked_infra', {
          order_id: orderId,
          error: (e as Error)?.message ?? 'unknown',
        });
      }

      this.logger.log(`Order #${orderId} paid directly and finished`);

      // Record cash register movement per leg (non-blocking)
      for (const { payment, leg } of legPayments) {
        this.recordPayOrderCashMovement(
          order.store_id,
          orderId,
          leg.amount,
          legMethodTypes[leg.store_payment_method_id] ?? '',
          payment.id,
        ).catch(() => {});
      }

      // Compute and persist ETA
      await this.computeAndPersistEta(orderId, new Date());

      // PLAN-pago-multimetodo-pendientes paso 2 — un `payment.received` por
      // tramo, SÓLO en el camino de éxito (el `updateOrderState` de arriba ya
      // terminó bien; las ramas compensadas arriba (`finish_blocked*`,
      // `kitchen_items_pending`) ya salieron por `throw` y nunca llegan acá).
      await this.emitLegPaymentReceivedEvents(orderId, order, legPayments);

      await this.emitPosSaleCompletedIfFullyPaid(orderId, 'pay_order.finished');
      await this.projectPaidOrderToTable(orderId, legPayments[0].payment.id);

      return {
        order: updatedOrder,
        ...this.buildLeggedPaymentResponse(legPayments, change),
      };
    } else {
      // Online payment - goes to pending_payment
      const isReservedDigitalPayment = ['wallet', 'wompi'].includes(
        paymentMethod.system_payment_method?.type ?? '',
      );
      // `order.state` is the transient processing claim, not the business
      // state the cashier paid from. Validate the real edge BEFORE creating
      // a pending row, so a rejected transition cannot strand a reservation.
      this.validateTransition(
        preClaimState === 'draft'
          ? 'created'
          : ((preClaimState ?? order.state) as OrderState),
        'pending_payment',
      );
      const transactionId = await this.generateTransactionId();

      const pendingPayment = await this.prisma.payments.create({
        data: {
          order_id: orderId,
          store_payment_method_id: dto.store_payment_method_id,
          amount: amountToCharge,
          currency: order.currency,
          state: 'pending',
          transaction_id: transactionId,
          // The gateway owns the eventual reference. A client-provided value
          // must not masquerade as a confirmed provider transaction.
          gateway_reference: isReservedDigitalPayment
            ? null
            : dto.payment_reference ?? null,
          gateway_response: {
            payment_type: 'online',
          },
        },
      });
      paymentPersisted = true;

      let updatedOrder;
      try {
        updatedOrder = await this.updateOrderState(
          orderId,
          'pending_payment',
          {},
          { historyFromState: preClaimState },
        );
      } catch (error) {
        // No processor has run yet. Cancel the one reserved digital row and
        // reopen the claimed order atomically, including any draft stock
        // reservation. If compensation fails, keep the claim/pending row
        // fail-closed instead of allowing a second active reservation.
        if (isReservedDigitalPayment) {
          try {
            await this.compensateUnprocessedDigitalReservation(
              orderId,
              order.store_id,
              pendingPayment.id,
              preClaimState,
              draftReservations,
            );
          } catch (compensationError) {
            this.logger.error(
              `[flow/pay digital reservation compensation failed] order=${orderId} payment=${pendingPayment.id}: ${(compensationError as Error).message}`,
            );
          }
        }
        throw error;
      }

      this.logger.log(
        `Order #${orderId} moved to pending_payment for online payment`,
      );
      return {
        order: updatedOrder,
        payment: isReservedDigitalPayment
          ? { id: pendingPayment.id, transaction_id: transactionId }
          : { transaction_id: transactionId },
      };
    }
    } catch (error) {
      // A persisted succeeded/pending payment owns its claim, even if a later
      // projection fails. A pre-payment failure must reopen every claimed
      // state, not only draft: otherwise an invalid payment method strands a
      // created order in processing with zero payments (and allows finishing).
      if (!paymentPersisted || paymentCompensated) {
        try {
          if (preClaimState === 'draft' && draftStoreId != null) {
            await this.compensateClaimedDraftPayment(
              orderId,
              draftStoreId,
              draftReservations,
            );
          } else {
            await this.restorePreClaimState(orderId, preClaimState);
          }
        } catch (compensationError) {
          // The transaction rolls back the releases too. Keep processing
          // claimed (no retry/double charge) and preserve the original error.
          this.logger.error(
            `[payOrder claim compensation failed] order=${orderId}: ${(compensationError as Error).message}`,
          );
        }
      }
      throw error;
    }
  }

  /** A projection error is reported after the payment has committed; it must
   * never enter the charge/finish compensation path. */
  private async projectPaidOrderToTable(orderId: number, paymentId: number): Promise<void> {
    // Resolve lazily: TableSessionsService itself injects OrderFlowService, so
    // constructor injection here would create a provider (and CJS) cycle.
    // Legacy service-only specs construct this class without Nest's ModuleRef.
    if (!this.moduleRef) return;
    try {
      const { TableSessionsService: TableSessionsToken } = require('../../tables/table-sessions.service') as typeof import('../../tables/table-sessions.service');
      const tableSessionsService = this.moduleRef.get(TableSessionsToken, { strict: false });
      await tableSessionsService.projectOrderPaymentToTableSession(orderId, paymentId);
    } catch (error) {
      this.logger.error(
        `[flow/pay table projection failed] order=${orderId} payment=${paymentId}: ${(error as Error)?.message ?? String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new VendixHttpException(ErrorCodes.POS_TABLE_SESSION_PROJECTION_FAILED_001);
    }
  }

  /**
   * Confirm payment for an order in pending_payment or shipped state.
   * - pending_payment → processing (standard flow)
   * - shipped → shipped (payment confirmed, no state change — logistics already advanced)
   * Called from webhook handlers or manually by admin
   */
  /** Trusted settlement of the ONE physical source. No new payment is created.
   * Tables retain their KDS lifecycle/manual close; ordinary POS orders use
   * existing reservation + idempotent stock-commit services exactly once.
   */
  async settleFinancialSplitSource(orderId: number, actorUserId?: number): Promise<void> {
    const context = RequestContextService.getContext();
    if (actorUserId && context?.user_id !== actorUserId) {
      return RequestContextService.runIsolated({ ...context!, user_id: actorUserId },
        () => this.settleFinancialSplitSource(orderId, actorUserId));
    }
    const order = await this.getOrder(orderId);
    if (!order.active_financial_split_id || ['cancelled', 'refunded'].includes(order.state)) return;
    const paid = order.payments.filter((p) => ['succeeded', 'captured'].includes(p.state))
      .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    if (paid.lt(order.grand_total)) return;
    const table = await this.prisma.table_sessions.findFirst({ where: { order_id: orderId, store_id: order.store_id }, select: { id: true } });
    if (table) return;
    if (order.state === 'draft') await this.promoteDraftToCreated(orderId, order.store_id);
    await this.prisma.orders.updateMany({
      where: { id: orderId, store_id: order.store_id, state: { in: ['created', 'pending_payment'] }, active_financial_split_id: order.active_financial_split_id },
      data: { state: 'processing', updated_at: new Date() },
    });
    const current = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: order.store_id },
      include: { order_items: { include: { products: { select: { requires_serial_numbers: true } } } } },
    });
    if (current?.channel === 'pos' && current.delivery_type === 'direct_delivery' &&
        !current.order_items.some((line) => line.products?.requires_serial_numbers)) {
      // docs/plans/no-overselling-stock-guard-plan.md step 5 (reverses
      // QUI-557): a financial-split source order is a real sale closing out
      // — it must block on insufficient stock like every other delivery
      // commit, not silently oversell with a floor of 0.
      // Step 9: unless the store's "Permitir sobreventa" switch is active,
      // in which case it logs and lets the commit go through negative.
      const inventoryPolicy = await this.stockValidator?.resolveInventoryPolicy(order.store_id);
      const allowOversell = inventoryPolicy?.allowOversell === true;
      await this.orderStockCommit.commitOrderDelivery(orderId, {
        movementType: 'sale',
        blockOnInsufficient: !allowOversell,
        allowNegativeOnShortfall: allowOversell,
        onShortfall: allowOversell
          ? (item) => this.logger.warn(
              `Sobreventa permitida — orden #${orderId} split source, ${item.product_name}: requiere ${item.requested}, disponible ${item.available}.`,
            )
          : undefined,
        consumeSerials: true,
        reason: 'POS Sale (cuentas financieras cobradas)', userId: actorUserId ?? context?.user_id,
      });
    }
  }

  async confirmPayment(orderId: number, opts?: { source?: OrderEventSource }) {
    const initial = await this.getOrder(orderId);
    assertNoActiveFinancialSplit(initial);
    const afterCommit: Array<() => Promise<void>> = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrderLifecycle(tx, orderId, initial.store_id);
      const order = await this.getOrder(orderId, tx);
      if (!['pending_payment', 'shipped'].includes(order.state)) {
        return {
          order,
          applied: false,
          previousState: order.state,
          confirmedPaymentId: null as number | null,
        };
      }
      const pendingPayment = order.payments.find((p) => p.state === 'pending');
      if (order.payments.some((payment) =>
        payment.state === 'pending' &&
        payment.store_payment_method?.system_payment_method?.processing_mode === 'ON_DELIVERY',
      )) {
        throw new BadRequestException(
          'El pago contra entrega aún no se ha recibido. Selecciona el método real (efectivo, transferencia o datáfono) en Registrar Pago.',
        );
      }
      // A reserved wallet/Wompi charge is not proof of money received.
      // Only its ledger settlement or provider webhook may change the payment
      // to succeeded; the generic staff confirmation must never bypass them.
      if (order.payments.some((payment) =>
        payment.state === 'pending' &&
        (payment.gateway_response as Record<string, unknown> | null)?.payment_type === 'online' &&
        ['wallet', 'wompi'].includes(
          payment.store_payment_method?.system_payment_method?.type ?? '',
        ))) {
        throw new BadRequestException(
          'Este cobro digital está pendiente de confirmación del monedero o la pasarela.',
        );
      }
      // Fase 2 paso 6 — un pago `pending` de confirmación manual no se
      // confirma con un clic: el personal lo REGISTRA por `flow/pay` (monto +
      // método recibidos, con vuelto o saldo). Solo el webhook confirma.
      // Después de los guards de ON_DELIVERY/digital: no cambia su precedencia.
      if (
        opts?.source !== 'webhook' &&
        order.payments.some((payment) => isManualConfirmationPending(payment))
      ) {
        throw new VendixHttpException(ErrorCodes.ORD_MANUAL_PAYMENT_REQUIRES_REGISTER_001);
      }
      if (pendingPayment) {
        await tx.payments.updateMany({
          where: { id: pendingPayment.id, state: 'pending' },
          data: { state: 'succeeded', paid_at: new Date(), updated_at: new Date() },
        });
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: order.store_id,
          organizationId: order.stores?.organization_id,
          type: 'payment_registered',
          paymentId: pendingPayment.id,
          amount: pendingPayment.amount.toString(),
          source: opts?.source,
        });
      }
      await this.commitCouponUseForOrder(orderId, tx, afterCommit);

      // B8 (release-855): checkout now persists `remaining_balance =
      // grand_total` up front (it used to default to 0, silently). This
      // must settle the balance here too, or a confirmed online/gateway
      // payment would leave the order permanently reading "still owes the
      // full total". Recompute from `order.payments` (loaded before this
      // transaction) plus the leg just flipped above — same settled-states
      // definition as `payOrder`'s `settledBalanceMetadata`.
      const settledAfterConfirm = order.payments.reduce((sum, payment) => {
        const effectiveState =
          payment.id === pendingPayment?.id ? 'succeeded' : payment.state;
        return ['succeeded', 'captured'].includes(effectiveState)
          ? sum.plus(payment.amount)
          : sum;
      }, new Prisma.Decimal(0));
      const remainingAfterConfirm = Prisma.Decimal.max(
        new Prisma.Decimal(order.grand_total).minus(settledAfterConfirm),
        new Prisma.Decimal(0),
      );
      await tx.orders.updateMany({
        where: { id: orderId, store_id: order.store_id },
        data: {
          total_paid: settledAfterConfirm.toNumber(),
          remaining_balance: remainingAfterConfirm.toNumber(),
        },
      });

      if (order.state === 'pending_payment') {
        const claim = await tx.orders.updateMany({
          where: { id: orderId, store_id: order.store_id, state: 'pending_payment' },
          data: { state: 'processing', completed_at: new Date(), updated_at: new Date() },
        });
        if (claim.count !== 1) throw new BadRequestException('La orden cambió durante la confirmación.');
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: order.store_id,
          organizationId: order.stores?.organization_id,
          type: 'state_changed',
          fromState: 'pending_payment',
          toState: 'processing',
          source: opts?.source,
        });
      }
      return {
        order: await this.getOrder(orderId, tx),
        applied: true,
        previousState: order.state,
        // PLAN-pago-multimetodo-pendientes paso 2 — id del pago que ESTA
        // llamada confirmó (pending → succeeded), para emitir su
        // `payment.received` después del commit. `null` cuando la orden ya
        // no traía un pago `pending` (no-op de re-confirmación).
        confirmedPaymentId: pendingPayment?.id ?? null,
      };
    });

    // A gateway callback and the staff confirm endpoint both land here. The
    // payment is already committed; only a fully settled order may mark its
    // open table session paid. On replay, a processing order can repair a
    // missed projection, but a legitimately closed table must stay closed.
    let projectionError: unknown;
    const settledPayments = result.order.payments.filter((payment) =>
      ['succeeded', 'captured'].includes(payment.state),
    );
    const settledTotal = settledPayments.reduce(
      (sum, payment) => sum.plus(payment.amount),
      new Prisma.Decimal(0),
    );
    if (
      settledPayments.length > 0 &&
      settledTotal.greaterThanOrEqualTo(result.order.grand_total) &&
      (result.applied || ['processing', 'shipped'].includes(result.order.state))
    ) {
      try {
        const openSession = result.applied || await this.prisma.table_sessions.findFirst({
          where: { order_id: orderId, store_id: result.order.store_id, closed_at: null },
          select: { id: true },
        });
        if (openSession) {
          const paymentId = settledPayments.reduce((latest, payment) =>
            payment.id > latest.id ? payment : latest,
          ).id;
          await this.projectPaidOrderToTable(orderId, paymentId);
        }
      } catch (error) {
        // Do not hide a committed payment or skip its remaining post-commit
        // notifications. Surface ERR-33 after those effects have run.
        projectionError = error instanceof VendixHttpException
          ? error
          : new VendixHttpException(ErrorCodes.POS_TABLE_SESSION_PROJECTION_FAILED_001);
      }
    }
    for (const effect of afterCommit) await effect();

    // PLAN-pago-multimetodo-pendientes paso 2 — `payment.received` para el
    // pago que ESTA llamada confirmó (pending → succeeded).
    //
    // DESVIACIÓN reportada: se omite a propósito cuando `opts?.source ===
    // 'webhook'`. `WebhookHandlerService.updatePaymentStatus` YA emite
    // `payment.received` para el mismo pago vía `emitPaymentReceivedAccounting`
    // ANTES de llamar a `confirmPayment(orderId, { source: 'webhook' })`
    // (ver `webhook-handler.service.ts` ~250-320): emitir aquí también
    // duplicaría el evento para todo pago confirmado por pasarela. El
    // dedupe de `AutoEntryService` (clave `source_type`+`source_id`) sólo
    // detecta y descarta el duplicado — no lo previene — y está documentado
    // como sensible a condiciones de carrera; evitar la doble emisión es más
    // conservador y respeta la regla del plan ("todo cobro directo succeeded
    // reconoce su caja/banco EXACTAMENTE una vez"). El llamador de planta
    // (`POST flow/confirm-payment`, `order-flow.controller.ts`) no pasa
    // `opts`, así que sigue recibiendo el evento normalmente.
    if (
      result.applied &&
      result.confirmedPaymentId != null &&
      opts?.source !== 'webhook'
    ) {
      try {
        const confirmedPayment = result.order.payments.find(
          (p: any) => p.id === result.confirmedPaymentId,
        );
        if (confirmedPayment) {
          const methodRow = await this.prisma.store_payment_methods.findFirst({
            where: { id: confirmedPayment.store_payment_method_id },
            select: {
              system_payment_method: { select: { display_name: true } },
            },
          });
          // PR #858 hallazgo 1 — este tramo sólo alimenta `payment.received`
          // (no hay respuesta con nombre visible): va la etiqueta CONTABLE
          // del sistema, nunca el nombre renombrable de la tienda.
          const accounting_method =
            methodRow?.system_payment_method?.display_name || 'Unknown';
          const sale_share = await resolvePaymentReceivedSaleFields(
            this.prisma,
            {
              order_id: orderId,
              payment_id: confirmedPayment.id,
              amount: Number(confirmedPayment.amount),
            },
          );
          await this.emitLegPaymentReceivedEvents(orderId, result.order, [
            {
              payment: { ...confirmedPayment, sale_share },
              leg: {
                amount: Number(confirmedPayment.amount),
                accounting_method,
              } as unknown as NormalizedLeg,
            },
          ]);
        }
      } catch (error) {
        // Mismo contrato que `emitLegPaymentReceivedEvents`: nunca convertir
        // un pago ya confirmado en un error HTTP.
        this.logger.error(
          `[confirmPayment payment.received failed] order=${orderId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Después del commit: el pago online quedó `succeeded`. Sólo si la
    // confirmación se aplicó — un no-op (orden ya confirmada o cancelada) no es
    // una venta nueva que facturar.
    if (result.applied) {
      await this.emitPosSaleCompletedIfFullyPaid(orderId, 'confirm_payment');
    }
    if (result.applied && result.previousState === 'pending_payment') {
      this.eventEmitter.emit('order.status_changed', {
        store_id: result.order.store_id, order_id: orderId,
        order_number: result.order.order_number,
        old_state: 'pending_payment', new_state: 'processing',
      });
    }
    // Pago en vivo guest (`/pedido/:token`): tras el commit, y sólo si se
    // aplicó — un no-op no cambió ningún pago y sería ruido. Va antes del
    // `throw projectionError`: el pago commiteó y el SSE no debe perderse
    // por un fallo de proyección de mesa.
    if (result.applied) {
      const payments = result.order.payments.map((payment) => ({
        payment_id: payment.id,
        state: payment.state,
        has_receipt: payment.receipt_s3_key != null,
      }));
      if (this.orderSse) {
        try {
          this.orderSse.pushOrderEvent(
            result.order.store_id,
            orderId,
            'order.payment_updated',
            { payments },
          );
          this.logger.debug(
            `[flow/confirmPayment payment_updated] order=${orderId} payments=${payments.length}`,
          );
        } catch (error) {
          // Post-commit: el pago ya commiteó; un fallo del bus SSE jamás
          // debe convertirse en 500. Warn, nunca throw (simétrico a la
          // rama else).
          this.logger.warn(
            `[flow/confirmPayment payment_updated] SSE falló; omitido order=${orderId} err=${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        // Sólo en specs con construcción manual; en prod siempre resuelve.
        // Warn, nunca throw: el pago ya commiteó y un 500 aquí mentiría.
        this.logger.warn(
          `[flow/confirmPayment payment_updated] OrderSseService sin resolver; SSE omitido order=${orderId}`,
        );
      }
    }
    if (projectionError) throw projectionError;
    // Explicit result for callbacks: a no-op on a cancelled order is NOT a
    // successful confirmation. Existing HTTP callers still receive an order.
    return { ...result.order, payment_confirmation_applied: result.applied };
  }

  /**
   * B4 (release-855) — the same "does this order have an electronic sales
   * invoice already on its way to/accepted by DIAN" question `orders.service
   * .ts:findActiveSalesInvoice` answers, duplicated here (not imported)
   * because `OrdersService` already depends on `OrderFlowService`
   * (`forceOrderState`) — importing it back would create a circular
   * provider dependency. `draft` is the only status that still allows a
   * local payment cancellation; anything transmitted (`validated`/`sent`/
   * `accepted`) or `rejected` (DIAN bounced it, but it was still submitted)
   * must go through a credit note instead.
   */
  private async findBlockingSalesInvoiceForPaymentCancel(
    orderId: number,
    client: Prisma.TransactionClient | StorePrismaService = this.prisma,
  ): Promise<{ id: number; status: string } | null> {
    const activeInvoice = await client.invoices.findFirst({
      where: {
        order_id: orderId,
        invoice_type: 'sales_invoice',
        status: { notIn: ['voided', 'cancelled'] },
      },
      select: { id: true, status: true },
      orderBy: { id: 'desc' },
    });
    return activeInvoice && activeInvoice.status !== 'draft' ? activeInvoice : null;
  }

  private async assertNoIssuedSalesInvoiceForPaymentCancel(
    orderId: number,
    client: Prisma.TransactionClient | StorePrismaService = this.prisma,
  ): Promise<void> {
    const blockingInvoice = await this.findBlockingSalesInvoiceForPaymentCancel(
      orderId,
      client,
    );
    if (blockingInvoice) {
      throw new VendixHttpException(
        ErrorCodes.ORD_PAYMENT_CANCEL_INVOICED_001,
        undefined,
        { order_id: orderId, invoice_id: blockingInvoice.id, invoice_status: blockingInvoice.status },
      );
    }
  }

  /**
   * Cancel payment of an order.
   * - `pending_payment`/`processing` -> `created`. Owner rule: «cancelar el
   *   pago» corrects a wrongly registered payment method so it can be
   *   re-registered; it is NOT blocked by committed/consumed stock (that
   *   blocker, `ORD_CANCEL_STOCK_COMMITTED_001`, belongs to cancelOrder
   *   only). Same guards as the fulfilled branch: direct-only settled legs
   *   and no issued sales invoice. Stock is untouched here, and re-paying
   *   never deducts twice: `payOrder` accepts `created` and funnels the
   *   finish through `commitOrderDelivery`, whose per-line atomic claim on
   *   `order_items.inventory_committed` skips lines already delivered
   *   (`deliverOrderItem`) or consumed at fire. `processing` cannot be kept
   *   as-is because the `payOrder` state claim does not admit it (that
   *   claim IS the double-click serializer), so `created` is the only
   *   re-chargeable target; `pending_payment` goes to `created` too since
   *   no payment is pending any more after the void.
   * - B4 (release-855) / B1b (order-truth-and-invoice-tz plan): `shipped`/
   *   `delivered` -> SAME state (never collapses `shipped` back to
   *   `created`, never collapses either back to `delivered` from `shipped`),
   *   ONLY when every settled payment is a direct method (cash/card/
   *   bank_transfer — never online/gateway) and there is no sales invoice
   *   already issued to DIAN. The order keeps its items/stock exactly as
   *   they are (goods already left); only money bookkeeping resets so
   *   `payOrder` can re-charge it. See
   *   `assertNoIssuedSalesInvoiceForPaymentCancel` and
   *   `hasNonDirectSettledPayment`.
   * - `finished` -> HARD REJECT (`ORD_PAYMENT_CANCEL_FINISHED_001`, B1b).
   *   Once an order is finalized a local payment void is no longer the
   *   right instrument; a refund is the only path back.
   * Privileged reverse transition — bypasses normal state machine.
   * Only admin/owner can perform this action.
   *
   * Accounting reversal: once the cancellation is persisted (after the
   * transaction commits, same as every other domain event this service
   * emits), this method fires `this.eventEmitter.emit('payment.voided', …)`
   * once per payment that was `succeeded` at cancel time — never for a
   * `pending` marker (a COD placeholder never posted an auto-entry, so
   * there is nothing to reverse). Payload contract (consumed by a dedicated
   * accounting listener, not owned by this file):
   * `{ store_id, organization_id, order_id, payment_id, amount,
   * payment_method, user_id, reason: 'payment_cancelled' }`. This method
   * only announces the reversal; it does not itself create the reversing
   * journal entry.
   */
  async cancelPayment(
    orderId: number,
    dto: CancelPaymentDto,
    cancelledBy: string,
  ) {
    const order = await this.getOrder(orderId);
    assertNoActiveFinancialSplit(order);

    // B1b — hard boundary: once finished, only a refund reverses money.
    if (order.state === 'finished') {
      throw new VendixHttpException(ErrorCodes.ORD_PAYMENT_CANCEL_FINISHED_001);
    }

    const isFulfilledCancel = FULFILLED_PAYMENT_CANCELABLE_STATES.has(
      order.state,
    );
    if (!['pending_payment', 'processing'].includes(order.state) && !isFulfilledCancel) {
      throw new BadRequestException(
        `Cannot cancel payment for order in state '${order.state}'. Order must be in 'pending_payment', 'processing', 'shipped' or 'delivered' state.`,
      );
    }

    // Cheap read-side guards before taking the lifecycle lock; re-checked
    // again inside the transaction against the freshly-locked row. Same
    // pair for every cancelable state (`canCancelPayment` mirrors it).
    if (hasNonDirectSettledPayment(order.payments)) {
      throw new VendixHttpException(
        ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001,
      );
    }
    await this.assertNoIssuedSalesInvoiceForPaymentCancel(orderId);

    let cancelledPaymentIds: number[] = [];
    // Captured inside the transaction (fresh `payments` + their resolved
    // `store_payment_method.system_payment_method.type`) and emitted AFTER
    // commit — only the legs that were actually `succeeded` carry an
    // accounting entry to reverse.
    let voidedSucceededPayments: Array<{
      id: number;
      amount: number;
      payment_method: string | null;
    }> = [];
    await this.prisma.$transaction(async (tx) => {
      await lockOrderLifecycle(tx, orderId, order.store_id);
      const freshOrder = await this.getOrder(orderId, tx);

      // Re-check under the lock: a concurrent request could have finished
      // the order between the read above and here.
      if (freshOrder.state === 'finished') {
        throw new VendixHttpException(ErrorCodes.ORD_PAYMENT_CANCEL_FINISHED_001);
      }

      const freshIsFulfilledCancel =
        FULFILLED_PAYMENT_CANCELABLE_STATES.has(freshOrder.state);
      if (
        !['pending_payment', 'processing'].includes(freshOrder.state) &&
        !freshIsFulfilledCancel
      ) {
        throw new BadRequestException('La orden cambió de estado; actualiza antes de anular el pago.');
      }

      // Re-run under the lock: a concurrent request could have changed the
      // payment mix or triggered invoicing between the read above and here.
      // No stock check: committed stock blocks cancelOrder, never the
      // payment cancel (owner rule, see docblock).
      if (hasNonDirectSettledPayment(freshOrder.payments)) {
        throw new VendixHttpException(
          ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001,
        );
      }
      await this.assertNoIssuedSalesInvoiceForPaymentCancel(orderId, tx);

      // (a) B4 — void EVERY succeeded/pending payment of the order, not just
      // the first match: with multi-tender (`payments[]`) a partial `.find`
      // left the other succeeded legs standing, which double-collects on
      // re-charge. `pending` also voids (e.g. a stale COD marker).
      const activePayments = freshOrder.payments.filter(
        (p) => p.state === 'succeeded' || p.state === 'pending',
      );
      if (activePayments.length === 0) {
        throw new BadRequestException('No active payment found for this order');
      }
      cancelledPaymentIds = activePayments.map((p) => p.id);
      voidedSucceededPayments = activePayments
        .filter((p) => p.state === 'succeeded')
        .map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          payment_method:
            p.store_payment_method?.system_payment_method?.type ?? null,
        }));
      for (const activePayment of activePayments) {
        await tx.payments.update({
          where: { id: activePayment.id },
          data: {
            state: 'cancelled',
            updated_at: new Date(),
            gateway_response: {
              ...(typeof activePayment.gateway_response === 'object' &&
              activePayment.gateway_response !== null
                ? (activePayment.gateway_response as Record<string, any>)
                : {}),
              cancelled_by: cancelledBy,
              cancelled_at: new Date().toISOString(),
              cancellation_reason: dto.reason || 'Payment cancelled by admin',
            },
          },
        });
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: freshOrder.store_id,
          organizationId: freshOrder.stores?.organization_id,
          type: 'payment_cancelled',
          paymentId: activePayment.id,
          amount: activePayment.amount.toString(),
        });
      }

      if (freshIsFulfilledCancel) {
        // B4/B1b — NOT `created`, and NOT collapsed to `delivered` either:
        // the goods already left (stock stays exactly as committed), so the
        // order stays in the SAME state it was in (`shipped` stays
        // `shipped`, `delivered` stays `delivered`) unpaid, and `payOrder`
        // re-charges it from there (see the widened claim above).
        await tx.orders.update({
          where: { id: orderId },
          data: {
            state: freshOrder.state,
            completed_at: null,
            total_paid: 0,
            remaining_balance: freshOrder.grand_total,
            updated_at: new Date(),
          },
        });
      } else {
        // Bypass state machine — revert order to 'created'. Every
        // succeeded/pending leg was just voided, so the money bookkeeping
        // resets too (same as the fulfilled branch): `registerCreditPayment`
        // and `applyDispatchCodPayment` add onto the stored `total_paid`, so
        // leaving the old value would double-count the next collection.
        await tx.orders.update({
          where: { id: orderId },
          data: {
            state: 'created',
            completed_at: null,
            total_paid: 0,
            remaining_balance: freshOrder.grand_total,
            updated_at: new Date(),
          },
        });
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: freshOrder.store_id,
          organizationId: freshOrder.stores?.organization_id,
          type: 'state_changed',
          fromState: freshOrder.state,
          toState: 'created',
        });
      }
    });

    // Accounting reversal — one `payment.voided` per payment that was
    // `succeeded` (never for a voided `pending` marker; see docblock
    // above). Emitted after commit, same pattern as `order.shipped` etc.
    const organizationIdForVoidEvent = order.stores?.organization_id ?? null;
    if (organizationIdForVoidEvent && voidedSucceededPayments.length > 0) {
      const cancelingUserId = RequestContextService.getUserId() ?? null;
      for (const voided of voidedSucceededPayments) {
        this.eventEmitter.emit('payment.voided', {
          store_id: order.store_id,
          organization_id: organizationIdForVoidEvent,
          order_id: orderId,
          payment_id: voided.id,
          amount: voided.amount,
          payment_method: voided.payment_method,
          user_id: cancelingUserId,
          reason: 'payment_cancelled',
        });
      }
    }

    // B4 — la anulación devuelve a caja lo que el cobro original registró
    // como venta: sin esto, "anular y volver a cobrar" en efectivo contaba la
    // venta dos veces en el cuadre de la sesión.
    await this.reversePaymentCashMovements(order.store_id, orderId, cancelledPaymentIds);

    // Return updated order with all includes
    const updatedOrder = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: true,
      },
    });

    this.logger.log(
      `Order #${orderId} payment cancelled by ${cancelledBy}: ${dto.reason || 'No reason provided'}`,
    );
    return updatedOrder;
  }

  /**
   * Paso 4 (unificación del cálculo de envío —
   * `vendix-shipping-distance-pricing`) — costo que dicta una tarifa para
   * ESTA orden en `shipOrder`, vía el mismo cálculo único que
   * `OrdersService.resolveExpectedRateCost` /
   * `PaymentsService.recalculatePosRateCost`
   * (`ShippingCalculatorService.quoteRateGross`): umbral de envío gratis,
   * costo por unidad/peso y precio por distancia sobre la dirección y las
   * líneas de la orden. `null` si no hay calculador, no hay dirección
   * resoluble o la tarifa no aparece entre las opciones calculadas (incluye
   * `carrier_calculated`) — el llamador cae entonces al atajo histórico
   * `chargeForRate(base_cost)` (paso 14).
   */
  private async resolveShipOrderRateCost(
    orderId: number,
    storeId: number,
    rateId: number,
  ): Promise<number | null> {
    if (!this.shippingCalculatorService) return null;

    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        store_id: true,
        stores: { select: { organization_id: true } },
        shipping_address_id: true,
        shipping_address_snapshot: true,
        order_items: {
          select: {
            product_id: true,
            quantity: true,
            total_price: true,
            weight: true,
            order_item_taxes: { select: { tax_amount: true } },
            products: { select: { weight: true, product_type: true } },
          },
        },
      },
    });
    if (!order) return null;

    let address: {
      country_code?: string | null;
      address_line1?: string | null;
      state_province?: string | null;
      city?: string | null;
      postal_code?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null = null;
    if (order.shipping_address_id) {
      address = await this.prisma.addresses.findFirst({
        where: { id: order.shipping_address_id },
        select: {
          country_code: true,
          address_line1: true,
          state_province: true,
          city: true,
          postal_code: true,
          latitude: true,
          longitude: true,
        },
      });
    } else if (order.shipping_address_snapshot) {
      address = order.shipping_address_snapshot as any;
    }
    if (!address?.country_code) return null;

    const items = (order.order_items ?? [])
      .filter((it: any) => typeof it?.product_id === 'number')
      .map((it: any) => {
        const line_tax = (it.order_item_taxes ?? []).reduce(
          (sum: number, t: any) => sum + Number(t.tax_amount || 0),
          0,
        );
        const quantity = Number(it.quantity || 0);
        return {
          product_id: it.product_id as number,
          quantity,
          // Bruto de la línea (base + impuesto), como el checkout.
          price: Number(it.total_price || 0) + line_tax,
          weight: it.weight
            ? Number(it.weight)
            : it.products?.weight
              ? Number(it.products.weight) * quantity
              : undefined,
          product_type: it.products?.product_type || undefined,
        };
      });

    try {
      return await this.shippingCalculatorService.quoteRateGross(
        storeId,
        rateId,
        items,
        {
          country_code: address.country_code,
          address_line1: address.address_line1 || undefined,
          state_province: address.state_province || undefined,
          city: address.city || undefined,
          postal_code: address.postal_code || undefined,
          latitude:
            address.latitude != null ? Number(address.latitude) : undefined,
          longitude:
            address.longitude != null ? Number(address.longitude) : undefined,
        },
      );
    } catch (error) {
      this.logger.warn(
        `shipOrder: no se pudo recalcular la tarifa de envío #${rateId}: ${(error as Error)?.message}`,
      );
      return null;
    }
  }

  /**
   * Ship an order (processing -> shipped)
   *
   * `force` (ver {@link forceOrderState}) saltea las TRES precondiciones de
   * este método — el estado `processing`, la exigencia de método de envío y la
   * arista de la máquina de estados — y NADA más. El motivo por el que existe
   * el "modo manual" de la UI es justamente la segunda: una orden de retiro en
   * tienda sin `shipping_method_id` no puede marcarse enviada por el camino
   * estricto. Todo lo posterior (timestamps, `order.shipped`, logging) corre
   * idéntico, porque es este mismo código.
   */
  async shipOrder(
    orderId: number,
    dto: ShipOrderDto,
    force = false,
    opts: { allowExemptDeliveryTypes?: boolean } = {},
  ) {
    const order = await this.getOrder(orderId);

    if (!force && order.state !== 'processing') {
      throw new BadRequestException(
        `Cannot ship order in state '${order.state}'. Order must be in 'processing' state.`,
      );
    }

    // `allowExemptDeliveryTypes` widens the direct_delivery-only exemption to
    // the full `SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES` set (pickup/
    // direct_delivery/dine_in). ONLY `fastTrackOrder` passes it — every other
    // caller (manual ship endpoint, the auto-ship `force` path) keeps today's
    // direct_delivery-only behavior unchanged.
    const exemptFromShippingMethod =
      order.delivery_type === 'direct_delivery' ||
      !!(
        opts.allowExemptDeliveryTypes &&
        order.delivery_type &&
        SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES.has(order.delivery_type)
      );
    if (
      !force &&
      !exemptFromShippingMethod &&
      !order.shipping_method_id &&
      !dto.shipping_method_id
    ) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_001);
    }

    await this.assertKitchenReadyForWholeOrder(
      orderId,
      storeIsRestaurant((order as any).stores?.industries),
    );

    if (!order.shipping_method_id && dto.shipping_method_id) {
      const method = await this.prisma.shipping_methods.findFirst({
        where: { id: dto.shipping_method_id, is_active: true },
      });
      if (!method) {
        throw new VendixHttpException(ErrorCodes.ORD_SHIP_INVALID_METHOD_001);
      }

      const deliveryType = deriveDeliveryType(method.type);
      let shippingCost = 0;

      if (dto.shipping_rate_id) {
        const rate = await this.prisma.shipping_rates.findFirst({
          where: { id: dto.shipping_rate_id, is_active: true },
        });
        if (!rate || rate.shipping_method_id !== method.id) {
          throw new VendixHttpException(ErrorCodes.ORD_SHIP_RATE_MISMATCH_001);
        }
        // Paso 4 (unificación de envío) — se cotiza primero con el mismo
        // cálculo único que orders/payments (umbral de envío gratis, costo
        // por unidad/peso y distancia). `free` sigue cobrando 0 sin rutear
        // (regla de `vendix-shipping-distance-pricing`). Solo si eso no
        // resuelve nada (sin calculador, sin dirección resoluble en la
        // orden, o tarifa fuera de las opciones calculadas) cae al atajo
        // histórico (paso 14): BRUTO agregado vía `chargeForRate(base_cost)`,
        // o `base_cost` sin `chargeForRate` (dobles viejos de specs).
        if (rate.type === 'free') {
          shippingCost = 0;
        } else {
          const quoted = await this.resolveShipOrderRateCost(
            orderId,
            order.store_id,
            rate.id,
          );
          if (quoted != null) {
            shippingCost = quoted;
          } else {
            shippingCost = Number(rate.base_cost);
            if (
              this.shippingTaxService &&
              typeof this.shippingTaxService.chargeForRate === 'function'
            ) {
              shippingCost = (
                await this.shippingTaxService.chargeForRate(null, rate.id, shippingCost, {
                  store_id: order.store_id,
                })
              ).gross;
            }
          }
        }
      }

      // Orden ya cobrada (o con un cobro en curso): su `grand_total` y su
      // `shipping_cost` son los que el cliente pagó. Asignar el método NO
      // puede moverlos ni cambiar la copia fiscal. Si la tarifa elegida trae
      // otro costo ⇒ 400 explícito; si coincide ⇒ se liga método/tarifa y se
      // conservan costo y copia existentes.
      const chargedPayment = (order.payments ?? []).some(
        (p: { state?: string | null }) =>
          !!p?.state && p.state !== 'failed' && p.state !== 'cancelled',
      );
      // La señal es SOLO el arreglo `payments`: `orders` no tiene columna
      // `payment_status`.
      const orderIsCharged = chargedPayment;

      if (orderIsCharged) {
        const chargedShippingCents = Math.round(
          Number(order.shipping_cost ?? 0) * 100,
        );
        if (Math.round(shippingCost * 100) !== chargedShippingCents) {
          throw new VendixHttpException(
            ErrorCodes.ORD_SHIP_RATE_MISMATCH_001,
            'La orden ya tiene un cobro: el costo de la tarifa elegida no coincide con el envío cobrado',
            {
              order_id: orderId,
              charged_shipping_cost: chargedShippingCents / 100,
              rate_shipping_cost: shippingCost,
            },
          );
        }
        await this.prisma.orders.update({
          where: { id: orderId },
          data: {
            shipping_method_id: method.id,
            shipping_rate_id: dto.shipping_rate_id ?? null,
            delivery_type: deliveryType,
            updated_at: new Date(),
          },
        });
      } else {
        // Impuesto del envío: copia congelada de la tarifa (bruto, incluido
        // o agregado). Sin tarifa ⇒ copia vacía. El `grand_total` se
        // recalcula cambiando el costo anterior por el nuevo: el impuesto va
        // DENTRO del costo, así que no se suma aparte (orders.tax_amount no
        // lo incluye).
        const shippingTax: ShippingTaxSnapshot =
          dto.shipping_rate_id && this.shippingTaxService
            ? await this.shippingTaxService.snapshotForRate(
                null,
                dto.shipping_rate_id,
                shippingCost,
                { store_id: order.store_id },
              )
            : { ...EMPTY_SHIPPING_TAX };
        // Paso 14 — el modo viaja con la copia (modo de la tarifa cuando hay
        // impuesto, null si no). Se evalúa sobre el costo cobrado: el modo
        // vive en la fila de la tarifa, así que el precio no lo mueve.
        let shipTaxIsInclusive: boolean | null = null;
        if (shippingTax.shipping_tax_amount > 0 && dto.shipping_rate_id) {
          const mode_charge =
            this.shippingTaxService &&
            typeof this.shippingTaxService.chargeForRate === 'function'
              ? await this.shippingTaxService.chargeForRate(
                  null,
                  dto.shipping_rate_id,
                  shippingCost,
                  { store_id: order.store_id },
                )
              : null;
          shipTaxIsInclusive =
            mode_charge && mode_charge.applies
              ? mode_charge.reason === 'inclusive'
              : null;
        }
        const previousShippingCents = Math.round(
          Number(order.shipping_cost ?? 0) * 100,
        );
        const grandTotalCents =
          Math.round(Number(order.grand_total ?? 0) * 100) -
          previousShippingCents +
          Math.round(shippingCost * 100);

        await this.prisma.orders.update({
          where: { id: orderId },
          data: {
            shipping_method_id: method.id,
            shipping_rate_id: dto.shipping_rate_id ?? null,
            delivery_type: deliveryType,
            shipping_cost: shippingCost,
            ...shippingTax,
            shipping_tax_is_inclusive: shipTaxIsInclusive,
            grand_total: new Prisma.Decimal(grandTotalCents).div(100),
            updated_at: new Date(),
          },
        });
      }
    }

    if (!force) {
      this.validateTransition(order.state as OrderState, 'shipped');
    }
    const updatedOrder = await this.updateOrderState(orderId, 'shipped', {
      shipped_at: new Date(),
      tracking_number: dto.tracking_number,
      carrier: dto.carrier,
      shipping_notes: dto.notes,
    });

    // P3.4: dedicated `order.shipped` event picked up by the
    // OrderAutoFulfillmentListener. For ORG-scope orders it auto-creates
    // and dispatches a transfer (central → fulfilling store) and consumes
    // the original reservation. For STORE-scope orders the listener no-ops.
    const orderForEvent = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        store_id: true,
        stores: { select: { organization_id: true } },
      },
    });
    if (orderForEvent?.stores?.organization_id) {
      this.eventEmitter.emit('order.shipped', {
        order_id: orderId,
        store_id: orderForEvent.store_id,
        organization_id: orderForEvent.stores.organization_id,
        user_id: RequestContextService.getUserId() ?? null,
      });
    }

    this.logger.log(`Order #${orderId} shipped`);
    return updatedOrder;
  }

  async getAvailableActions(orderId: number) {
    const order = await this.getOrder(orderId);

    const actions: Array<{
      code: string;
      label_key: string;
      enabled: boolean;
      reason?: string;
    }> = [];

    const state = order.state as OrderState;
    const deliveryType = order.delivery_type;
    const hasMethod = !!order.shipping_method_id;
    const isDirectDelivery = deliveryType === 'direct_delivery';
    const isPickupDelivery = (deliveryType || 'direct_delivery') === 'pickup';
    const requiresDispatch = deliveryType === 'home_delivery';
    // B1b (order-truth-and-invoice-tz plan) — an active financial split
    // locks every economic mutation (pay/credit_payment/edit_order) until
    // the split itself is cancelled; mirrors `assertNoActiveFinancialSplit`,
    // which every one of these endpoints already calls. `getAvailableActions`
    // never checked this before, so a split order could show `pay: true`
    // and then 409 at the endpoint — parity fix.
    const activeFinancialSplit = !!order.active_financial_split_id;

    // B1b — one extra small, order-scoped, indexed read for refund-aware
    // `isOrderFullyPaid` (`canPay`), plus a single `order_items` +
    // `kitchen_ticket_items` read that supplies BOTH the web's
    // `isKitchenOrder` signal (dispatch/`fast_track` predicates) and
    // `confirm_delivery`'s F2 pending-kitchen gate — replacing what would
    // otherwise be two separate queries. Cheap: this is a detail-page read
    // path, not a hot loop.
    const [refunds, itemsWithKitchen] = await Promise.all([
      this.prisma.refunds.findMany({
        where: { order_id: orderId },
        select: { state: true, amount: true },
      }),
      this.prisma.order_items.findMany({
        where: { order_id: orderId },
        select: {
          cancelled_at: true,
          skip_kds: true,
          products: { select: { product_type: true } },
          kitchen_ticket_items: { select: { status: true }, orderBy: { id: 'desc' }, take: 1 },
        },
      }),
    ]);
    const isKitchenOrder = itemsWithKitchen.some((item) => item.kitchen_ticket_items.length > 0);
    // H3 fix: the same restaurant gate `assertKitchenReadyForWholeOrder`
    // enforces on write must back this READ-ONLY hint — otherwise a
    // non-restaurant store's legacy prepared/skip_kds:false line would
    // advertise `dispatch_order`/`ready_for_pickup`/`ship_with_tracking` as
    // `enabled: true` here while the endpoint kept rejecting it (parity gap
    // the file header explicitly forbids).
    const hasPendingKitchen = hasKitchenLinesAwaitingHandoff(itemsWithKitchen, {
      isRestaurant: storeIsRestaurant((order as any).stores?.industries),
    });
    const offersDispatchFlow = requiresDispatch || isKitchenOrder;

    const snapshot: OrderActionSnapshot & {
      delivery_type?: string | null;
      shipping_method_id?: number | null;
      payment_form?: string | null;
      isKitchenOrder?: boolean;
      hasOrderItems?: boolean;
      remaining_balance?: Prisma.Decimal | number | string | null;
    } = {
      ...order,
      refunds,
      hasPendingKitchen,
      isKitchenOrder,
      hasOrderItems: (order.order_items ?? []).length > 0,
    };
    const roleCtx = { roles: RequestContextService.getRoles() };

    // `draft` (POS counter orders before confirmation) behaves exactly like
    // `created` — mirrors the web's `case 'draft': case 'created':` fall-through.
    if (state === 'draft' || state === 'created') {
      actions.push({
        code: 'edit_order',
        label_key: 'ORD_ACTION_EDIT_ORDER',
        ...canEditOrder(snapshot, roleCtx),
      });
      actions.push({ code: 'pay', label_key: 'ORD_ACTION_PAY', ...canPay(snapshot) });
      if (!hasMethod && !isDirectDelivery) {
        actions.push({
          code: 'assign_shipping',
          label_key: 'ORD_ACTION_ASSIGN_SHIPPING',
          ...canAssignShipping(snapshot),
        });
      }
      actions.push({ code: 'cancel', label_key: 'ORD_ACTION_CANCEL', ...canCancel(snapshot) });
    }

    if (state === 'pending_payment') {
      const isCreditOrder = order.payment_form === '2';
      if (isCreditOrder) {
        actions.push({
          code: 'credit_payment',
          label_key: 'ORD_ACTION_CREDIT_PAYMENT',
          ...canCreditPayment(snapshot),
        });
      } else if (requiresPaymentRegistration(snapshot)) {
        // Fase 2 paso 6 — pago manual pendiente o saldo parcial: el personal
        // REGISTRA por `flow/pay`, no confirma con un clic.
        actions.push({ code: 'pay', label_key: 'ORD_ACTION_PAY', ...canPay(snapshot) });
      } else {
        actions.push({
          code: 'confirm_payment',
          label_key: 'ORD_ACTION_CONFIRM_PAYMENT',
          enabled: true,
        });
      }

      // `cancel_payment` here has always delegated to
      // `getOrderCancellationPolicy` (unchanged) — the only change is the
      // role gate `canCancelPaymentAsRole` now applies, matching the
      // `@Roles('owner','admin')` guard the `/cancel-payment` endpoint has
      // always enforced regardless of order state (STATE gap #2).
      actions.push({
        code: 'cancel_payment',
        label_key: 'ORD_ACTION_CANCEL_PAYMENT',
        ...canCancelPaymentAsRole(snapshot, roleCtx),
      });

      if (!hasMethod && !isDirectDelivery) {
        actions.push({
          code: 'assign_shipping',
          label_key: 'ORD_ACTION_ASSIGN_SHIPPING',
          ...canAssignShipping(snapshot),
        });
      }
      actions.push({ code: 'cancel', label_key: 'ORD_ACTION_CANCEL', ...canCancel(snapshot) });

      // Dispatch-before-payment trio (web: `dispatch-order` / `manual-ship` /
      // `manual-ready-pickup`, mutually exclusive by `delivery_type` — see
      // `order-action-policy.util.ts`'s dispatch-flow section). Only surfaced
      // at all when the order could plausibly offer one of the three — a
      // plain non-kitchen `direct_delivery`/mesa order shows none of them,
      // exactly like the web.
      if (requiresDispatch) {
        actions.push({
          code: 'dispatch_order',
          label_key: 'ORD_ACTION_DISPATCH_ORDER',
          ...canDispatchOrder(snapshot),
        });
      } else if (isPickupDelivery) {
        actions.push({
          code: 'ready_for_pickup',
          label_key: 'ORD_ACTION_READY_FOR_PICKUP',
          ...canReadyForPickupBeforePayment(snapshot),
        });
      } else if (offersDispatchFlow) {
        actions.push({
          code: 'manual_ship',
          label_key: 'ORD_ACTION_MANUAL_SHIP',
          ...canManualShip(snapshot),
        });
      }
    }

    if (state === 'processing') {
      if (!offersDispatchFlow && !hasMethod && !isDirectDelivery) {
        actions.push({
          code: 'assign_shipping',
          label_key: 'ORD_ACTION_ASSIGN_SHIPPING',
          ...canAssignShipping(snapshot),
        });
        actions.push({
          code: 'ready_for_pickup',
          label_key: 'ORD_ACTION_READY_FOR_PICKUP',
          enabled: false,
          reason: 'ORD_SHIP_REQUIRED_001',
        });
        actions.push({
          code: 'ship_with_tracking',
          label_key: 'ORD_ACTION_SHIP_WITH_TRACKING',
          enabled: false,
          reason: 'ORD_SHIP_REQUIRED_001',
        });
      } else if (!offersDispatchFlow && hasMethod) {
        const method = await this.prisma.shipping_methods.findFirst({
          where: { id: order.shipping_method_id },
          select: { type: true },
        });

        const methodType = method?.type;

        if (methodType === 'pickup') {
          actions.push({
            code: 'ready_for_pickup',
            label_key: 'ORD_ACTION_READY_FOR_PICKUP',
            enabled: !hasPendingKitchen,
            ...(hasPendingKitchen ? { reason: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code } : {}),
          });
        } else {
          actions.push({
            code: 'ship_with_tracking',
            label_key: 'ORD_ACTION_SHIP_WITH_TRACKING',
            enabled: !hasPendingKitchen,
            ...(hasPendingKitchen ? { reason: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code } : {}),
          });
        }
      }

      // NOTE (order-truth-and-invoice-tz plan, Step 1): `mark_delivered` was
      // dropped from here — `deliverOrder` strictly requires `shipped`
      // (unless `force`), so a `processing` order can never actually accept
      // this action; the web never showed it either. Advertising it here
      // was a phantom action the endpoint would always reject.

      // B1b — additive dispatch pair (web: `dispatch-order` +, for a pickup
      // order in that same branch, `direct-deliver`). Independent of the
      // pre-existing `ready_for_pickup`/`ship_with_tracking` block above,
      // which is left untouched (different signal: the ASSIGNED method's
      // own `type`, not the kitchen/home-delivery fulfillment axis).
      if (offersDispatchFlow) {
        if (requiresDispatch) {
          actions.push({
            code: 'dispatch_order',
            label_key: 'ORD_ACTION_DISPATCH_ORDER',
            ...canDispatchOrder(snapshot),
          });
        }
        if (isPickupDelivery) {
          actions.push({
            code: 'direct_deliver',
            label_key: 'ORD_ACTION_DIRECT_DELIVER',
            ...canDirectDeliver(snapshot),
          });
        }
      } else {
        // Restores the web's removed `ship` button ("Pasar a Cobro", commit
        // cbebc40db8f) — see `canCollectViaShip`'s doc comment. Presence
        // mirrors the same `!offersDispatchFlow` gate the dispatch trio
        // above uses (same applicability semantics: only pushed when this
        // order has no dispatch/fulfillment flow at all).
        actions.push({
          code: 'collect_payment',
          label_key: 'ORD_ACTION_COLLECT_PAYMENT',
          ...canCollectViaShip(snapshot),
        });
      }

      // `confirm_delivery` also serves the web's `finish` button for a
      // kitchen order consumed in-store (mesa/mostrador/para-llevar) or a
      // paid order with no fulfillment left to dispatch — `canConfirmDelivery`
      // (F2-guard-aware) is the authority; a `home_delivery` order always
      // finishes through the dispatch flow instead, so it is skipped here
      // when dispatch applies, mirroring the web's mutual exclusion.
      if (!requiresDispatch) {
        actions.push({
          code: 'confirm_delivery',
          label_key: 'ORD_ACTION_CONFIRM_DELIVERY',
          ...canConfirmDelivery(snapshot),
        });
      }

      // Parity fix (order-actions-parity spec): the web has ALWAYS shown
      // `cancel-payment` in `processing` (gated only by `isPrivilegedUser()`)
      // and objective 12 explicitly lists `processing` among the
      // `cancel_payment`-eligible states — `canCancelPayment` already
      // delegates to `getOrderCancellationPolicy` for this state (unchanged
      // policy), this method just never pushed the row.
      actions.push({
        code: 'cancel_payment',
        label_key: 'ORD_ACTION_CANCEL_PAYMENT',
        ...canCancelPaymentAsRole(snapshot, roleCtx),
      });

      actions.push({
        code: 'cancel',
        label_key: 'ORD_ACTION_CANCEL',
        ...canCancel(snapshot),
      });
    }

    if (state === 'shipped') {
      actions.push({
        code: 'mark_delivered',
        label_key: 'ORD_ACTION_MARK_DELIVERED',
        enabled: true,
      });
    }

    if (state === 'delivered') {
      actions.push({
        code: 'confirm_delivery',
        label_key: 'ORD_ACTION_CONFIRM_DELIVERY',
        ...canConfirmDelivery(snapshot),
      });
    }

    if (state === 'cancelled') {
      // `reactivate` now requires owner/admin (same `RolesGuard` +
      // `@Roles` as `cancel_payment`) — see `canReactivateAsRole`.
      actions.push({
        code: 'reactivate',
        label_key: 'ORD_ACTION_REACTIVATE',
        ...canReactivateAsRole(snapshot, roleCtx),
      });
    }

    // B1b — `refund` is valid on `delivered` AND `finished` (mirrors
    // `refund-flow.service.ts`'s `REFUNDABLE_STATES` and the web's own
    // `hasRefundableBalance`, which already treat them identically). Only
    // advertising it for `delivered` was a parity gap: a `finished` order
    // could be refunded at the endpoint but the action never appeared here.
    if (state === 'delivered' || state === 'finished') {
      actions.push({ code: 'refund', label_key: 'ORD_ACTION_REFUND', ...canRefund(snapshot) });
    }

    // B4 (release-855) / B1b (order-truth-and-invoice-tz plan) — `shipped`,
    // `delivered` and `finished` no longer imply "already paid" (a COD order
    // lands on `shipped`/`delivered` unpaid — see the widened claim in
    // `payOrder`) nor "cannot touch payment again". Money and fulfillment
    // are independent axes in these states, so `pay`/`cancel_payment` are
    // surfaced here on their own merits — see `FULFILLED_PAYMENT_CANCELABLE_STATES`.
    // `finished` is `pay`-eligible but NEVER `cancel_payment`-eligible: B1b
    // makes that a hard reject (`ORD_PAYMENT_CANCEL_FINISHED_001`) — a
    // refund is the only way to reverse money once an order is finalized.
    const isPayEligibleFulfilledState =
      state === 'shipped' || state === 'delivered' || state === 'finished';
    if (isPayEligibleFulfilledState) {
      const hasSettledPayment = (order.payments ?? []).some((p) =>
        SETTLED_PAYMENT_STATES.has(p.state),
      );
      // Guardia de crédito (mismo contrato que el precheck de `payOrder` —
      // NO se toca ese método; ver restricción del coordinador): una venta a
      // crédito no ofrece `pay` (cobro de contado) en estos tres estados —
      // el abono va por `credit_payment` / `registerCreditPayment`. Solo
      // sobre-escribe cuando `canPay` ya habría dicho `true`, preservando la
      // prioridad de motivo previa (ya-pagado/split ganan sobre crédito,
      // igual que el código anterior).
      const isCreditOrder = order.payment_form === '2';
      const payResult = canPay(snapshot);
      actions.push({
        code: 'pay',
        label_key: 'ORD_ACTION_PAY',
        ...(payResult.enabled && isCreditOrder
          ? { enabled: false, reason: ErrorCodes.ORD_PAY_CREDIT_ORDER_001.code }
          : payResult),
      });

      if (isCreditOrder && state === 'finished') {
        // Web only offers `credit-payment` for `finished` among these three
        // states (`shipped`/`delivered` credit orders fall through to the
        // disabled `pay` row above, same as the web's `!hasPaid` branch).
        actions.push({
          code: 'credit_payment',
          label_key: 'ORD_ACTION_CREDIT_PAYMENT',
          ...canCreditPayment(snapshot),
        });
      }

      // B4 row-presence rule preserved 1:1: `cancel_payment` is only
      // advertised at all once there is something settled to cancel.
      if (hasSettledPayment) {
        const hasIssuedSalesInvoice =
          state !== 'finished' &&
          (FULFILLED_PAYMENT_CANCELABLE_STATES.has(state) ||
            PAYMENT_CANCELABLE_STATES.has(state)) &&
          !hasNonDirectSettledPayment(order.payments)
            ? !!(await this.findBlockingSalesInvoiceForPaymentCancel(orderId))
            : undefined;
        actions.push({
          code: 'cancel_payment',
          label_key: 'ORD_ACTION_CANCEL_PAYMENT',
          ...canCancelPaymentAsRole({ ...snapshot, hasIssuedSalesInvoice }, roleCtx),
        });
      }
    }

    // fast_track — independent of the state switch above (mirrors the web's
    // standalone `canFastTrack()` checkbox, not part of its `availableActions`
    // array either).
    actions.push({
      code: 'fast_track',
      label_key: 'ORD_ACTION_FAST_TRACK',
      ...canFastTrack(snapshot),
    });

    // NOTE: `cancel` and `cancel_payment` above are already fully computed by
    // `canCancel`/`canCancelPaymentAsRole` (which delegate to
    // `getOrderCancellationPolicy` for the states that need it) — no further
    // post-processing pass is applied here. An earlier version of this
    // method re-ran the generic policy over the finished list as a final
    // step; that would have clobbered `cancel_payment`'s new role gate for
    // `pending_payment`/`processing` right back to the plain policy result.
    return actions;
  }

  /**
   * Deliver an order (shipped -> delivered)
   *
   * `force` (ver {@link forceOrderState}) saltea la precondición de estado
   * `shipped` y la arista de la máquina de estados. La escritura sigue pasando
   * por {@link updateOrderState}, que es lo que garantiza el timestamp, el
   * evento `order.status_changed` y la guarda de cocina.
   */
  async deliverOrder(orderId: number, dto: DeliverOrderDto, force = false) {
    const order = await this.getOrder(orderId);

    if (!force && order.state !== 'shipped') {
      throw new BadRequestException(
        `Cannot deliver order in state '${order.state}'. Order must be in 'shipped' state.`,
      );
    }

    await this.assertKitchenReadyForWholeOrder(
      orderId,
      storeIsRestaurant((order as any).stores?.industries),
    );

    if (!force) {
      this.validateTransition(order.state as OrderState, 'delivered');
    }
    const updatedOrder = await this.updateOrderState(orderId, 'delivered', {
      delivered_at: new Date(),
      delivery_notes: dto.delivery_notes,
      delivered_to: dto.delivered_to,
    });

    this.logger.log(`Order #${orderId} delivered`);
    return updatedOrder;
  }

  /**
   * Restaurant lifecycle bridge (KDS → order): when every kitchen ticket of a
   * paid restaurant order has been delivered, the order moves
   * `processing -> delivered`. Invoked by the orders listener that consumes
   * the `kitchen.order_all_delivered` event (already running inside the store
   * tenant context via StoreContextRunner).
   *
   * Idempotent and tolerant: it is a no-op when the order is not in
   * `processing` (e.g. it was already finished by the operator or auto-finish),
   * so duplicate / late events never throw.
   *
   * EXCEPCION DOMICILIO (`home_delivery`): entregar los platos NO es entregar
   * la orden. En un pedido a domicilio la cocina entrega al domiciliario, y la
   * entrega real al cliente la estampa el flujo de despacho (remision / ruta /
   * app de entrega). Si el puente moviera la orden a `delivered`, el detalle
   * perderia el boton "Despachar Orden" (solo quedan Finalizar/Reembolso en
   * `delivered`) y la remision ya no se podria generar (`createFromOrder`
   * exige `processing` o `pending_payment`). Por eso la orden a domicilio se
   * queda en `processing` con la cocina terminada, lista para despachar.
   */
  async markKitchenOrderDelivered(
    orderId: number,
  ): Promise<KitchenBridgeResult> {
    const order = await this.getOrder(orderId);
    const previousState = order.state as order_state_enum;

    if (previousState !== 'processing') {
      this.logger.debug(
        `Order #${orderId} not in 'processing' (is '${order.state}') — skipping KDS delivered bridge`,
      );
      return { order, transitioned: false, previousState };
    }

    // Ver la nota "EXCEPCION DOMICILIO" del docblock: la orden a domicilio se
    // entrega por el flujo de despacho, no por la cocina.
    if (order.delivery_type === 'home_delivery') {
      this.logger.debug(
        `Order #${orderId} is home_delivery — kitchen handoff done, order stays in 'processing' for dispatch`,
      );
      return { order, transitioned: false, previousState };
    }

    this.validateTransition(previousState as OrderState, 'delivered');
    // T9 — paso 3: este `order.status_changed` viene del puente de cocina
    // (todos los tickets terminales y al menos uno entregado). El listener
    // de notificaciones silencia `source === 'kitchen_bridge'` porque
    // entregado NO es una alerta — el LISTO ya sonó vía
    // `kitchen.ticket_ready`. Pasar source aquí preserva el resto de
    // transiciones de estado notificando igual que antes.
    const updatedOrder = await this.updateOrderState(
      orderId,
      'delivered',
      {
        delivered_at: new Date(),
        kitchen_all_delivered: true,
      },
      { source: 'kitchen_bridge' },
    );

    this.logger.log(
      `Order #${orderId} moved to 'delivered' (all kitchen tickets delivered)`,
    );
    return { order: updatedOrder, transitioned: true, previousState };
  }

  /**
   * Restaurant lifecycle bridge (KDS reversa → order): contrapartida de
   * {@link markKitchenOrderDelivered}. Cuando un ticket terminal se revierte
   * "un paso atrás" desde el KDS (delivered/cancelled → ready), la orden que
   * ya había sido movida a `delivered` por el puente de entrega debe volver a
   * `processing` para reabrir el flujo de cocina. Invocado por el listener que
   * consume `kitchen.order_delivery_reverted` (ya corriendo dentro del contexto
   * de tienda vía StoreContextRunner).
   *
   * Idempotente y tolerante: si la orden no existe, o su estado NO es
   * `delivered` (p.ej. ya fue finalizada, reembolsada, o nunca llegó a
   * delivered porque tenía otros tickets aún abiertos), es un no-op. Así, una
   * reversa que no corresponde a un retroceso real de la orden nunca lanza ni
   * fuerza una transición inválida. La arista delivered -> processing está
   * habilitada en VALID_TRANSITIONS exclusivamente para este puente.
   */

  /**
   * T9 / QUI-652 — Entrega de UN item a nivel de ORDEN.
   *
   * Seam canónico para estampar `delivered_at` + `delivered_by_user_id` en
   * una fila de `order_items`. Reemplaza la copia que vivía en
   * `TableSessionsService.markItemDelivered`, que solo servía cuando el item
   * vivía dentro de una cuenta de mesa. Una orden de POS, take-away o
   * domicilio no tiene `table_session_id` y antes no podía marcarse
   * entregada: este seam cubre ese hueco sin obligar al frontend a saltar
   * por la cuenta de mesa.
   *
   * Reglas (las tres son NO negociables; copiadas verbatim del método de
   * mesa):
   *
   *   1. IDEMPOTENCIA — si el item ya tiene `delivered_at`, se devuelve la
   *      vista de la orden tal cual. La primera entrega es la que ocurrió:
   *      un re-delivery NUNCA mueve la fecha hacia adelante.
   *   2. COMPUERTA DE COCINA — solo si `item_type === 'prepared'` se exige
   *      que `kitchen_ticket_items[0].status` sea `ready` (ordenadas desc
   *      por id, la primera fila es el estado vigente). Cualquier otro
   *      `item_type` (`physical`, combo sin preparar, etc.) se entrega
   *      directo: nunca pasa por cocina, no hay estado que esperar.
   *   3. MENSAJE DE ERROR — el code nuevo (`ORDER_ITEM_NOT_DELIVERABLE`,
   *      scope orden) lleva en su mensaje el nombre del plato y el estado
   *      actual de cocina. Sin nombre y sin estado, el mesero no sabe qué
   *      pasó.
   *
   * Scope multi-tenant: `StorePrismaService` filtra por la tienda del
   * contexto. La verificación de pertenencia se hace con un `updateMany`
   * cuya `where` exige `id: orderItemId AND order_id: orderId`: si el item
   * existe pero es de otra orden, el `updateMany` no toca filas y la
   * respuesta es 404 sin filtrar nada del otro tenant.
   *
   * Paso 2 sync cocina↔orden: DESPUÉS del stamp (incluido el caso
   * idempotente) propaga orden→cocina vía `syncKitchenOnOrderItemDelivered`
   * (última fila ready → delivered, cierre de ticket, puente
   * `kitchen.order_all_delivered`). Best-effort: nunca revierte el stamp.
   *
   * Devuelve la vista básica de la orden (misma forma que `getOrder`,
   * `shipOrder`, `markKitchenOrderDelivered`) para que el frontend
   * reemplace su estado sin una segunda llamada al detalle.
   */
  async deliverOrderItem(orderId: number, orderItemId: number) {
    // 1. Orden debe existir en la tienda del contexto. `getOrder` lanza 404
    //    si no la encuentra o no pertenece al scope.
    const order = await this.getOrder(orderId);

    const item = await this.prisma.order_items.findFirst({
      where: { id: orderItemId, order_id: orderId },
      select: {
        id: true,
        order_id: true,
        product_name: true,
        item_type: true,
        skip_kds: true,
        products: { select: { product_type: true } },
        delivered_at: true,
        kitchen_ticket_items: {
          orderBy: { id: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(
        `Order item #${orderItemId} not found on order #${orderId}`,
      );
    }

    // 1b. B1b (order-truth-and-invoice-tz plan) — a `cancelled`/`refunded`
    // order can never accept a delivery stamp: the money/inventory behind
    // the line was already voided, so marking it "delivered" after the fact
    // would misrepresent what happened. `item_type: null` restricts this
    // call to ONLY the order-state axis of `canDeliverItem` (the shared
    // predicate — see `order-action-policy.util.ts` — also backs
    // `getItemActions`); the kitchen-readiness message below still owns its
    // own wording.
    const orderStateGate = canDeliverItem({
      order_state: order.state,
      delivered_at: null,
      item_type: null,
    });
    if (!orderStateGate.enabled) {
      throw new VendixHttpException(
        ErrorCodes.ORDER_ITEM_NOT_DELIVERABLE,
        `No se puede marcar como entregado un ítem de una orden en estado '${order.state}'.`,
      );
    }

    // 2. Idempotencia del stamp: la primera entrega es la que ocurrió. El
    //    caso idempotente NO retorna antes de sincronizar — `delivered_at`
    //    se usa como punto de sincronización (reconcilia cocina abajo).
    const alreadyDelivered = item.delivered_at != null;
    // docs/plans/no-overselling-stock-guard-plan.md step 9 — collected only
    // when the store's "Permitir sobreventa" switch is ON; additive to the
    // response, never present (nor an empty array) otherwise.
    const stockWarnings: InsufficientStockItem[] = [];

    if (!alreadyDelivered) {
      // 3. The same item policy used by order detail gates the write. Do not
      // check item_type alone: prepared products persist as `physical` items.
      const kitchenStatus = item.kitchen_ticket_items[0]?.status ?? null;
      const kitchenGate = canDeliverItem({
        order_state: order.state,
        item_type: item.item_type,
        product_type: item.products?.product_type,
        skip_kds: item.skip_kds,
        latestKitchenStatus: kitchenStatus,
        delivered_at: null,
        // H3 fix: a never-fired prepared line only requires the kitchen
        // hand-off when the store is CURRENTLY a restaurant (see
        // `canDeliverItem`/`kitchenHandoffBlocker`). A line with an actual
        // ticket keeps requiring `ready` either way.
        isRestaurant: storeIsRestaurant((order as any).stores?.industries),
      });
      if (!kitchenGate.enabled) {
        throw new VendixHttpException(
          ErrorCodes.ORDER_ITEM_NOT_DELIVERABLE,
          `El plato "${item.product_name}" todavía no está listo (estado: ${kitchenStatus ?? 'sin enviar'}). Espera a que cocina lo marque como listo en el KDS antes de entregarlo.`,
        );
      }

      // 4. docs/plans/no-overselling-stock-guard-plan.md step 5 — consume
      //    THIS item's stock atomically with the delivery stamp.
      //    `commitOrderLines` runs FIRST inside the same tx; its own skip
      //    rules (untracked / service / already consumed at fire / already
      //    committed / restaurant prepared-pending-fire) decide whether
      //    there is anything to deduct. A shortfall throws INV_STOCK_002 and
      //    rolls back the stamp — `delivered_at` stays null. La `where` con
      //    `order_id: orderId` es la barrera de scope: si alguien intenta
      //    entregar el item de otra orden, el updateMany no toca filas.
      const now = new Date();
      const userId = RequestContextService.getUserId() ?? null;
      const stockEvents: Array<() => void> = [];

      await this.prisma.$transaction(async (tx) => {
        const policy = await this.stockValidator?.resolveInventoryPolicy(
          (order as any).store_id,
          tx,
        );
        const allowOversell = policy?.allowOversell === true;

        await this.orderStockCommit.commitOrderLines(orderId, [orderItemId], {
          blockOnInsufficient: !allowOversell,
          allowNegativeOnShortfall: allowOversell,
          onShortfall: allowOversell
            ? (shortfall) => {
                stockWarnings.push({
                  product_id: shortfall.product_id,
                  product_variant_id: shortfall.product_variant_id,
                  product_name: shortfall.product_name,
                  kind: 'product',
                  requested: shortfall.requested,
                  available: shortfall.available,
                });
              }
            : undefined,
          tx,
          userId: userId ?? undefined,
          reason: 'Entrega de item de orden',
          afterCommit: stockEvents,
        });

        await tx.order_items.updateMany({
          where: { id: orderItemId, order_id: orderId },
          data: {
            delivered_at: now,
            delivered_by_user_id: userId,
            updated_at: now,
          },
        });

        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: order.store_id,
          organizationId: order.stores?.organization_id,
          type: 'item_delivered',
          orderItemId,
          actorUserId: userId,
        });
      });

      for (const publish of stockEvents) {
        try {
          publish();
        } catch (error) {
          this.logger.warn(
            `Stock committed; notification failed: ${(error as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Order item #${orderItemId} of order #${orderId} delivered by user #${userId}`,
      );
    } else {
      this.logger.debug(
        `Order item #${orderItemId} of order #${orderId} already delivered — reconciling kitchen state`,
      );
    }

    // 5. Propagación orden→cocina (paso 2 sync cocina↔orden), best-effort
    //    post-commit: el stamp ya quedó, un fallo de cocina nunca lo revierte.
    await this.syncKitchenOnOrderItemDelivered(
      orderId,
      orderItemId,
      (order as any)?.store_id ?? null,
    );

    // 6. Devolver la vista de la orden actualizada (forma `getOrder`,
    //    igual que `shipOrder` / `markKitchenOrderDelivered`). `stock_warnings`
    //    se agrega SOLO si hubo sobreventa aceptada (step 9) — aditivo, nunca
    //    presente (ni como arreglo vacío) en el camino estricto de siempre.
    const updatedOrder = await this.getOrder(orderId);
    return stockWarnings.length > 0
      ? { ...updatedOrder, stock_warnings: stockWarnings }
      : updatedOrder;
  }

  /**
   * Paso 2 sync cocina↔orden — propagación orden→cocina. Contrapartida de
   * `KitchenFireService.markDelivered` (cocina→orden): cuando el mesero
   * entrega el plato desde la orden, la fila de cocina debe reflejarlo.
   *
   *   - Última fila `kitchen_ticket_items` del ítem en `ready` → `delivered`
   *     (SOLO esa fila por PK; jamás filas de otros ítems).
   *   - Si con eso TODAS las filas del ticket quedan terminales
   *     (`delivered`/`cancelled`), cierra el ticket (`delivered` si hay ≥1
   *     delivered) y evalúa el puente all-terminal con el mismo criterio que
   *     `markDelivered`: emite `kitchen.order_all_delivered` si todo-terminal
   *     + ≥1 delivered. El listener mueve la orden `processing -> delivered`.
   *   - Última fila en `pending`/`in_preparation` (re-disparo en cocina) o ya
   *     terminal → NO tocar. Sin filas → nada que hacer.
   *   - Excepción despacho (`fromDispatch`, C.2): la remisión entregada es el
   *     hecho físico — la orden manda aunque KDS siga `pending` — así que la
   *     fila vigente se proyecta a `delivered` sin exigir `ready`, y NO se
   *     emite el puente `kitchen.order_all_delivered` (el despacho gobierna
   *     el estado de la orden vía `reconcileOrderFromDispatch`).
   *   - Cada proyección (parcial o de cierre) emite `ticket.updated` con el
   *     ticket completo vía `KitchenFireService`, para que el tablero KDS
   *     abierto se actualice sin esperar un `ticket.delivered` que sería
   *     falso mientras otro plato del ticket sigue abierto.
   */
  private async syncKitchenOnOrderItemDelivered(
    orderId: number,
    orderItemId: number,
    storeId: number | null,
    options: { fromDispatch?: boolean } = {},
  ): Promise<void> {
    try {
      // La última fila manda (los re-disparos crean filas nuevas con mayor id).
      const latest = await this.prisma.kitchen_ticket_items.findFirst({
        where: { order_item_id: orderItemId },
        orderBy: { id: 'desc' },
        select: { id: true, status: true, kitchen_ticket_id: true },
      });
      if (!latest) {
        return;
      }
      // The waiter may hand off only a ready dish. A delivered remisión is
      // different: the customer already received the order, so the order-side
      // delivery fact wins even if KDS still says pending/in_preparation.
      if (
        latest.status === 'delivered' ||
        (!options.fromDispatch && latest.status !== 'ready')
      ) {
        return;
      }

      await this.prisma.kitchen_ticket_items.update({
        where: { id: latest.id },
        data: { status: 'delivered', updated_at: new Date() },
      });

      const rows = await this.prisma.kitchen_ticket_items.findMany({
        where: { kitchen_ticket_id: latest.kitchen_ticket_id },
        select: { status: true },
      });
      const allTerminal =
        rows.length > 0 &&
        rows.every(
          (r) => r.status === 'delivered' || r.status === 'cancelled',
        );
      if (!allTerminal) {
        await this.kitchenFireService?.emitTicketUpdatedEvent(
          latest.kitchen_ticket_id,
        );
        return;
      }

      const anyDelivered = rows.some((r) => r.status === 'delivered');
      await this.prisma.kitchen_tickets.update({
        where: { id: latest.kitchen_ticket_id },
        data: {
          status: anyDelivered ? 'delivered' : 'cancelled',
          updated_at: new Date(),
        },
      });
      await this.kitchenFireService?.emitTicketUpdatedEvent(
        latest.kitchen_ticket_id,
      );

      const orderTickets = await this.prisma.kitchen_tickets.findMany({
        where: {
          order_id: orderId,
          ...(storeId != null ? { store_id: storeId } : {}),
        },
        select: { status: true },
      });
      const allOrderTerminal =
        orderTickets.length > 0 &&
        orderTickets.every(
          (t) => t.status === 'delivered' || t.status === 'cancelled',
        );
      const anyOrderDelivered = orderTickets.some(
        (t) => t.status === 'delivered',
      );
      // Dispatch owns the order-state transition. Emitting the KDS bridge here
      // could race reconcileOrderFromDispatch and advance the order too early.
      if (!options.fromDispatch && allOrderTerminal && anyOrderDelivered) {
        this.eventEmitter.emit('kitchen.order_all_delivered', {
          orderId,
          storeId,
        });
      }
    } catch (e) {
      // Best-effort (mismo patrón que `markDelivered`): el stamp de
      // `delivered_at` ya hizo commit — se observa por logs, nunca revierte
      // la entrega ni rompe el contrato del endpoint.
      this.logger.warn(
        `Failed to sync kitchen on delivery of order item #${orderItemId} (order #${orderId}): ${
          (e as Error).message
        }`,
      );
    }
  }

  /**
   * Post-commit projection for a physically delivered remisión. Reconciles
   * every already-stamped line, not only new stamps, so a replay can heal a
   * previous best-effort KDS failure without changing the delivery timestamp.
   * The caller supplies an isolated store context and the explicit store id.
   */
  async reconcileKitchenAfterDispatch(
    orderId: number,
    storeId: number,
  ): Promise<void> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: storeId },
      select: { id: true },
    });
    if (!order) return;

    const deliveredItems = await this.prisma.order_items.findMany({
      where: {
        order_id: orderId,
        delivered_at: { not: null },
        cancelled_at: null,
        kitchen_ticket_items: { some: {} },
      },
      select: { id: true },
    });
    for (const item of deliveredItems) {
      await this.syncKitchenOnOrderItemDelivered(
        orderId,
        item.id,
        storeId,
        { fromDispatch: true },
      );
    }
  }

  /**
   * Cancelación de ítem a NIVEL DE ORDEN (seam compartido).
   *
   * Mudado verbatim de `TableSessionsService.cancelOrderItem`: la mesa queda
   * como shim fino (sesión abierta + pertenencia a la cuenta) y TODA la regla
   * vive acá, igual que el precedente `deliverOrderItem`/`markItemDelivered`
   * (T9 / QUI-652). Cubre órdenes con mesa y sin mesa (POS, take-away,
   * domicilio, ecommerce).
   *
   * Reglas (única copia):
   *
   *   1. GUARDS — bloquea split activo, pago liquidado real o estado terminal
   *      (`finished`/`cancelled`/`refunded`) antes de modificar dinero/stock.
   *   2. MOTIVO obligatorio (mín 3 chars): el DTO lo exige (400 sin `reason`);
   *      la validación acá queda como defensa en profundidad para callers
   *      directos.
   *   3. KDS — si el ticket asociado está en `pending` se cancela in-tx (con
   *      relectura TOCTOU dentro del tx) y se emite `ticket.cancelled`
   *      post-commit. Si ya avanzó, la cancelación sigue como merma
   *      (`after_fire_waste`) sin tocar el ticket del cocinero.
   *   4. STOCK — reversión SOLO en la rama defensiva `before_fire` + fired
   *      (inconsistente por construcción; se defiende igual). En
   *      `after_fire_waste` NO se revierte: queda como merma.
   *   5. SOFT CANCEL + recálculo filtrando `cancelled_at IS NULL`.
   *   6. IDEMPOTENCIA — ítem ya cancelado devuelve la vista sin reescribir
   *      (`cancelled_at` queda fijo en la primera cancelación).
   *   7. 1060 paso 1 — ítem con `delivered_at != null` se rechaza con
   *      `ITEM_ALREADY_DELIVERED` (409) sin mutar nada; solo la reversa
   *      explícita (`cancelDeliveredOrderItem`) puede tocarlo.
   *
   * Scope multi-tenant: `getOrder` (404 si la orden no es de la tienda) +
   * `order_items.findFirst` con `order_id: orderId` (si el ítem es de otra
   * orden/tienda, 404 sin filtrar nada).
   *
   * Devuelve la vista básica de la orden (forma `getOrder`, igual que
   * `deliverOrderItem`) para que el frontend reemplace su estado.
   */
  /**
   * D.4 (F-001) — Re-deriva una propina porcentual sobre la base viva
   * (subtotal + impuesto de las líneas activas, misma base bruta de
   * E.6/`resolveTip`). La fija (o sin tipo) se respeta tal cual: retorna
   * null y el caller conserva el monto persistido. Solo corre en órdenes
   * abiertas (el cobro bloquea la cancelación antes), así que nunca toca
   * una propina ya cobrada. Redondeo idéntico al del cobro.
   */
  private rederivePercentageTip(
    order: { tip_type?: string | null; tip_value?: number | string | null },
    subtotal: number,
    tax: number,
  ): number | null {
    if (order.tip_type !== 'percentage') return null;
    const pct = Number(order.tip_value ?? 0);
    if (!(pct > 0)) return null;
    const raw = (Number(subtotal || 0) + Number(tax || 0)) * (pct / 100);
    return Math.round((raw + Number.EPSILON) * 100) / 100;
  }

  /** A COD marker is an unpaid amount to collect, not a settled receipt. */
  private async syncPendingCodAmountInTx(
    tx: Prisma.TransactionClient,
    orderId: number,
    payments: Array<{
      id: number;
      state: string;
      store_payment_method?: {
        system_payment_method?: { processing_mode?: string | null } | null;
      } | null;
    }>,
    grandTotal: number,
  ): Promise<void> {
    const ids = payments
      .filter((payment) =>
        payment.state === 'pending' &&
        payment.store_payment_method?.system_payment_method?.processing_mode === 'ON_DELIVERY',
      )
      .map((payment) => payment.id);
    if (ids.length === 0) return;
    await tx.payments.updateMany({
      where: { id: { in: ids }, order_id: orderId, state: 'pending' },
      data: { amount: new Prisma.Decimal(grandTotal), updated_at: new Date() },
    });
  }

  async cancelOrderItem(
    orderId: number,
    orderItemId: number,
    reason: string,
    cancellationType?: 'before_fire' | 'after_fire_waste' | 'after_fire_reused',
  ) {
    // 1. Orden debe existir en la tienda del contexto. `getOrder` lanza 404
    //    si no la encuentra o no pertenece al scope.
    const order = await this.getOrder(orderId);
    assertNoActiveFinancialSplit(order);

    // No `payment_status` column exists on orders. Settlement is evidenced by
    // the payment rows, just as in cancelDeliveredOrderItem (ADR-02).
    const isPaid = order.payments?.some((payment) =>
      SETTLED_PAYMENT_STATES.has(payment.state),
    );
    if (isPaid) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
        'No se puede cancelar un ítem de una orden ya cobrada',
      );
    }
    if (['finished', 'cancelled', 'refunded'].includes(order.state)) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
        `No se puede cancelar un ítem en estado '${order.state}'`,
      );
    }

    // 2. El ítem debe pertenecer a ESTA orden (barrera de scope: 404 sin
    //    filtrar nada de otra orden/tenant, igual que `deliverOrderItem`).
    const orderItem = await this.prisma.order_items.findFirst({
      where: { id: orderItemId, order_id: orderId },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        quantity: true,
        stock_units_consumed: true,
        product_name: true,
        inventory_consumed_at_fire: true,
        products: { select: { product_type: true } },
        cancelled_at: true,
        // 1060 paso 1 — el guard de entregado vive acá (el select debe
        // traerlo; sin él la guarda sería ciega).
        delivered_at: true,
        kitchen_ticket_items: {
          orderBy: { id: 'desc' },
          select: {
            id: true,
            status: true,
            kitchen_ticket_id: true,
            kitchen_ticket: {
              select: { id: true, status: true },
            },
          },
        },
      },
    });

    if (!orderItem) {
      throw new NotFoundException(
        `Order item #${orderItemId} not found on order #${orderId}`,
      );
    }

    // 3. Idempotencia: la primera cancelación es la que ocurrió.
    if (orderItem.cancelled_at) {
      return this.getOrder(orderId);
    }

    // 3b. 1060 paso 1 — entregado es hecho consumado: la cancelación normal
    //     lo rechaza SIN mutar nada (sin KDS, sin stock, sin soft cancel).
    //     Solo la reversa explícita (`cancelDeliveredOrderItem`, con motivo
    //     + destino restock|waste) puede tocarlo. Va antes de la validación
    //     del motivo (igual que los guards paid/terminal): el conflicto de
    //     estado domina sobre la calidad del input. Cubre mesa, legacy y
    //     detalle porque todos pasan por este seam.
    if (orderItem.delivered_at != null) {
      throw new VendixHttpException(
        ErrorCodes.ITEM_ALREADY_DELIVERED,
        `No se puede cancelar el ítem #${orderItemId}: ya fue entregado`,
      );
    }

    // 4. Derivar el tipo contable si el caller no lo proveyó + motivo
    //    obligatorio (defensa en profundidad; el DTO ya lo exige).
    const wasFired = orderItem.inventory_consumed_at_fire === true;
    const preparedFired = wasFired && orderItem.products?.product_type === 'prepared';
    const preparedOrganizationId = preparedFired ? Number(order.stores?.organization_id) : 0;
    if (preparedFired && (!Number.isInteger(preparedOrganizationId) || preparedOrganizationId <= 0)) {
      throw new InternalServerErrorException('La organización de la orden no está disponible para la reclasificación');
    }
    if (!reason || reason.trim().length < 3) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'Debes proporcionar un motivo de cancelación (mínimo 3 caracteres)',
      );
    }

    // 5. Estado KDS: `kitchen_ticket_items` viene desc por id, [0] es el
    //    más reciente.
    const activeKti = orderItem.kitchen_ticket_items[0] ?? null;
    const ticketStatus = activeKti?.kitchen_ticket?.status ?? null;
    const ticketId = activeKti?.kitchen_ticket?.id ?? null;
    const isPendingTicket = wasFired && ticketStatus === 'pending';
    if (preparedFired && !isPendingTicket && !cancellationType) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'El plato ya está en preparación o más avanzado: elige reutilizar los insumos o desecharlos antes de cancelar.',
      );
    }
    const resolvedType: 'before_fire' | 'after_fire_waste' | 'after_fire_reused' =
      preparedFired && isPendingTicket
        ? 'after_fire_reused'
        : cancellationType ?? (wasFired ? 'after_fire_waste' : 'before_fire');
    if (preparedFired && resolvedType === 'before_fire') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'Un plato disparado no puede cancelarse como antes de cocina',
      );
    }

    // El KDS es obligatorio para este seam (un ticket `pending` huérfano
    // dejaría al cocinero cocinando un plato cancelado). Falla fuerte si el
    // DI no lo cableó — nunca se salta en silencio.
    const kds = this.kitchenFireService;
    if (!kds) {
      throw new InternalServerErrorException(
        'KitchenFireService no disponible en OrderFlowService (revisar imports de OrderFlowModule)',
      );
    }

    let cancelledTicketId: number | null = null;
    let updatedTicketId: number | null = null;
    let preparedDisposition: 'reuse' | 'waste' | null = null;
    let preparedLeaves: ConsumedLeafDisposition[] = [];
    const preparedStockAfterCommit: Array<() => void> = [];
    let alreadyCancelledInTx = false;

    await this.prisma.$transaction(async (tx) => {
      const lockedOrder = await this.assertUnsplitOrderAfterLock(tx, orderId, order.store_id);
      if (['finished', 'cancelled', 'refunded'].includes(lockedOrder.state)) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
          `No se puede cancelar un ítem en estado '${lockedOrder.state}'`,
        );
      }
      const settledPayment = await tx.payments.findFirst({
        where: {
          order_id: orderId,
          state: { in: [...SETTLED_PAYMENT_STATES] as payments_state_enum[] },
        },
        select: { id: true },
      });
      if (settledPayment) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
          'No se puede cancelar un ítem de una orden ya cobrada',
        );
      }
      if (preparedFired) {
        const freshItem = await tx.order_items.findFirst({
          where: { id: orderItemId, order_id: orderId },
          select: { cancelled_at: true },
        });
        if (freshItem?.cancelled_at) {
          alreadyCancelledInTx = true;
          return;
        }
      }
      // Cancelar el ticket KDS SOLO si está en `pending`.
      if (isPendingTicket && ticketId != null) {
        // TOCTOU guard: el cocinero puede haber avanzado el ticket entre la
        // lectura y este tx. Releer y revalidar dentro del tx.
        const freshTicket = await tx.kitchen_tickets.findFirst({
          where: { id: ticketId },
          select: { status: true },
        });
        if (freshTicket && freshTicket.status === 'pending') {
          const result = await kds.cancelTicketItemInTx(tx, ticketId, orderItemId);
          if (result === 'cancelled') cancelledTicketId = ticketId;
          else updatedTicketId = ticketId;
        } else {
          throw new VendixHttpException(
            ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
            'El ticket cambió de estado en cocina. Actualiza la orden y vuelve a elegir qué hacer con los insumos.',
          );
        }
        // Si el ticket ya no está pending al iniciar el tx, no lo
        // cancelamos pero la cancelación del ítem sigue adelante
        // (registrada como merma).
      }

      if (preparedFired && !isPendingTicket && ticketId != null &&
          (activeKti?.status === 'in_preparation' || activeKti?.status === 'ready')) {
        const result = await kds.cancelTicketItemInTx(tx, ticketId, orderItemId, activeKti.status);
        if (result === 'cancelled') cancelledTicketId = ticketId;
        else updatedTicketId = ticketId;
      }

      // Sincronía cancelado orden↔cocina: cualquier fila viva restante
      // (línea no `prepared`, ticket `delivered`, estado avanzado sin
      // disposición) queda `cancelled` en la misma tx.
      const kdsSync = await this.cancelLatestKitchenItemInTx(tx, orderId, orderItemId);
      if (kdsSync) {
        if (kdsSync.result === 'cancelled') cancelledTicketId ??= kdsSync.ticketId;
        else updatedTicketId ??= kdsSync.ticketId;
      }

      // Reversión de stock SOLO en before_fire (no fired). En
      // after_fire_waste NO se revierte — queda como merma.
      if (preparedFired) {
        preparedDisposition = resolvedType === 'after_fire_reused' ? 'reuse' : 'waste';
        preparedLeaves = await this.disposeConsumedPreparedLeaves(
          tx, orderId, orderItemId, preparedOrganizationId,
          preparedDisposition, reason.trim(), preparedStockAfterCommit, ticketId,
        );
        await this.auditPreparedDispositionInTx(
          tx, orderId, orderItemId, preparedOrganizationId,
          order.store_id, reason.trim(), preparedDisposition, preparedLeaves, ticketId,
        );
      } else if (resolvedType === 'before_fire' && wasFired) {
        // Esto no debería ocurrir (si `wasFired` es true, resolvedType
        // sería `after_fire_waste`), pero se defiende igual por si el
        // caller envía un type explícito inconsistente.
        const consumptionTxns = await tx.inventory_transactions.findMany({
          where: {
            order_item_id: orderItemId,
            quantity_change: { lt: 0 },
          },
          select: {
            product_id: true,
            product_variant_id: true,
            quantity_change: true,
          },
        });
        for (const ct of consumptionTxns) {
          const locationId =
            await this.stockLevelManager.getDefaultLocationForProduct(
              ct.product_id,
              ct.product_variant_id ?? undefined,
            );
          await this.stockLevelManager.updateStock(
            {
              product_id: ct.product_id,
              variant_id: ct.product_variant_id ?? undefined,
              location_id: locationId,
              quantity_change: Math.abs(ct.quantity_change),
              movement_type: 'return',
              reason: 'Reversa cancelación ítem orden — antes de disparar',
              source_module: 'order_item_cancellation',
              // NO order_item_id: la reversa no debe crear un hijo que
              // apunte al order_item cancelado (FK onDelete: Restrict).
              create_movement: true,
              validate_availability: false,
            },
            tx,
          );
        }
      }

      // docs/plans/no-overselling-stock-guard-plan.md step 7 — an
      // undelivered, never-committed line's active stock reservation must
      // be released back to sellable, or the cancelled line keeps holding
      // stock hostage forever. Safe no-op when there is nothing to release:
      // untracked products, kitchen dishes excluded from Step 3/4's own
      // reservation (their reservation never existed — ingredients are
      // handled above via `disposeConsumedPreparedLeaves`), and lines whose
      // stock was already consumed/released by the branches above.
      const releaseQty = orderItem.stock_units_consumed ?? orderItem.quantity;
      if (orderItem.product_id != null && releaseQty > 0 && !orderItem.inventory_consumed_at_fire) {
        await this.stockLevelManager.releaseReservationQuantity(
          'order',
          orderId,
          orderItem.product_id,
          orderItem.product_variant_id ?? undefined,
          releaseQty,
          'cancelled',
          tx,
        );
      }

      // Soft cancel: el ítem queda VISIBLE marcado como cancelado, pero
      // EXCLUIDO de los totales. Motivo + tipo contable persistidos para
      // auditoría y para que el KDS / detalle de orden los muestre.
      await tx.order_items.update({
        where: { id: orderItemId },
        data: {
          cancelled_at: new Date(),
          cancellation_reason: reason.trim(),
          cancellation_type: resolvedType,
          updated_at: new Date(),
        },
      });

      await this.orderHistoryService?.record(tx, {
        orderId,
        storeId: order.store_id,
        organizationId: order.stores?.organization_id,
        type: 'item_cancelled',
        orderItemId,
        payload: { reason: reason.trim(), cancellation_type: resolvedType },
      });

      // Recálculo excluyendo cancelados (`cancelled_at IS NULL`).
      //
      // F-082 (blocker, C.8): antes sumaba `tax_amount_item` SIN
      // multiplicador — ese campo no tiene una sola unidad (F-003: unos
      // escritores lo mandan por unidad, otros por línea), así que sumarlo
      // crudo subestima el impuesto bajo una convención y lo deja correcto
      // sólo por casualidad bajo la otra. `order_item_taxes.tax_amount` SÍ es
      // fiable: cada fila ya es el total de impuesto de esa línea tal como
      // se persistió al crear/cobrar la orden (`checkout.service.ts:1653`,
      // el carril POS), así que sumarla no requiere adivinar unidad.
      await this.recalcOrderTotalsAfterItemCancelInTx(tx, order, orderId);
    });

    if (alreadyCancelledInTx) return this.getOrder(orderId);
    for (const publish of preparedStockAfterCommit) publish();
    if (preparedDisposition) {
      await this.postPreparedDispositionAfterCommit(
        orderId, orderItemId, preparedOrganizationId, order.store_id,
        preparedDisposition, preparedLeaves,
      );
    }

    // Post-commit: emitir `ticket.cancelled` SOLO si cancelamos un ticket
    // que efectivamente estaba en `pending`.
    if (cancelledTicketId != null) {
      try {
        await kds.emitTicketCancelledEvent(cancelledTicketId);
      } catch (err) {
        this.logger.warn(
          `Failed to emit ticket.cancelled for ticket #${cancelledTicketId}: ${
            (err as Error).message
          }`,
        );
      }
    }
    if (updatedTicketId != null) {
      await kds.emitTicketUpdatedEvent(updatedTicketId);
    }

    this.logger.log(
      `Order item cancelled: order=${orderId} item=${orderItemId} type=${resolvedType} fired=${wasFired} ticketCancelled=${cancelledTicketId != null}`,
    );

    // 6. Devolver la vista de la orden actualizada (forma `getOrder`,
    //    igual que `deliverOrderItem`).
    return this.getOrder(orderId);
  }

  /**
   * Recálculo de totales de la orden EXCLUYENDO ítems cancelados
   * (`cancelled_at IS NULL`). Compartido por `cancelOrderItem`,
   * `cancelDeliveredOrderItem` y `cancelItemsFromKitchenInTx`.
   *
   * F-082: suma `order_item_taxes.tax_amount` (fiable por línea), conserva
   * envío/propina/descuento y aplica clamp a 0. D.4 (F-001): la propina
   * porcentual se re-deriva sobre la base viva; la fija se respeta.
   */
  private async recalcOrderTotalsAfterItemCancelInTx(
    tx: Prisma.TransactionClient,
    order: any,
    orderId: number,
  ): Promise<void> {
    const activeItems = await tx.order_items.findMany({
      where: { order_id: orderId, cancelled_at: null },
      select: {
        total_price: true,
        order_item_taxes: { select: { tax_amount: true } },
      },
    });
    const subtotal = activeItems.reduce(
      (acc, it) => acc + Number(it.total_price),
      0,
    );
    const tax = activeItems.reduce(
      (acc, it) =>
        acc +
        // ADR-06 — nunca asumir la relación poblada: una fila sin desglose
        // fiscal persistido aporta cero impuesto en vez de tronar.
        (it.order_item_taxes ?? []).reduce(
          (s, t) => s + Number(t.tax_amount ?? 0),
          0,
        ),
      0,
    );
    const shippingCost = Number(order?.shipping_cost ?? 0);
    const rederivedTip = this.rederivePercentageTip(order, subtotal, tax);
    const tipAmount = rederivedTip ?? Number(order?.tip_amount ?? 0);
    const discountAmount = Number(order?.discount_amount ?? 0);
    const grandTotal = Math.max(
      0,
      subtotal + tax + shippingCost + tipAmount - discountAmount,
    );
    await tx.orders.update({
      where: { id: orderId },
      data: {
        subtotal_amount: new Prisma.Decimal(subtotal),
        tax_amount: new Prisma.Decimal(tax),
        grand_total: new Prisma.Decimal(grandTotal),
        ...(rederivedTip != null
          ? { tip_amount: new Prisma.Decimal(rederivedTip) }
          : {}),
        updated_at: new Date(),
      },
    });
    await this.syncPendingCodAmountInTx(tx, orderId, order?.payments ?? [], grandTotal);
  }

  /**
   * Sincronía cancelado orden↔cocina (regla del dueño): toda cancelación de
   * una línea del lado orden deja su ÚLTIMA fila `kitchen_ticket_items` en
   * `cancelled`, sea cual sea su estado (pending, in_preparation, ready y
   * también `delivered`), dentro de la misma tx del llamador.
   *
   * `KitchenFireService.cancelTicketItemInTx` rechaza `delivered`, así que
   * acá se escribe directo la fila por PK y se recalcula el encabezado con la
   * misma regla: todas las filas `cancelled` → ticket `cancelled`; todas
   * terminales con al menos una `delivered` → ticket `delivered`; en otro
   * caso el ticket no cambia (SSE `updated`). Idempotente: si la fila ya
   * está `cancelled` (p. ej. la rama pending/avanzada ya la canceló) no hace
   * nada. NO toca inventario (la disposición reuse/waste vive en el llamador)
   * ni emite SSE (el llamador emite post-commit).
   */
  private async cancelLatestKitchenItemInTx(
    tx: Prisma.TransactionClient,
    orderId: number,
    orderItemId: number,
  ): Promise<{ ticketId: number; result: 'cancelled' | 'updated' } | null> {
    const latest = await tx.kitchen_ticket_items.findFirst({
      where: { order_item_id: orderItemId, kitchen_ticket: { order_id: orderId } },
      orderBy: { id: 'desc' },
      select: { id: true, status: true, kitchen_ticket_id: true },
    });
    if (!latest || latest.status === 'cancelled') return null;
    await tx.kitchen_ticket_items.update({
      where: { id: latest.id },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    const rows = await tx.kitchen_ticket_items.findMany({
      where: { kitchen_ticket_id: latest.kitchen_ticket_id },
      select: { status: true },
    });
    const allCancelled = rows.every((r) => r.status === 'cancelled');
    if (allCancelled) {
      await tx.kitchen_tickets.update({
        where: { id: latest.kitchen_ticket_id },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      return { ticketId: latest.kitchen_ticket_id, result: 'cancelled' };
    }
    const allTerminal = rows.every(
      (r) => r.status === 'cancelled' || r.status === 'delivered',
    );
    if (allTerminal) {
      await tx.kitchen_tickets.update({
        where: { id: latest.kitchen_ticket_id },
        data: { status: 'delivered', updated_at: new Date() },
      });
    }
    return { ticketId: latest.kitchen_ticket_id, result: 'updated' };
  }

  /**
   * Predicado "orden cobrada" para cancelar ítems desde cocina: existe un pago
   * registrado (no cancelado/fallido), la misma regla (`SETTLED_PAYMENT_STATES`)
   * que usa `cancelOrderItem` dentro y fuera de la tx.
   */
  async isOrderPaidForKitchenCancel(
    orderId: number,
    client?: any,
  ): Promise<boolean> {
    const db: any = client ?? this.prisma;
    const settled = await db.payments.findFirst({
      where: {
        order_id: orderId,
        state: { in: [...SETTLED_PAYMENT_STATES] as payments_state_enum[] },
      },
      select: { id: true },
    });
    return settled != null;
  }

  /**
   * Seam para KitchenFireService (cancelación iniciada en cocina): dentro de
   * la tx del llamador marca las líneas como canceladas del lado orden
   * (`after_fire_reused` si `disposition='reuse'`, `after_fire_waste` si
   * `'waste'`), recalcula totales igual que `cancelOrderItem` y registra el
   * `item_cancelled` con `source: 'kitchen'`. NO toca inventario ni tickets:
   * cocina ya hizo ambas cosas. Lanza el mismo error de `cancelOrderItem` si
   * la orden ya está cobrada o en estado terminal.
   */
  async cancelItemsFromKitchenInTx(
    tx: Prisma.TransactionClient,
    params: {
      orderId: number;
      orderItemIds: number[];
      disposition: 'reuse' | 'waste';
      reason: string;
      ticketId: number;
      wasPending: boolean;
    },
  ): Promise<void> {
    const { orderId, disposition, ticketId, wasPending } = params;
    const reason = (params.reason ?? '').trim();
    const ids = [...new Set(params.orderItemIds.filter((id) => Number.isInteger(id)))];
    if (ids.length === 0) return;
    if (reason.length < 3) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'Debes proporcionar un motivo de cancelación (mínimo 3 caracteres)',
      );
    }
    const order = await this.getOrder(orderId, tx);
    assertNoActiveFinancialSplit(order);
    if (['finished', 'cancelled', 'refunded'].includes(order.state)) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
        `No se puede cancelar un ítem en estado '${order.state}'`,
      );
    }
    if (await this.isOrderPaidForKitchenCancel(orderId, tx)) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
        'No se puede cancelar un ítem de una orden ya cobrada',
      );
    }
    const cancellationType: 'after_fire_reused' | 'after_fire_waste' =
      disposition === 'reuse' ? 'after_fire_reused' : 'after_fire_waste';
    const active = await tx.order_items.findMany({
      where: { id: { in: ids }, order_id: orderId, cancelled_at: null },
      select: { id: true },
    });
    if (active.length === 0) return;
    const now = new Date();
    await tx.order_items.updateMany({
      where: { id: { in: active.map((i) => i.id) }, order_id: orderId },
      data: {
        cancelled_at: now,
        cancellation_reason: reason,
        cancellation_type: cancellationType,
        updated_at: now,
      },
    });
    for (const item of active) {
      await this.orderHistoryService?.record(tx, {
        orderId,
        storeId: order.store_id,
        organizationId: order.stores?.organization_id,
        type: 'item_cancelled',
        orderItemId: item.id,
        payload: {
          reason,
          cancellation_type: cancellationType,
          source: 'kitchen',
          ticket_id: ticketId,
          was_pending: wasPending,
        },
      });
    }
    await this.recalcOrderTotalsAfterItemCancelInTx(tx, order, orderId);
  }

  /**
   * Reversa de entrega a NIVEL DE ÍTEM (1060 paso 2 — único camino para
   * cancelar un ítem ya entregado; el seam `cancelOrderItem` lo rechaza
   * con `ITEM_ALREADY_DELIVERED`).
   *
   * Reglas:
   *   1. GUARDS — espejo del seam: bloquea si la orden está cobrada o en
   *      estado terminal (`finished`/`cancelled`/`refunded`).
   *   2. MOTIVO obligatorio (mín 3) + DESTINO obligatorio (`restock` |
   *      `waste`): el DTO lo exige (400/422 sin ellos); la validación acá
   *      queda como defensa en profundidad para callers directos.
   *   3. IDEMPOTENCIA — ítem ya cancelado devuelve la vista sin reescribir.
   *   4. SOLO ENTREGADOS — sin `delivered_at` no hay entrega que reversar
   *      (409, sin mutar nada).
   *   5. DESTINO — `restock` devuelve las unidades al stock vía
   *      `stockLevelManager.updateStock` (`movement_type='return'`, sin
   *      `order_item_id` por la FK `Restrict`, igual que la reversa del
   *      seam); `waste` no toca stock: la merma queda auditada.
   *   6. SOFT CANCEL + recálculo filtrando `cancelled_at IS NULL` (mismo
   *      patrón F-082 del seam: conserva envío/propina/descuento).
   *   7. AUDITORÍA — fila `order_item.cancel_delivered` vía `AuditService`
   *      con usuario, motivo y destino (best-effort post-commit, igual que
   *      `order.promoted_to_created`: nunca revierte la reversa).
   *
   * Scope multi-tenant: `getOrder` (404 si la orden no es de la tienda) +
   * `order_items.findFirst` con `order_id: orderId` (404 sin filtrar nada).
   */
  async cancelDeliveredOrderItem(
    orderId: number,
    orderItemId: number,
    reason: string,
    destination: 'restock' | 'waste',
  ) {
    // 1. Orden debe existir en la tienda del contexto; no recalcular una
    //    venta cobrada ni una orden terminal antes de abrir la transacción.
    const order = await this.getOrder(orderId);
    assertNoActiveFinancialSplit(order);

    // Una orden reembolsada/cancelada ya es terminal: su estado debe explicar
    // el rechazo aunque conserve el pago histórico (incluido refunded).
    if (['cancelled', 'refunded'].includes(order.state)) {
      throw new VendixHttpException(
        ErrorCodes.ORD_ITEM_CANCEL_STATE_001,
        `No se puede cancelar un plato de una orden en estado '${order.state}'.`,
        { state: order.state },
      );
    }
    if (order.payments?.some((payment) =>
      SETTLED_PAYMENT_STATES.has(payment.state),
    )) {
      throw new VendixHttpException(
        ErrorCodes.ORD_ITEM_CANCEL_PAID_001,
        'Esta orden ya fue cobrada. Usa Reembolso para devolver un plato.',
      );
    }
    if (order.state === 'finished') {
      throw new VendixHttpException(
        ErrorCodes.ORD_ITEM_CANCEL_STATE_001,
        `No se puede cancelar un plato de una orden en estado '${order.state}'.`,
        { state: order.state },
      );
    }

    // 2. El ítem debe pertenecer a ESTA orden (barrera de scope: 404 sin
    //    filtrar nada de otra orden/tenant, igual que el seam).
    const orderItem = await this.prisma.order_items.findFirst({
      where: { id: orderItemId, order_id: orderId },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        product_name: true,
        quantity: true,
        stock_units_consumed: true,
        inventory_committed: true,
        delivered_at: true,
        cancelled_at: true,
        inventory_consumed_at_fire: true,
        products: { select: { product_type: true } },
        // H2/H4 — needed to scope the ingredient-refund lookup and stamp
        // ticket_id on the disposition audit (see `disposeConsumedPreparedLeaves`
        // / `auditPreparedDispositionInTx`). Mirrors the select in `cancelOrderItem`.
        kitchen_ticket_items: {
          orderBy: { id: 'desc' },
          select: { kitchen_ticket_id: true },
        },
      },
    });

    if (!orderItem) {
      throw new NotFoundException(
        `Order item #${orderItemId} not found on order #${orderId}`,
      );
    }

    // H2/H4 — most recent kitchen ticket this order item was fired under
    // (kitchen_ticket_items comes desc by id, [0] is the latest).
    const ticketId = orderItem.kitchen_ticket_items[0]?.kitchen_ticket_id ?? null;

    // 3. Idempotencia: la primera reversa es la que ocurrió.
    if (orderItem.cancelled_at) {
      return this.getOrder(orderId);
    }

    // 4. Motivo + destino obligatorios (defensa en profundidad; el DTO ya
    //    los exige).
    if (!reason || reason.trim().length < 3) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'Debes proporcionar un motivo de reversa (mínimo 3 caracteres)',
      );
    }
    if (destination !== 'restock' && destination !== 'waste') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        `Destino de reversa inválido: '${destination}'. Debe ser 'restock' o 'waste'`,
      );
    }

    // 5. Solo entregados: sin `delivered_at` no hay entrega que reversar.
    if (orderItem.delivered_at == null) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
        `No se puede reversar la entrega del ítem #${orderItemId}: no está entregado`,
      );
    }

    const trimmedReason = reason.trim();
    const cancellationType =
      destination === 'restock' ? 'after_fire_reused' : 'after_fire_waste';
    const userId = RequestContextService.getUserId() ?? null;
    // A prepared product is never restocked as the sold dish, even when its
    // historical fire flag/consumption is absent (recipe-less or legacy row).
    const preparedDish = orderItem.products?.product_type === 'prepared';
    const preparedOrganizationId = preparedDish ? Number(order.stores?.organization_id) : 0;
    if (preparedDish && (!Number.isInteger(preparedOrganizationId) || preparedOrganizationId <= 0)) {
      throw new InternalServerErrorException('La organización de la orden no está disponible para la reclasificación');
    }
    let preparedLeaves: ConsumedLeafDisposition[] = [];
    const preparedStockAfterCommit: Array<() => void> = [];
    let alreadyCancelledInTx = false;
    let kdsCancelled: { ticketId: number; result: 'cancelled' | 'updated' } | null = null;

    await this.prisma.$transaction(async (tx) => {
      const lockedOrder = await this.assertUnsplitOrderAfterLock(tx, orderId, order.store_id);
      if (['cancelled', 'refunded', 'finished'].includes(lockedOrder.state)) {
        throw new VendixHttpException(
          ErrorCodes.ORD_ITEM_CANCEL_STATE_001,
          `No se puede cancelar un plato de una orden en estado '${lockedOrder.state}'.`,
          { state: lockedOrder.state },
        );
      }
      const settledPayment = await tx.payments.findFirst({
        where: {
          order_id: orderId,
          state: { in: [...SETTLED_PAYMENT_STATES] as payments_state_enum[] },
        },
        select: { id: true },
      });
      if (settledPayment) {
        throw new VendixHttpException(
          ErrorCodes.ORD_ITEM_CANCEL_PAID_001,
          'Esta orden ya fue cobrada. Usa Reembolso para devolver un plato.',
        );
      }
      if (preparedDish) {
        const freshItem = await tx.order_items.findFirst({
          where: { id: orderItemId, order_id: orderId },
          select: { cancelled_at: true },
        });
        if (freshItem?.cancelled_at) {
          alreadyCancelledInTx = true;
          return;
        }
      }
      // Destino restock: devolver las unidades al stock. `waste` no toca
      // stock (la merma queda en la auditoría del paso 7).
      if (preparedDish) {
        preparedLeaves = await this.disposeConsumedPreparedLeaves(
          tx, orderId, orderItemId, preparedOrganizationId,
          destination === 'restock' ? 'reuse' : 'waste', trimmedReason,
          preparedStockAfterCommit, ticketId,
        );
        await this.auditPreparedDispositionInTx(
          tx, orderId, orderItemId, preparedOrganizationId, order.store_id,
          trimmedReason, destination === 'restock' ? 'reuse' : 'waste', preparedLeaves, ticketId,
        );
      } else if (orderItem.product_id != null) {
        // docs/plans/no-overselling-stock-guard-plan.md step 7 — you only
        // return what you actually took out. Gate on `inventory_committed`
        // (was this line's stock ever really deducted?), not on
        // `delivered_at`/`quantity`: a delivered-but-never-committed line
        // (untracked product, or a legacy order delivered before this plan
        // shipped commit-on-delivery) never removed anything from on_hand —
        // adding stock back would fabricate units that were never taken.
        const restockQty =
          orderItem.stock_units_consumed ?? orderItem.quantity;
        if (orderItem.inventory_committed) {
          if (destination === 'restock') {
            const locationId =
              await this.stockLevelManager.getDefaultLocationForProduct(
                orderItem.product_id,
                orderItem.product_variant_id ?? undefined,
              );
            await this.stockLevelManager.updateStock(
              {
                product_id: orderItem.product_id,
                variant_id: orderItem.product_variant_id ?? undefined,
                location_id: locationId,
                quantity_change: restockQty,
                movement_type: 'return',
                reason: `Reversa entrega ítem orden — restock (${trimmedReason})`,
                source_module: 'order_item_cancel_delivered',
                // NO order_item_id: la reversa no debe crear un hijo que
                // apunte al order_item cancelado (FK onDelete: Restrict).
                create_movement: true,
                validate_availability: false,
              },
              tx,
            );
          }
          // destination === 'waste': stock was already deducted at commit
          // and stays consumed (merma) — nothing to undo here.
        } else if (restockQty > 0) {
          // Never committed — nothing was deducted, only (maybe) reserved.
          // Release that reservation (regardless of destination) instead of
          // either inventing stock or leaving it held forever.
          await this.stockLevelManager.releaseReservationQuantity(
            'order',
            orderId,
            orderItem.product_id,
            orderItem.product_variant_id ?? undefined,
            restockQty,
            'cancelled',
            tx,
          );
        }
      }

      // Sincronía cancelado orden↔cocina: la fila KDS (incluso `delivered`)
      // queda `cancelled` en la misma tx. La disposición de inventario
      // (restock/waste) ya se resolvió arriba y no se duplica.
      kdsCancelled = await this.cancelLatestKitchenItemInTx(tx, orderId, orderItemId);

      // Soft cancel: el ítem queda VISIBLE marcado como cancelado, pero
      // EXCLUIDO de los totales. Motivo + destino persistidos para
      // auditoría y para que el detalle de orden los muestre.
      await tx.order_items.update({
        where: { id: orderItemId },
        data: {
          cancelled_at: new Date(),
          cancellation_reason: trimmedReason,
          cancellation_type: cancellationType,
          updated_at: new Date(),
        },
      });

      await this.orderHistoryService?.record(tx, {
        orderId,
        storeId: order.store_id,
        organizationId: order.stores?.organization_id,
        type: 'item_delivery_reverted',
        orderItemId,
        actorUserId: userId,
        payload: { reason: trimmedReason, destination },
      });

      // Recálculo excluyendo cancelados (`cancelled_at IS NULL`) — mismo
      // patrón F-082 del seam (conserva envío/propina/descuento, clamp 0).
      await this.recalcOrderTotalsAfterItemCancelInTx(tx, order, orderId);
    });

    if (alreadyCancelledInTx) return this.getOrder(orderId);
    for (const publish of preparedStockAfterCommit) publish();
    if (preparedDish) {
      await this.postPreparedDispositionAfterCommit(
        orderId, orderItemId, preparedOrganizationId, order.store_id,
        destination === 'restock' ? 'reuse' : 'waste', preparedLeaves,
      );
    }
    // SSE post-commit del ticket afectado (cancelled si todo el ticket quedó
    // cancelado, updated en otro caso). Best-effort.
    const kdsSync = kdsCancelled as { ticketId: number; result: 'cancelled' | 'updated' } | null;
    if (kdsSync && this.kitchenFireService) {
      try {
        if (kdsSync.result === 'cancelled') {
          await this.kitchenFireService.emitTicketCancelledEvent(kdsSync.ticketId);
        } else {
          await this.kitchenFireService.emitTicketUpdatedEvent(kdsSync.ticketId);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to emit KDS event for ticket #${kdsSync.ticketId}: ${(err as Error).message}`,
        );
      }
    }
    // 7. Auditoría post-commit (best-effort, nunca revierte la reversa).
    if (!preparedDish) try {
      await this.auditService.logCustom(
        userId ?? 0,
        'order_item.cancel_delivered',
        AuditResource.ORDERS,
        {
          request_id: RequestContextService.getRequestId() ?? null,
          store_id: (order as any)?.store_id ?? null,
          order_id: orderId,
          order_item_id: orderItemId,
          reason: trimmedReason,
          destination,
          cancellation_type: cancellationType,
        },
        orderId,
      );
    } catch (auditErr) {
      this.logger.warn(
        `[cancelDeliveredOrderItem audit failed] order=${orderId} item=${orderItemId}: ${(auditErr as Error).message}`,
      );
    }

    this.logger.log(
      `Order item delivery reversed: order=${orderId} item=${orderItemId} destination=${destination}`,
    );

    return this.getOrder(orderId);
  }

  async revertKitchenOrderDelivery(
    orderId: number,
  ): Promise<KitchenBridgeResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true, state: true },
    });

    // No-op idempotente: orden inexistente o no entregada → nada que revertir.
    // Se reporta `transitioned: false` con el pre-estado real para que el
    // listener NO emita SSE (chequear `order.state` no basta: una orden que
    // ya estaba en `processing` pasaría ese chequeo y emitiría un evento
    // fantasma con `old_state` inventado).
    if (!order || order.state !== 'delivered') {
      this.logger.debug(
        `Order #${orderId} not in 'delivered' (is '${
          order?.state ?? 'missing'
        }') — skipping KDS delivery-reverted bridge`,
      );
      return {
        order,
        transitioned: false,
        previousState: (order?.state as order_state_enum) ?? null,
      };
    }

    this.validateTransition(order.state as OrderState, 'processing', 'kitchen_bridge');
    const updatedOrder = await this.updateOrderState(orderId, 'processing', {
      kitchen_delivery_reverted: true,
    }, { source: 'kitchen_bridge' });

    this.logger.log(
      `Order #${orderId} reverted to 'processing' (kitchen ticket delivery reverted)`,
    );
    return {
      order: updatedOrder,
      transitioned: true,
      previousState: order.state as order_state_enum,
    };
  }

  /**
   * Confirm delivery by customer (delivered -> finished).
   *
   * Also the "Finalizar Orden" path for restaurant POS orders: a paid
   * kitchen order sits in `processing` ("pagada / en cocina") and must be
   * finishable directly without first passing through `delivered`. Both
   * `delivered` and `processing` are therefore accepted here; the underlying
   * `processing -> finished` transition is enabled in VALID_TRANSITIONS.
   */
  async confirmDelivery(orderId: number) {
    const order = await this.getOrder(orderId);

    const FINISHABLE_STATES: OrderState[] = ['delivered', 'processing'];
    if (!FINISHABLE_STATES.includes(order.state as OrderState)) {
      throw new BadRequestException(
        `Cannot confirm delivery for order in state '${order.state}'. ` +
          `Order must be in one of: [${FINISHABLE_STATES.join(', ')}].`,
      );
    }

    // F2-guard (MANUAL finish): a cashier/operator cannot finish an order
    // that still has undelivered kitchen items. This is the explicit-action
    // path, so we THROW (the operator must wait for the kitchen or mark the
    // tickets delivered first). Automatic paths (credit payment, forgiveness,
    // POS payment, auto-finish job) handle this by NOT finishing instead.
    const pendingKitchenItems = await this.prisma.kitchen_ticket_items.findMany({
      where: {
        kitchen_ticket: { order_id: orderId },
        status: { notIn: ['delivered', 'cancelled'] },
      },
      select: {
        order_item_id: true,
        status: true,
        quantity: true,
        variant_label: true,
        order_item: { select: { product_name: true } },
      },
      orderBy: { id: 'asc' },
    });
    if (pendingKitchenItems.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS,
        undefined,
        {
          pending_items: pendingKitchenItems.map((item) => ({
            order_item_id: item.order_item_id,
            product_name: item.order_item.product_name,
            variant_label: item.variant_label,
            quantity: item.quantity,
            status: item.status,
          })),
        },
      );
    }

    await this.assertKitchenReadyForWholeOrder(
      orderId,
      storeIsRestaurant((order as any).stores?.industries),
    );

    this.validateTransition(order.state as OrderState, 'finished');
    const updatedOrder = await this.updateOrderState(orderId, 'finished', {
      finished_at: new Date(),
    });

    this.logger.log(`Order #${orderId} delivery confirmed, order finished`);
    return updatedOrder;
  }

  /**
   * Public finish entrypoint for callers that own their own lifecycle (e.g.
   * memberships — Caller D). Validates the transition to `finished`
   * (created / processing / delivered → finished are all valid) and delegates
   * to updateOrderState, which now deducts stock through the canonical
   * OrderStockCommitService and blocks on INV_STOCK_002 / SERIAL_REQUIRED_001.
   * For service products (memberships) the canonical service skips the
   * deduction automatically, so the order simply finishes. `meta` is merged
   * into the state-change metadata (persisted in internal_notes._flow_metadata).
   */
  async finishOrder(orderId: number, meta?: Record<string, any>) {
    const order = await this.getOrder(orderId);
    this.validateTransition(order.state as OrderState, 'finished');
    const updatedOrder = await this.updateOrderState(orderId, 'finished', {
      finished_at: new Date(),
      ...(meta ?? {}),
    });
    this.logger.log(`Order #${orderId} finished via finishOrder()`);
    return updatedOrder;
  }

  /**
   * SINGLE SOURCE OF TRUTH: reconcile an order's `state` from the current
   * state of its dispatch notes (order ↔ remisión unification).
   *
   * The COD / delivery lifecycle is driven by the remisiones linked to an
   * order: as notes are confirmed and delivered (in a route or standalone),
   * the order state must follow. This method DERIVES the target state from the
   * notes + balance + open-route context and walks the monotonic ladder
   * ({@link RECONCILE_LADDER}) up to it, calling {@link updateOrderState} for
   * each valid edge. It NEVER moves the order backward
   * (`finalRank = max(current, cappedTarget)`).
   *
   * MUST run POST-COMMIT: it does not receive a `tx` and must never be called
   * inside another interactive `$transaction` — `updateOrderState` opens its
   * own transaction for the `finished` stock commit and emits side-effect
   * events only after that commit. The caller is expected to establish the
   * store context (e.g. `StoreContextRunner.runInStoreContext`); every read
   * and write here is additionally pinned with an explicit `store_id` for
   * defense-in-depth tenant isolation.
   *
   * Derivation (all inputs scoped to `store_id`):
   *   - `delivery_type ∈ {direct_delivery, dine_in}` → NO-OP (these never
   *     reconcile from a remisión).
   *   - Current state NOT on the ladder (draft/created/cancelled/refunded)
   *     → NO-OP.
   *   - `N` = non-voided dispatch notes of the order. `|N| == 0` → NO-OP.
   *   - `fulfilled(n)` = status ∈ {delivered, invoiced}; `allFulfilled`,
   *     `anyFulfilled`. `anyDispatched` = status ∈ {confirmed, delivered,
   *     invoiced}. `balanceZero` = remaining_balance ≤ 0.01.
   *       · allFulfilled && balanceZero          → finished
   *       · allFulfilled && !balanceZero         → delivered
   *       · anyFulfilled && !allFulfilled        → shipped
   *       · !anyFulfilled && anyDispatched       → shipped
   *       · only drafts (none dispatched)        → NO-OP
   *   - Cap when an OPEN route (draft/dispatched/in_transit) still holds any of
   *     the notes: `on_close` → cap at `shipped`; `live` → cap at `delivered`.
   *     No open route → no cap.
   *
   * Best-effort: any failure is logged and swallowed (never rethrown), mirroring
   * the dispatch-route COD listener — a reconciliation glitch must not break the
   * upstream settlement flow.
   */
  async reconcileOrderFromDispatch(
    order_id: number,
    store_id: number,
  ): Promise<void> {
    try {
      const order = await this.prisma.orders.findFirst({
        where: { id: order_id, store_id },
        select: {
          id: true,
          state: true,
          delivery_type: true,
          remaining_balance: true,
        },
      });

      if (!order) {
        this.logger.debug(
          `[reconcileOrderFromDispatch] order #${order_id} not found in store #${store_id} — NO-OP`,
        );
        return;
      }

      // Delivery types that never derive their state from a remisión.
      if (
        order.delivery_type === 'direct_delivery' ||
        order.delivery_type === 'dine_in'
      ) {
        return;
      }

      const currentState = order.state as OrderState;
      const currentRank = RECONCILE_LADDER.indexOf(currentState);
      if (currentRank === -1) {
        // draft / created / cancelled / refunded: not on the ladder.
        this.logger.debug(
          `[reconcileOrderFromDispatch] order #${order_id} in non-ladder state '${currentState}' — NO-OP`,
        );
        return;
      }

      // N = non-voided dispatch notes of this order (store-scoped).
      const notes = await this.prisma.dispatch_notes.findMany({
        where: { order_id, store_id, status: { not: 'voided' } },
        select: { id: true, status: true },
      });
      if (notes.length === 0) {
        // Cero remisiones activas que respalden la orden. Si está en un peldaño
        // derivado-de-despacho (shipped/delivered/finished), la fuente-de-verdad
        // de despacho dice "no hay despacho" → revertir al piso pre-despacho.
        // Este es el ÚNICO caso donde el reconciliador retrocede, y sólo puede
        // dispararse al anular la última remisión (las demás rutas siempre
        // entran con notes>0), por lo que no introduce downgrades espurios. Va
        // por updateOrderState directo (sin validateTransition) para no tener que
        // abrir 'shipped'→'processing' en VALID_TRANSITIONS. Idempotente: una
        // segunda corrida ve la orden ya en el piso (currentRank == floorRank) →
        // NO-OP.
        const balanceZero = Number(order.remaining_balance) <= 0.01;
        const floorState: OrderState = balanceZero
          ? 'processing'
          : 'pending_payment';
        const floorRank = RECONCILE_LADDER.indexOf(floorState);
        const shippedRank = RECONCILE_LADDER.indexOf('shipped');
        if (currentRank >= shippedRank && currentRank > floorRank) {
          await this.updateOrderState(
            order_id,
            floorState,
            {
              reverted_from_dispatch: true,
              reverted_at: new Date().toISOString(),
            },
            { source: 'listener' },
          );
          this.logger.log(
            `[reconcileOrderFromDispatch] order #${order_id} reverted '${currentState}' → '${floorState}' (no active remisión) (store #${store_id})`,
          );
        }
        return;
      }

      const isFulfilled = (s: string) => s === 'delivered' || s === 'invoiced';
      const isDispatched = (s: string) =>
        s === 'confirmed' || s === 'delivered' || s === 'invoiced';

      const allFulfilled = notes.every((n) => isFulfilled(n.status));
      const anyFulfilled = notes.some((n) => isFulfilled(n.status));
      const anyDispatched = notes.some((n) => isDispatched(n.status));
      const balanceZero = Number(order.remaining_balance) <= 0.01;

      let target: OrderState | null = null;
      if (allFulfilled && balanceZero) {
        target = 'finished';
      } else if (allFulfilled && !balanceZero) {
        target = 'delivered';
      } else if (anyFulfilled && !allFulfilled) {
        target = 'shipped';
      } else if (!anyFulfilled && anyDispatched) {
        target = 'shipped';
      } else {
        // Only drafts (nothing dispatched yet) → nothing to reconcile.
        return;
      }

      let cappedRank = RECONCILE_LADDER.indexOf(target);

      // Cap by mode only while an OPEN route still holds any of these notes.
      const openRouteStop = await this.prisma.dispatch_route_stops.findFirst({
        where: {
          dispatch_note_id: { in: notes.map((n) => n.id) },
          route: {
            store_id,
            status: { in: ['draft', 'dispatched', 'in_transit'] },
          },
        },
        select: { id: true },
      });

      if (openRouteStop) {
        const mode = await this.readOrderStateUpdateMode(store_id);
        const capRank =
          mode === 'live'
            ? RECONCILE_LADDER.indexOf('delivered')
            : RECONCILE_LADDER.indexOf('shipped');
        cappedRank = Math.min(cappedRank, capRank);
      }

      const finalRank = Math.max(currentRank, cappedRank);
      if (finalRank <= currentRank) {
        // Monotonic: never move backward and nothing new to advance.
        return;
      }

      // Walk the ladder rung-by-rung; every consecutive edge is valid.
      for (let rank = currentRank + 1; rank <= finalRank; rank++) {
        const from = RECONCILE_LADDER[rank - 1];
        const to = RECONCILE_LADDER[rank];
        this.validateTransition(from, to);
        await this.updateOrderState(
          order_id,
          to,
          {
            reconciled_from_dispatch: true,
            reconciled_at: new Date().toISOString(),
            ...(to === 'finished' ? { finished_at: new Date() } : {}),
          },
          { source: 'listener' },
        );
      }

      this.logger.log(
        `[reconcileOrderFromDispatch] order #${order_id} reconciled '${currentState}' → '${RECONCILE_LADDER[finalRank]}' (store #${store_id})`,
      );
    } catch (error) {
      // Best-effort mirror of the COD listener: never break the caller.
      this.logger.error(
        `[reconcileOrderFromDispatch] failed for order #${order_id} (store #${store_id}): ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Read the store's `dispatch.order_state_update_mode` in a tenant-safe,
   * decoupled way (accepts an explicit `store_id`, does NOT depend on the
   * request context — the reconciler may run post-commit outside a request).
   * Mirrors `RouteFlowService.getOrderStateUpdateMode`: `findFirst` (never
   * `findUnique`, which breaks under the scope merge) and defaults to the
   * legacy `'on_close'` when the key or the row is missing. A read failure must
   * NEVER break reconciliation, so it also falls back to `'on_close'`.
   */
  private async readOrderStateUpdateMode(
    store_id: number,
  ): Promise<'live' | 'on_close'> {
    try {
      const row = await this.prisma.store_settings.findFirst({
        where: { store_id },
        select: { settings: true },
      });
      const settings = (row?.settings ?? {}) as {
        dispatch?: { order_state_update_mode?: 'live' | 'on_close' };
      };
      return settings.dispatch?.order_state_update_mode === 'live'
        ? 'live'
        : 'on_close';
    } catch {
      return 'on_close';
    }
  }

  /**
   * Shared COD payment helper (dispatch route AND standalone dispatch note).
   *
   * Extracted from `PaymentFromDispatchRouteListener.applyCodPayment` so both
   * the route-settlement bridge and the standalone dispatch-note flow clear a
   * COD balance the SAME way. It:
   *   1. Resolves the REAL `orders.id` from `dispatch_notes.order_id`. If the
   *      note has no linked order (legacy sales_order flow) it is a NO-OP.
   *   2. Is IDEMPOTENT by the parameterized correlation key
   *      (`gateway_reference`): the route uses `dispatch_route_stop:{stop_id}`,
   *      the standalone flow uses `dispatch_note:{dispatch_note_id}`. If a
   *      payment with that key already exists, it is a NO-OP.
   *   3. Records a `payments` row and decrements `orders.remaining_balance`
   *      (clamped at 0), mirroring `registerCreditPayment`.
   *
   * It DOES NOT transition `orders.state` (that is the reconciler's job) and
   * does NOT emit an extra `payment.received` event (avoids double accounting).
   * Every read/write is pinned with an explicit `store_id`.
   */
  async applyDispatchCodPayment(input: {
    storeId: number;
    dispatchNoteId: number;
    amount: number;
    correlationKey: string;
    stopId?: number;
    currency?: string;
    paymentMethod?: string;
    /**
     * Origen del `order_events`. Los dos llamadores reales son listeners
     * (`DispatchNoteEventsListener` y `PaymentFromDispatchRouteListener`),
     * así que el default es `'listener'`; un llamador HTTP futuro debe
     * pasarlo explícito.
     */
    source?: OrderEventSource;
  }): Promise<void> {
    // 1. Resolve the REAL COD order id from the dispatch note (store-scoped).
    const dispatchNote = await this.prisma.dispatch_notes.findFirst({
      where: { id: input.dispatchNoteId, store_id: input.storeId },
      select: { order_id: true },
    });

    const orderId = dispatchNote?.order_id ?? null;
    if (!orderId) {
      // Legacy sales_order flow (no COD order linked) — nothing to settle here.
      this.logger.debug(
        `[applyDispatchCodPayment] dispatch_note #${input.dispatchNoteId} has no order_id — NO-OP (${input.correlationKey})`,
      );
      return;
    }

    // 2. Idempotency guard: bail if a payment for this correlation key exists.
    const existing = await this.prisma.payments.findFirst({
      where: { gateway_reference: input.correlationKey },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `[applyDispatchCodPayment] Payment already registered for ${input.correlationKey} (payment #${existing.id}) — NO-OP`,
      );
      return;
    }

    // 3. Load the COD order (scope merges orders.store_id via direct field).
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, store_id: input.storeId },
      select: {
        id: true,
        currency: true,
        total_paid: true,
        remaining_balance: true,
        customer_id: true,
        stores: { select: { organization_id: true } },
      },
    });
    if (!order) {
      this.logger.warn(
        `[applyDispatchCodPayment] COD order #${orderId} not found in store #${input.storeId} — skipped (${input.correlationKey})`,
      );
      return;
    }

    const remaining = Number(order.remaining_balance);
    const applied = Math.min(input.amount, Math.max(remaining, 0));
    const newRemaining = Math.max(remaining - input.amount, 0);
    const newTotalPaid = Number(order.total_paid) + applied;

    // 4. Record the payment row + decrement the balance, mirroring
    //    registerCreditPayment. payments has no store_id column (scoped via the
    //    orders relation), so order_id is sufficient for tenant isolation.
    //
    //    Plan order-truth-and-invoice-tz — payment row, balance and its
    //    `payment_registered` share ONE transaction: if any of the three
    //    fails, none persists (the event never outlives its payment). This
    //    helper never transitions `orders.state` (the reconciler does), so
    //    no `state_changed` is recorded here.
    const paymentMethod = input.paymentMethod ?? 'cash';
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payments.create({
        data: {
          order_id: order.id,
          customer_id: order.customer_id ?? undefined,
          amount: applied,
          currency: input.currency ?? order.currency ?? 'COP',
          state: 'succeeded',
          gateway_reference: input.correlationKey,
          paid_at: new Date(),
          gateway_response: {
            payment_type:
              input.stopId != null ? 'dispatch_route' : 'dispatch_note',
            dispatch_note_id: input.dispatchNoteId,
            stop_id: input.stopId ?? null,
            payment_method: paymentMethod,
            collected_amount: input.amount,
          },
        },
      });

      await tx.orders.updateMany({
        where: { id: order.id, store_id: input.storeId },
        data: {
          total_paid: Math.round(newTotalPaid * 100) / 100,
          remaining_balance: Math.round(newRemaining * 100) / 100,
        },
      });

      await this.orderHistoryService?.record(tx, {
        orderId: order.id,
        storeId: input.storeId,
        organizationId: order.stores?.organization_id ?? null,
        type: 'payment_registered',
        paymentId: payment.id,
        amount: applied,
        source: input.source ?? 'listener',
        payload: {
          payment_method: paymentMethod,
          correlation_key: input.correlationKey,
          dispatch_note_id: input.dispatchNoteId,
          stop_id: input.stopId ?? null,
        },
      });
    });

    this.logger.log(
      `[applyDispatchCodPayment] COD order #${order.id} settled via ${input.correlationKey}: applied=${applied} remaining=${
        Math.round(newRemaining * 100) / 100
      }`,
    );
  }

  /**
   * Cancel an order (from created, pending_payment, or processing).
   *
   * Concurrency-safe (BUG-3): the state guard is enforced by an ATOMIC
   * conditional UPDATE (claim-once pattern, mirrors
   * OrderStockCommitService:361) instead of a check-then-act read. Two
   * concurrent cancellations can both pass the cheap fast-path guard, but only
   * ONE wins the conditional UPDATE (count=1) and runs the one-shot effects
   * pipeline; the loser matches 0 rows and aborts with the SAME error, never
   * double-running the pipeline (double payment-cancel / double release / double
   * event). The claim + payment-cancel + metadata write share ONE
   * $transaction (pattern of reactivateOrder) so they commit atomically; the
   * order.status_changed event is emitted only AFTER commit with the REAL
   * previous state.
   *
   * `force` (ver {@link forceOrderState}) saltea las dos precondiciones de
   * estado — `CANCELABLE_STATES` y la arista de la máquina de estados — para
   * permitir cancelar desde estados avanzados (p. ej. una orden `delivered` que
   * el operador necesita anular). NO relaja la atomicidad: el claim conserva su
   * WHERE condicional, solo que anclado al estado leído en vez de a la lista
   * canónica, así que dos cancelaciones concurrentes siguen resolviéndose con
   * un único ganador y la cadena de efectos (cancelar pagos, liberar reservas,
   * emitir `order.status_changed`) sigue corriendo exactamente una vez.
   *
   * Ramificación KDS (platos preparados, espejo de {@link cancelOrderItem}):
   * los ítems `prepared` + disparados se clasifican por el estado latest del
   * ticket — `pending` se auto-cancela in-tx (con relectura TOCTOU) y
   * `in_preparation`/`ready`/`delivered` (o fired sin ticket pendiente)
   * exigen `dto.kitchenDisposition` (422 si falta): `reuse` revierte los
   * insumos consumidos al fire y `waste` los deja como merma. La decisión se
   * valida ANTES del claim para no dejar la orden en `cancelled` sin
   * decisión registrada. `force` aplica la misma ramificación.
   */
  async cancelOrder(orderId: number, dto: CancelOrderDto, force = false) {
    const order = await this.getOrder(orderId);
    assertNoActiveFinancialSplit(order);
    await this.assertNoOpenTableForDraft(order);
    let previousState = order.state as OrderState;

    const notCancelableError = () =>
      new VendixHttpException(
        ErrorCodes.ORD_STATUS_001,
        `Cannot cancel order in state '${previousState}'. ` +
          `Cancellation is only allowed from: [${CANCELABLE_STATES.join(', ')}]`,
        { state: previousState },
      );

    // Estados que el claim atómico acepta. Forzando es exactamente el estado
    // que acabamos de leer: sigue siendo un WHERE condicional (el perdedor de
    // una carrera encuentra 'cancelled' y no coincide), no un UPDATE ciego.
    let claimableStates: OrderState[] = force
      ? [previousState]
      : CANCELABLE_STATES;

    // Fast-path guard — clean error for the common (non-race) case without
    // opening a transaction. The authoritative guard is the atomic claim below.
    if (!force && !CANCELABLE_STATES.includes(previousState)) {
      throw notCancelableError();
    }

    // State-machine edge check (cancelled is a valid target from every
    // CANCELABLE_STATE) — preserved from the original flow.
    if (!force) {
      this.validateTransition(previousState, 'cancelled');
    }

    // KDS pre-clasificación (ANTES del claim): un 422 por decisión faltante
    // no debe dejar la orden en 'cancelled' sin decisión registrada. Espejo
    // de `cancelOrderItem` §§4-5, pero a nivel orden: solo los ítems
    // `prepared` + disparados ramifican; los no disparados no se tocan y los
    // ya cancelados conservan su primera cancelación (idempotencia).
    const kitchenItems = await this.prisma.order_items.findMany({
      where: { order_id: orderId },
      select: {
        id: true,
        inventory_consumed_at_fire: true,
        cancelled_at: true,
        products: { select: { product_type: true } },
        kitchen_ticket_items: {
          orderBy: { id: 'desc' },
          select: {
            kitchen_ticket_id: true,
            kitchen_ticket: { select: { id: true, status: true } },
          },
        },
      },
    });
    const kitchenBranch = new Map<
      number,
      { branch: 'ignore' | 'pending' | 'advanced'; ticketId: number | null }
    >();
    let needsDisposition = false;
    let needsKds = false;
    for (const item of kitchenItems) {
      const isPreparedFired =
        item.cancelled_at == null &&
        item.inventory_consumed_at_fire === true &&
        item.products?.product_type === 'prepared';
      if (!isPreparedFired) {
        kitchenBranch.set(item.id, { branch: 'ignore', ticketId: null });
        continue;
      }
      const latest = item.kitchen_ticket_items[0] ?? null;
      const ticketStatus = latest?.kitchen_ticket?.status ?? null;
      const ticketId =
        latest?.kitchen_ticket?.id ?? latest?.kitchen_ticket_id ?? null;
      if (ticketStatus === 'pending' && ticketId != null) {
        kitchenBranch.set(item.id, { branch: 'pending', ticketId });
        needsKds = true;
      } else {
        kitchenBranch.set(item.id, { branch: 'advanced', ticketId });
        needsDisposition = true;
      }
    }

    if (
      needsDisposition &&
      dto.kitchenDisposition !== 'reuse' &&
      dto.kitchenDisposition !== 'waste'
    ) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'La orden tiene platos ya avanzados en cocina: indica kitchenDisposition (reuse o waste) para cancelar',
      );
    }

    // El KDS es obligatorio solo si hay tickets `pending` que auto-cancelar
    // (un huérfano dejaría al cocinero cocinando un plato cancelado). Falla
    // fuerte si el DI no lo cableó — nunca se salta en silencio.
    const kds = this.kitchenFireService;
    if (needsKds && !kds) {
      throw new InternalServerErrorException(
        'KitchenFireService no disponible en OrderFlowService (revisar imports de OrderFlowModule)',
      );
    }

    // Egreso de caja (PRE-LECTURA, fuera de la transacción — patrón
    // `settleStop`): cancelar una venta ya COBRADA EN EFECTIVO devuelve el
    // dinero al cliente, así que el billete sale del cajón y la sesión de caja
    // tiene que reflejarlo. Sin este egreso, el arqueo del cierre reporta un
    // faltante sin causa: `expected_cash_total` siguió contando la venta
    // (`computeCashSummary`, sessions.service.ts:740) que ya se devolvió.
    //
    // `createRefund` NO es reutilizable para esto: `CANCELABLE_STATES`
    // (created/pending_payment/processing) y `REFUNDABLE_STATES`
    // (delivered/finished) son conjuntos DISJUNTOS, así que la llamada moriría
    // en 400 antes de tocar caja.
    //
    // Se clasifica ANTES del claim (la transacción sólo persiste) y se escribe
    // DESPUÉS del commit: un egreso escrito dentro de la tx quedaría huérfano
    // si el claim perdiera la carrera o la rama KDS abortara con 422.
    let cashReversal: Awaited<ReturnType<OrderFlowService['resolveCancelCashReversal']>> = null;
    let cancellationRefund: Awaited<ReturnType<RefundFlowService['recordCancellationCashRefund']>> | null = null;

    // Build cancel metadata exactly as updateOrderState would: `orders` has no
    // cancelled_at/cancellation_reason columns, so these + previous_state live
    // in internal_notes._flow_metadata (reactivateOrder reads previous_state
    // back). Merge with any pre-existing _flow_metadata.

    // CLAIM + payment-cancel + KDS/item branch + metadata write share ONE
    // transaction so they commit atomically (pattern of reactivateOrder).
    const cancelledTicketIds: number[] = [];
    const updatedTicketIds: number[] = [];
    const preparedStockAfterCommit: Array<() => void> = [];
    const preparedDispositions: Array<{
      itemId: number;
      disposition: 'reuse' | 'waste';
      leaves: ConsumedLeafDisposition[];
    }> = [];
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      await lockOrderLifecycle(tx, orderId, order.store_id);
      const freshOrder = await this.getOrder(orderId, tx);
      await this.assertNoOpenTableForDraft(freshOrder, tx);
      // ADR-12: la reversa pendiente ya no bloquea cancelOrder — cada pierna
      // recibida (`succeeded`/`captured`) no-efectivo deriva abajo a un
      // reembolso `requested` y el pago original queda como hecho histórico.
      // Solo el bloqueo de inventario/entrega sigue siendo fatal aquí;
      // `cancelPayment` exige piernas directas y sin factura emitida, pero
      // NUNCA lo bloquea el stock (regla del dueño).
      const cancelBlocker = getCancellationBlocker(freshOrder);
      if (cancelBlocker !== null && cancelBlocker !== 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001') {
        throw new VendixHttpException(ErrorCodes[cancelBlocker]);
      }
      // Gate DIAN (antes de mutar): factura electrónica aceptada sin su nota
      // crédito aceptada bloquea con 409 tipado — precondición, no efecto.
      await this.assertNoBlockingFiscalInvoice(tx, orderId, freshOrder.store_id);
      // ADR-12: el único liquidado que cancelOrder NO deriva solo es
      // `partially_refunded` — una reversa parcial ya movió parte del dinero
      // por el carril de reembolso y aquí no se sabe cuánto resta: crear una
      // pierna por el total duplicaría lo ya devuelto. ERR-38 conserva su rol
      // de "derivar al reembolso" para ese caso. `captured` (dinero recibido
      // por pasarela, igual que `succeeded` para el webhook) genera su
      // `requested` abajo; `refunded` se salta — su dinero ya volvió por su
      // propio carril y bloquearlo dejaría al operador sin salida.
      const externallyDerived = freshOrder.payments.filter((payment) =>
        payment.state === 'partially_refunded',
      );
      if (externallyDerived.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001,
          'La orden tiene pagos con reembolso parcial en curso: ciérralos en el flujo de reembolso antes de cancelar.',
          { payment_ids: externallyDerived.map((payment) => payment.id) },
        );
      }
      previousState = freshOrder.state as OrderState;
      claimableStates = force ? [previousState] : CANCELABLE_STATES;
      let existingMetadata: Record<string, any> = {};
      if (freshOrder.internal_notes) {
        try {
          const parsed = JSON.parse(freshOrder.internal_notes);
          if (parsed._flow_metadata) {
            existingMetadata = parsed._flow_metadata;
          }
        } catch {
          existingMetadata = { original_notes: freshOrder.internal_notes };
        }
      }
      const internal_notes = JSON.stringify({
        _flow_metadata: {
          ...existingMetadata,
          cancelled_at: new Date(),
          cancellation_reason: dto.reason,
          // Persist the previous state so reactivateOrder() can restore it.
          previous_state: previousState,
        },
        notes: existingMetadata.original_notes || '',
      });
      cashReversal = await this.resolveCancelCashReversal(freshOrder, tx);
      const nonCashLegs = await this.resolveCancelNonCashLegs(freshOrder, tx);
      const nonCashIds = new Set(nonCashLegs.map((leg) => leg.payment_id));
      // ADR-12: la guarda es cash-only — un recibido (`succeeded`/`captured`)
      // no-efectivo sin reversa ya no es un error (genera su `requested`
      // abajo); solo falla si EXISTE efectivo liquidado y no se pudo
      // resolver su monto.
      const cashSucceededIds = freshOrder.payments
        .filter(
          (payment) =>
            (payment.state === 'succeeded' || payment.state === 'captured') &&
            !nonCashIds.has(payment.id),
        )
        .map((payment) => payment.id);
      if (cashSucceededIds.length > 0 && !cashReversal) {
        throw new VendixHttpException(
          ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001,
          'No se pudo verificar el monto del pago en efectivo; concilia el cobro antes de cancelar.',
        );
      }
      // Partición completa: todo recibido (`succeeded`/`captured`) está en el
      // cash-out o en una pierna. Un huérfano (p. ej. `captured` con canal
      // efectivo, imposible por código) falla cerrado en vez de perderse.
      const coveredIds = new Set<number>([
        ...(cashReversal?.paymentIds ?? []),
        ...nonCashIds,
      ]);
      const orphanIds = freshOrder.payments
        .filter(
          (payment) =>
            (payment.state === 'succeeded' || payment.state === 'captured') &&
            !coveredIds.has(payment.id),
        )
        .map((payment) => payment.id);
      if (orphanIds.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001,
          'No se pudo clasificar un cobro recibido para su devolución; concilia el cobro antes de cancelar.',
          { payment_ids: orphanIds },
        );
      }
      if (cashReversal) {
        if (!this.refundFlowService) {
          throw new InternalServerErrorException('RefundFlowService no disponible para documentar la devolución en efectivo');
        }
        cancellationRefund = await this.refundFlowService.recordCancellationCashRefund(
          tx, freshOrder, cashReversal.paymentIds, cashReversal.amount, dto.reason,
        );
      }
      // ADR-12: CxC fiada — anula el saldo no cobrado y convierte cada abono
      // real en pierna de reembolso. Los abonos cobrados por un pago que ya
      // genera pierna propia (o cash-out) no duplican: el pago manda.
      const coveredPaymentIds = new Set<number>([
        ...nonCashLegs.map((leg) => leg.payment_id),
        ...(cashReversal?.paymentIds ?? []),
      ]);
      const arLegs = await this.voidOrderCreditBalances(tx, freshOrder, dto.reason, coveredPaymentIds);
      const pendingLegs: CancellationPendingLeg[] = [
        ...nonCashLegs.map((leg) => ({
          payment_id: leg.payment_id,
          amount: leg.amount,
          method_label: `pago #${leg.payment_id} (${leg.method_type ?? 'método desconocido'})`,
        })),
        ...arLegs,
      ];
      if (pendingLegs.length > 0) {
        if (!this.refundFlowService) {
          throw new InternalServerErrorException('RefundFlowService no disponible para documentar los reembolsos pendientes de la cancelación');
        }
        await this.refundFlowService.recordCancellationPendingRefunds(
          tx,
          freshOrder,
          pendingLegs,
          dto.reason,
          cashReversal ? cashReversal.amount : new Prisma.Decimal(0),
        );
      }
      // ATOMIC CLAIM — the conditional UPDATE is the source of truth that
      // serializes concurrent cancellations (double-click / retry). Only ONE
      // request flips the state out of CANCELABLE_STATES (count=1); a
      // concurrent request blocks on the row lock, re-evaluates the WHERE
      // (state is now 'cancelled' ∉ CANCELABLE_STATES) and matches 0 rows →
      // aborts here WITHOUT running the effects below.
      const claim = await tx.orders.updateMany({
        where: { id: orderId, state: { in: claimableStates } },
        data: { state: 'cancelled', updated_at: new Date() },
      });
      if (claim.count === 0) {
        throw notCancelableError();
      }

      await this.orderHistoryService?.record(tx, {
        orderId,
        storeId: freshOrder.store_id,
        organizationId: freshOrder.stores?.organization_id,
        type: 'state_changed',
        fromState: previousState,
        toState: 'cancelled',
      });

      // Winner (ADR-12, cash-only): cancel pending attempts plus the
      // succeeded CASH legs the cash-out just returned — the same SQL-verified
      // set, never the include. Non-cash received rows (`succeeded`/`captured`)
      // stay as the historical fact; their return travels in the `requested`
      // refunds. `captured` never flips here even if its channel were cash.
      const cashIds = new Set(cashReversal?.paymentIds ?? []);
      const activePayments = freshOrder.payments.filter(
        (p) => p.state === 'pending' || (p.state === 'succeeded' && cashIds.has(p.id)),
      );
      for (const payment of activePayments) {
        await tx.payments.update({
          where: { id: payment.id },
          data: { state: 'cancelled', updated_at: new Date() },
        });
      }

      // Ramificación KDS por ítem (espejo de `cancelOrderItem` in-tx):
      // - `pending` → cancela el ticket y devuelve el insumo aún sin usar.
      // - `advanced` → exige la decisión (422 aborta el tx y el claim hace
      //   rollback); `reuse` revierte cada consumo del ítem, `waste` no.
      for (const item of kitchenItems) {
        const meta = kitchenBranch.get(item.id);
        if (!meta || meta.branch === 'ignore') {
          continue;
        }

        if (meta.branch === 'pending' && meta.ticketId != null) {
          // TOCTOU guard: el cocinero pudo avanzar el ticket entre la
          // pre-lectura y este tx. Releer y revalidar dentro del tx.
          const freshTicket = await tx.kitchen_tickets.findFirst({
            where: { id: meta.ticketId },
            select: { status: true },
          });
          if (freshTicket && freshTicket.status === 'pending') {
            if (!kds) {
              throw new InternalServerErrorException(
                'KitchenFireService no disponible en OrderFlowService (revisar imports de OrderFlowModule)',
              );
            }
            const result = await kds.cancelTicketItemInTx(tx, meta.ticketId, item.id);
            if (result === 'cancelled') cancelledTicketIds.push(meta.ticketId);
            else updatedTicketIds.push(meta.ticketId);
            const leaves = await this.disposeConsumedPreparedLeaves(
              tx, orderId, item.id, Number(freshOrder.stores?.organization_id),
              'reuse', dto.reason.trim(), preparedStockAfterCommit, meta.ticketId,
            );
            await this.auditPreparedDispositionInTx(
              tx, orderId, item.id, Number(freshOrder.stores?.organization_id),
              freshOrder.store_id, dto.reason.trim(), 'reuse', leaves, meta.ticketId,
            );
            preparedDispositions.push({ itemId: item.id, disposition: 'reuse', leaves });
            await tx.order_items.update({
              where: { id: item.id },
              data: {
                cancelled_at: new Date(),
                cancellation_reason: dto.reason.trim(),
                cancellation_type: 'after_fire_reused',
                updated_at: new Date(),
              },
            });
            // Plan order-truth-and-invoice-tz — un `item_cancelled` por
            // ítem cancelado en cascada (mismo shape que `cancelOrderItem`
            // + `cascade: true`). El `state_changed` de la orden ya se
            // registró tras el claim; no se duplica.
            await this.orderHistoryService?.record(tx, {
              orderId,
              storeId: freshOrder.store_id,
              organizationId: freshOrder.stores?.organization_id,
              type: 'item_cancelled',
              orderItemId: item.id,
              payload: {
                reason: dto.reason.trim(),
                cancellation_type: 'after_fire_reused',
                cascade: true,
              },
            });
            continue;
          }
          // El ticket ya no está pending: cae a la rama avanzada (la
          // decisión ya se validó pre-claim; si falta, el 422 de abajo
          // aborta el tx y el claim hace rollback).
        }

        const disposition = dto.kitchenDisposition;
        if (disposition !== 'reuse' && disposition !== 'waste') {
          throw new VendixHttpException(
            ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
            'La orden tiene platos ya avanzados en cocina: indica kitchenDisposition (reuse o waste) para cancelar',
          );
        }
        const cancellationType =
          disposition === 'reuse' ? 'after_fire_reused' : 'after_fire_waste';

        if (meta.ticketId != null) {
          const currentKdsItem = await tx.kitchen_ticket_items.findFirst({
            where: { kitchen_ticket_id: meta.ticketId, order_item_id: item.id },
            orderBy: { id: 'desc' },
            select: { status: true },
          });
          if (currentKdsItem?.status === 'in_preparation' || currentKdsItem?.status === 'ready') {
            if (!kds) {
              throw new InternalServerErrorException('KitchenFireService no disponible para cancelar el plato en cocina');
            }
            const result = await kds.cancelTicketItemInTx(tx, meta.ticketId, item.id, currentKdsItem.status);
            if (result === 'cancelled') cancelledTicketIds.push(meta.ticketId);
            else updatedTicketIds.push(meta.ticketId);
          }
        }

        const leaves = await this.disposeConsumedPreparedLeaves(
          tx, orderId, item.id, Number(freshOrder.stores?.organization_id),
          disposition, dto.reason.trim(), preparedStockAfterCommit, meta.ticketId,
        );
        await this.auditPreparedDispositionInTx(
          tx, orderId, item.id, Number(freshOrder.stores?.organization_id),
          freshOrder.store_id, dto.reason.trim(), disposition, leaves, meta.ticketId,
        );
        preparedDispositions.push({ itemId: item.id, disposition, leaves });

        await tx.order_items.update({
          where: { id: item.id },
          data: {
            cancelled_at: new Date(),
            cancellation_reason: dto.reason.trim(),
            cancellation_type: cancellationType,
            updated_at: new Date(),
          },
        });
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: freshOrder.store_id,
          organizationId: freshOrder.stores?.organization_id,
          type: 'item_cancelled',
          orderItemId: item.id,
          payload: {
            reason: dto.reason.trim(),
            cancellation_type: cancellationType,
            cascade: true,
          },
        });
      }

      // Sincronía cancelado orden↔cocina: con la orden cancelada NINGUNA fila
      // KDS puede seguir viva ni `delivered` (líneas no `prepared`, tickets ya
      // entregados y cualquier fila que las ramas de arriba no cubrieran).
      // Los tickets con filas vivas pasan a `cancelled` y se emiten post-commit.
      const liveKdsRows = await tx.kitchen_ticket_items.findMany({
        where: {
          kitchen_ticket: { order_id: orderId },
          status: { not: 'cancelled' },
        },
        select: { kitchen_ticket_id: true },
      });
      if (liveKdsRows.length > 0) {
        const sweepTicketIds: number[] = [...new Set<number>(liveKdsRows.map((r) => r.kitchen_ticket_id as number))];
        await tx.kitchen_ticket_items.updateMany({
          where: { kitchen_ticket_id: { in: sweepTicketIds }, status: { not: 'cancelled' } },
          data: { status: 'cancelled', updated_at: new Date() },
        });
        await tx.kitchen_tickets.updateMany({
          where: { id: { in: sweepTicketIds }, status: { not: 'cancelled' } },
          data: { status: 'cancelled', updated_at: new Date() },
        });
        for (const id of sweepTicketIds) {
          if (!cancelledTicketIds.includes(id)) cancelledTicketIds.push(id);
        }
      }

      // Persist cancel metadata (state/updated_at were already set by the
      // claim) and return the fully-included order (same shape updateOrderState
      // returned).
      return tx.orders.update({
        where: { id: orderId },
        data: { internal_notes, updated_at: new Date() },
        include: {
          stores: { select: { id: true, name: true, store_code: true } },
          order_items: { include: { products: true, product_variants: true } },
          payments: true,
        },
      });
    });

    for (const publish of preparedStockAfterCommit) publish();
    for (const entry of preparedDispositions) {
      await this.postPreparedDispositionAfterCommit(
        orderId, entry.itemId, Number(order.stores?.organization_id),
        order.store_id, entry.disposition, entry.leaves,
      );
    }

    // Post-commit best-effort: `ticket.cancelled` por cada ticket KDS
    // auto-cancelado in-tx (espejo de `cancelOrderItem`; el helper ya es
    // best-effort interno, se envuelve igual por simetría).
    if (kds) {
      for (const ticketId of new Set(cancelledTicketIds)) {
        try {
          await kds.emitTicketCancelledEvent(ticketId);
        } catch (err) {
          this.logger.warn(
            `Failed to emit ticket.cancelled for ticket #${ticketId}: ${
              (err as Error).message
            }`,
          );
        }
      }
      for (const ticketId of new Set(updatedTicketIds)) {
        if (!cancelledTicketIds.includes(ticketId)) {
          await kds.emitTicketUpdatedEvent(ticketId);
        }
      }
    }

    // Release reserved stock by reference — kept OUTSIDE the transaction and
    // best-effort (exactly as before): a release failure must never abort a
    // cancellation, and swallowing a DB error INSIDE a Postgres tx would poison
    // it (aborted-transaction). Runs exactly once because only the claim winner
    // reaches this point.
    try {
      await this.stockLevelManager.releaseReservationsByReference(
        'order',
        orderId,
        'cancelled',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to release stock for cancelled order #${orderId}: ${error.message}`,
      );
    }

    // Emitted AFTER commit (never on rollback) with the REAL previous state,
    // mirroring updateOrderState's order.status_changed.
    this.eventEmitter.emit('order.status_changed', {
      store_id: updatedOrder.store_id,
      order_id: orderId,
      order_number: order.order_number,
      old_state: previousState,
      new_state: 'cancelled',
    });

    // Compensación post-commit: la orden ya está `cancelled`, así que el egreso
    // nunca queda colgado de una cancelación que hizo rollback.
    if (cashReversal) {
      const cashOutRecorded = await this.registerCancelCashOut(
        orderId,
        order.order_number,
        dto.reason,
        cashReversal,
      );
      const committedRefund = cancellationRefund as Awaited<ReturnType<RefundFlowService['recordCancellationCashRefund']>> | null;
      if (committedRefund && cashOutRecorded) {
        try {
          await this.refundFlowService!.completeCancellationCashRefund(committedRefund.refund.id);
          await this.refundFlowService!.emitCancellationCashRefund(order, committedRefund);
        } catch (error) {
          this.logger.error(`Order #${orderId}: refund accounting event failed`, (error as Error).stack);
        }
      }
    }

    this.logger.log(
      `Order #${orderId} cancelled: ${dto.reason} ` +
        `(kitchenDisposition=${dto.kitchenDisposition ?? 'n/a'} ticketsCancelled=${cancelledTicketIds.length})`,
    );
    return updatedOrder;
  }

  /**
   * Clasifica cuánto efectivo hay que sacar del cajón por cancelar esta orden.
   *
   * SÓLO los pagos `succeeded`: un pago `pending` nunca movió dinero, y
   * registrarle un egreso inventaría un faltante de caja al cierre. (El lote
   * que `cancelOrder` anula incluye `pending` Y `succeeded` — la diferencia
   * importa aquí y en ningún otro lado del método.)
   *
   * El canal de pago NO vive en `payments`: la tabla no tiene columna de
   * método, se llega por `store_payment_methods → system_payment_methods.type`.
   * El filtro va en SQL para no traer los pagos con tarjeta/transferencia sólo
   * para descartarlos en memoria.
   *
   * Devuelve `null` cuando no hay nada que devolver en efectivo — el caso
   * mayoritario (venta con tarjeta, orden sin cobrar, cancelación desde un
   * webhook de pago rechazado).
   */
  private async resolveCancelCashReversal(order: {
    payments: { id: number; state: string }[];
  }, client: Prisma.TransactionClient | StorePrismaService = this.prisma): Promise<{ amount: Prisma.Decimal; paymentIds: number[] } | null> {
    const succeededIds = order.payments
      .filter((p) => p.state === 'succeeded')
      .map((p) => p.id);
    if (succeededIds.length === 0) {
      return null;
    }

    const cashPayments = await client.payments.findMany({
      where: {
        id: { in: succeededIds },
        store_payment_method: { system_payment_method: { type: 'cash' } },
      },
      select: { id: true, amount: true },
    });
    if (cashPayments.length === 0) {
      return null;
    }

    // Suma en Decimal, no en float: son montos de `Decimal(12,2)` que después
    // tienen que cuadrar centavo a centavo contra el arqueo de la sesión.
    const amount = cashPayments.reduce(
      (acc, p) => acc.plus(new Prisma.Decimal(p.amount as any)),
      new Prisma.Decimal(0),
    );
    if (amount.lessThanOrEqualTo(0)) {
      return null;
    }

    return { amount, paymentIds: cashPayments.map((p) => p.id) };
  }

  /**
   * ADR-12 — piernas recibidas (`succeeded`/`captured`) NO-efectivo a devolver
   * vía reembolso. `captured` es dinero recibido por pasarela (el webhook lo
   * trata como pagado junto a `succeeded`) y deriva igual; nunca va al flip
   * de caja — el cash-out solo cubre `succeeded` en efectivo.
   *
   * Espejo SQL de `resolveCancelCashReversal`: el canal se filtra en la
   * consulta (nunca desde el include). Un pago sin relación de método (NULL)
   * no iguala `cash`, así que el `NOT` lo trae con `method_type: null` y
   * deriva a reembolso (fail closed, igual que la política de
   * `order-cancellation-policy.util.ts`). `refunded` no genera pierna: su
   * dinero ya volvió por su propio carril.
   */
  private async resolveCancelNonCashLegs(order: {
    payments: { id: number; state: string }[];
  }, tx: Prisma.TransactionClient): Promise<{ payment_id: number; amount: Prisma.Decimal; method_type: string | null }[]> {
    const receivedIds = order.payments
      .filter((p) => p.state === 'succeeded' || p.state === 'captured')
      .map((p) => p.id);
    if (receivedIds.length === 0) {
      return [];
    }

    const rows = await tx.payments.findMany({
      where: {
        id: { in: receivedIds },
        NOT: { store_payment_method: { system_payment_method: { type: 'cash' } } },
      },
      select: {
        id: true,
        amount: true,
        store_payment_method: {
          select: { system_payment_method: { select: { type: true } } },
        },
      },
    });
    return rows.map((row) => ({
      payment_id: row.id,
      amount: new Prisma.Decimal(row.amount as any),
      method_type: row.store_payment_method?.system_payment_method?.type ?? null,
    }));
  }

  /**
   * ADR-12 — gate fiscal ANTES de mutar: cada factura electrónica de venta
   * `accepted` de la orden exige su nota crédito `accepted` correspondiente.
   * El `where` de la nota espeja `credit-notes.service.ts` (solo las
   * `accepted` acreditan: un borrador no satisface a la DIAN).
   */
  private async assertNoBlockingFiscalInvoice(
    tx: Prisma.TransactionClient,
    orderId: number,
    storeId: number,
  ): Promise<void> {
    const acceptedInvoices = await tx.invoices.findMany({
      where: {
        order_id: orderId,
        store_id: storeId,
        invoice_type: 'sales_invoice',
        status: 'accepted',
      },
      select: { id: true, invoice_number: true, accounting_entity_id: true },
    });
    for (const invoice of acceptedInvoices) {
      const note = await tx.invoices.findFirst({
        where: {
          related_invoice_id: invoice.id,
          accounting_entity_id: invoice.accounting_entity_id,
          invoice_type: 'credit_note',
          status: 'accepted',
        },
        select: { id: true },
      });
      if (!note) {
        throw new VendixHttpException(
          ErrorCodes.ORD_CANCEL_CREDIT_NOTE_REQUIRED_001,
          `La orden tiene la factura electrónica ${invoice.invoice_number ?? `#${invoice.id}`} aceptada por la DIAN: emite primero su nota crédito y luego cancela.`,
          { invoice_id: invoice.id, invoice_number: invoice.invoice_number },
        );
      }
    }
  }

  /**
   * ADR-12 — anula el saldo CxC no cobrado de la orden y devuelve las piernas
   * de reembolso por cada abono real. Corre in-tx bajo el lock de ciclo de
   * vida (el mismo que `registerPayment` toma primero), así que ningún abono
   * tardío puede colarse después del void.
   *
   * Fórmula espejo de `AccountsReceivableService.registerPayment`: el saldo
   * vive como `original - paid - cancelled`; aquí el remanente no cobrado se
   * mueve a `cancelled_amount` y el `balance` queda en 0 con estado
   * `cancelled`. Las AR `written_off` no se retocan (su saldo ya se absorbió
   * como pérdida) ni las ya `cancelled` (terminal).
   *
   * Dedupe: un abono cobrado vía un pago que ya genera pierna propia (o
   * cash-out) no genera pierna de abono — el pago manda y el dinero es uno
   * solo. `coveredPaymentIds` trae exactamente esos pagos.
   */
  private async voidOrderCreditBalances(
    tx: Prisma.TransactionClient,
    order: { id: number; store_id: number },
    reason: string,
    coveredPaymentIds: Set<number>,
  ): Promise<CancellationPendingLeg[]> {
    const ars = await tx.accounts_receivable.findMany({
      where: {
        source_id: order.id,
        store_id: order.store_id,
        source_type: { in: ['credit_sale', 'order'] },
      },
      include: { ar_payments: { orderBy: { id: 'asc' } } },
    });
    const legs: CancellationPendingLeg[] = [];
    for (const ar of ars) {
      for (const abono of ar.ar_payments) {
        if (abono.payment_id != null && coveredPaymentIds.has(abono.payment_id)) {
          continue;
        }
        legs.push({
          ar_payment_id: abono.id,
          amount: new Prisma.Decimal(abono.amount as any),
          method_label: `abono CxC #${abono.id}${abono.payment_method ? ` (${abono.payment_method})` : ''}`,
        });
      }
      if (ar.status === 'cancelled' || ar.status === 'written_off') {
        continue;
      }
      const uncollected = new Prisma.Decimal(ar.balance as any);
      const voided = uncollected.greaterThan(0) ? uncollected : new Prisma.Decimal(0);
      await tx.accounts_receivable.update({
        where: { id: ar.id },
        data: {
          cancelled_amount: new Prisma.Decimal(ar.cancelled_amount as any).plus(voided),
          balance: 0,
          status: 'cancelled',
          cancelled_at: new Date(),
          cancellation_reason: reason,
          updated_at: new Date(),
        },
      });
    }
    // Cuotas pendientes → `cancelled` con remanente en 0 (mismo conjunto que
    // `registerPayment` considera cobrable). Las `paid` quedan como historia:
    // su dinero viaja en los reembolsos de abonos.
    await tx.order_installments.updateMany({
      where: {
        order_id: order.id,
        state: { in: ['pending', 'partial', 'overdue'] },
      },
      data: { state: 'cancelled', remaining_balance: 0, updated_at: new Date() },
    });
    return legs;
  }

  /**
   * Registra en caja el egreso de una venta cancelada que ya estaba cobrada en
   * efectivo.
   *
   * NO ES BEST-EFFORT MUDO. El anti-ejemplo vivo es
   * `RefundFlowService.recordRefundCashRegisterMovement`
   * (refund-flow.service.ts:842): `catch {}` adentro y `.catch(() => {})` en el
   * llamador — dos mordazas en serie que vuelven indistinguible el egreso
   * escrito del egreso perdido. Aquí cada rama que NO escribe el movimiento
   * deja constancia: log de error y fila de auditoría contra la orden
   * (`order.cancel.cash_out_unrecorded`), con el monto y los pagos implicados
   * para que el faltante del arqueo tenga causa y no haya que reconstruirla.
   *
   * Tampoco relanza, y es deliberado: la cancelación ya hizo commit. Un throw
   * aquí le diría al operador que falló lo que sí ocurrió, y su reintento
   * chocaría contra el 400 de `CANCELABLE_STATES` (la orden ya está
   * `cancelled`) dejando, otra vez, el egreso sin registrar. La falla se
   * escala, no se propaga.
   */
  private async registerCancelCashOut(
    orderId: number,
    orderNumber: string | null,
    reason: string,
    reversal: { amount: Prisma.Decimal; paymentIds: number[] },
  ): Promise<boolean> {
    const userId = RequestContextService.getUserId();

    try {
      const settings = await this.settingsService.getSettings();
      const cashRegister = (settings as any)?.pos?.cash_register;
      // Módulo de caja apagado: no hay cajón que cuadrar y la venta tampoco
      // registró su movimiento `sale` al cobrar (`recordPayOrderCashMovement`
      // corta en este mismo gate). Escribir sólo el egreso descuadraría una
      // sesión que no existe. No es una falla: no se escala.
      if (!cashRegister?.enabled) {
        return true;
      }

      if (!userId) {
        await this.escalateCancelCashOutFailure(
          orderId,
          reversal,
          'no_user_context',
          userId,
        );
        return false;
      }

      const session = await this.sessionsService.getActiveSession(userId);
      if (!session) {
        await this.escalateCancelCashOutFailure(
          orderId,
          reversal,
          'no_open_session',
          userId,
        );
        return false;
      }

      const movement = await this.movementsService.createManualMovement(
        session.id,
        {
          type: 'cash_out',
          amount: reversal.amount,
          reference: `Cancelación orden ${orderNumber ?? `#${orderId}`}`,
          notes:
            `Devolución de efectivo por cancelación de la orden #${orderId} ` +
            `(pagos ${reversal.paymentIds.join(', ')}). Motivo: ${reason}`,
        },
      );

      this.logger.log(
        `Order #${orderId} cancelled: cash_out #${movement.id} for ${reversal.amount.toString()} ` +
          `registered on session #${session.id} (payments ${reversal.paymentIds.join(', ')})`,
      );
      return true;
    } catch (error) {
      await this.escalateCancelCashOutFailure(
        orderId,
        reversal,
        'movement_write_failed',
        userId,
        error,
      );
      return false;
    }
  }

  /**
   * Deja constancia de un egreso de caja que NO se pudo registrar.
   *
   * Usa `AuditService.log` y no `logCustom` porque `userId` es opcional aquí
   * (una cancelación disparada por webhook o por el job de expiración corre sin
   * usuario) y `logCustom` lo exige obligatorio: pasar un `0` de relleno
   * violaría la FK, `log()` se tragaría el error y la constancia se perdería —
   * exactamente lo que este método existe para evitar.
   */
  private async escalateCancelCashOutFailure(
    orderId: number,
    reversal: { amount: Prisma.Decimal; paymentIds: number[] },
    cause: 'no_user_context' | 'no_open_session' | 'movement_write_failed',
    userId?: number,
    error?: unknown,
  ): Promise<void> {
    const amount = reversal.amount.toString();
    this.logger.error(
      `Order #${orderId} cancelled but the cash refund of ${amount} was NOT registered ` +
        `in the cash register (cause=${cause}, payments=${reversal.paymentIds.join(', ')})` +
        (error ? `: ${(error as Error).message}` : ''),
      error instanceof Error ? error.stack : undefined,
    );

    await this.auditService.log({
      userId,
      action: 'order.cancel.cash_out_unrecorded',
      resource: AuditResource.ORDERS,
      resourceId: orderId,
      metadata: {
        cause,
        amount,
        payment_ids: reversal.paymentIds,
        error: error ? (error as Error).message : undefined,
      },
    });
  }

  /**
   * Reactivate a previously cancelled order.
   *
   * Restores the order to its previous state (saved at cancel time in
   * `internal_notes._flow_metadata.previous_state`). When no previous state
   * is recorded (e.g. orders cancelled by PaymentTimeoutCleanupJob, which
   * writes a plain-text internal_notes), falls back to 'pending_payment'
   * because that is the source state for every job-cancelled order.
   *
   * Stock is re-reserved for every order_item that:
   *   - tracks inventory, AND
   *   - is not a service
   *
   * The reservation is BLOCKING: if any of those items lacks enough stock
   * the whole transaction is rolled back and a 400 is returned listing the
   * missing products. The cancelled payments are left as-is (audit trail).
   */
  async reactivateOrder(orderId: number, dto: ReactivateOrderDto) {
    const ALLOWED_TARGET_STATES: OrderState[] = [
      'created',
      'pending_payment',
      'processing',
    ];

    const userId = RequestContextService.getUserId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Load order with items + products (track_inventory, product_type) + variants.
      const order = await tx.orders.findFirst({
        where: { id: orderId },
        include: {
          order_items: {
            include: {
              products: {
                select: {
                  id: true,
                  name: true,
                  track_inventory: true,
                  product_type: true,
                },
              },
              product_variants: { select: { id: true } },
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      // 2. State guard — only cancelled orders can be reactivated.
      if ((order.state as OrderState) !== 'cancelled') {
        throw new VendixHttpException(
          ErrorCodes.ORD_STATUS_001,
          `Cannot reactivate order in state '${order.state}'. ` +
            `Reactivation is only allowed from 'cancelled'.`,
        );
      }

      // 3. Resolve target state from previous_state metadata.
      let targetState: OrderState = 'pending_payment';
      if (order.internal_notes) {
        try {
          const parsed = JSON.parse(order.internal_notes);
          const previous = parsed?._flow_metadata?.previous_state;
          if (
            typeof previous === 'string' &&
            (ALLOWED_TARGET_STATES as string[]).includes(previous)
          ) {
            targetState = previous as OrderState;
          }
        } catch {
          // Not JSON (e.g. job-cancelled orders): keep fallback 'pending_payment'.
        }
      }

      // 4. Re-reserve stock (BLOCKING).
      const missing: { product_id: number; product_name: string; available: number; required: number }[] = [];

      for (const item of order.order_items) {
        if (
          !item.products?.track_inventory ||
          item.products?.product_type === 'service'
        ) {
          continue;
        }

        const location_id =
          await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id || undefined,
          );

        // Direct read inside the tx to make the decision atomic with the
        // reservation that follows.
        const stockLevel = await tx.stock_levels.findFirst({
          where: {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            location_id,
          },
          select: { quantity_available: true },
        });

        const available = stockLevel?.quantity_available ?? 0;
        if (available < item.quantity) {
          missing.push({
            product_id: item.product_id,
            product_name: item.products?.name ?? `Product #${item.product_id}`,
            available,
            required: item.quantity,
          });
          continue;
        }

        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id || undefined,
          location_id,
          item.quantity,
          'order',
          orderId,
          userId,
          // Availability was just verified above; skip the internal check to
          // avoid a TOCTOU between our read and the reservation.
          false,
          tx,
        );
      }

      if (missing.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.ORD_VALIDATE_001,
          `Cannot reactivate order: insufficient stock for ${missing.length} product(s)`,
          { missing },
        );
      }

      // 5. Transition cancelled -> targetState. validateTransition enforces
      // the new VALID_TRANSITIONS row added in this same plan.
      this.validateTransition('cancelled', targetState);

      const updatedOrder = await this.updateOrderState(orderId, targetState, {
        reactivated_at: new Date(),
        reactivation_reason: dto.reason,
      });

      this.logger.log(
        `Order #${orderId} reactivated to '${targetState}': ${dto.reason ?? '(no reason)'}`,
      );

      return updatedOrder;
    });
  }

  /**
   * Auto-finish orders that have been delivered for more than 24 hours
   * Called by the scheduled job
   * Note: Uses updated_at as proxy for delivered_at since that field isn't in schema
   */
  async autoFinishDeliveredOrders(): Promise<number> {
    const now = new Date();
    const cutoff24h = new Date(now);
    cutoff24h.setHours(cutoff24h.getHours() - 24);
    const cutoff4h = new Date(now);
    cutoff4h.setHours(cutoff4h.getHours() - 4);

    // Pass 1 — Ecommerce / retail (24h):
    // Orders in 'delivered' for >24h, EXCLUDING restaurant-POS orders (those
    // are handled by pass 2 with a shorter 4h window). A restaurant-POS order
    // is `channel='pos'` AND has at least one kitchen ticket.
    const ecommerceOrders = await this.prisma.orders.findMany({
      where: {
        state: 'delivered',
        updated_at: { lte: cutoff24h },
        NOT: { channel: 'pos', kitchen_tickets: { some: {} } },
      },
      select: { id: true },
    });

    // Pass 2 — Restaurant-POS (4h):
    // POS orders with kitchen tickets that have been paid+fired ('processing')
    // or already handed off ('delivered') for >4h. These auto-finish faster
    // because the seat is long gone; the operator rarely taps "Finalizar".
    //
    // EXCEPCION DOMICILIO: un pedido a domicilio en `processing` con cocina
    // terminada esta ESPERANDO despacho (ver `markKitchenOrderDelivered`).
    // Auto-finalizarlo a las 4h cerraria la orden sin remision ni entrega y
    // dejaria el detalle sin flujo de despacho. Solo se auto-finaliza cuando
    // ya paso por entrega (`delivered`).
    const restaurantOrders = await this.prisma.orders.findMany({
      where: {
        channel: 'pos',
        kitchen_tickets: { some: {} },
        state: { in: ['processing', 'delivered'] },
        updated_at: { lte: cutoff4h },
        NOT: { delivery_type: 'home_delivery', state: 'processing' },
      },
      select: { id: true },
    });

    // Merge by id so an order matched by both passes (defensive) is finished once.
    const idsToFinish = new Set<number>([
      ...ecommerceOrders.map((o) => o.id),
      ...restaurantOrders.map((o) => o.id),
    ]);

    let finishedCount = 0;
    for (const orderId of idsToFinish) {
      try {
        // F2-guard (AUTOMATIC path): SKIP — never auto-finish an order that
        // still has undelivered kitchen items. We do not throw; the order is
        // simply left for a later cycle (the cutoff query will pick it up
        // again once the kitchen delivers). Restaurant-POS orders sit in
        // `processing` precisely while the KDS works on them.
        if (await this.hasPendingKitchenItems(orderId)) {
          this.logger.log(
            `Order #${orderId} skipped by auto-finish: kitchen items still pending.`,
          );
          continue;
        }
        // updateOrderState enforces VALID_TRANSITIONS; both 'delivered' and
        // 'processing' allow the move to 'finished'. The auto_finished/
        // auto_finished_at metadata is preserved in internal_notes as before.
        await this.updateOrderState(
          orderId,
          'finished',
          {
            auto_finished: true,
            auto_finished_at: new Date().toISOString(),
          },
          { source: 'job' },
        );
        finishedCount++;
        this.logger.log(`Order #${orderId} auto-finished`);
      } catch (error) {
        this.logger.error(
          `Failed to auto-finish order #${orderId}: ${error.message}`,
        );
      }
    }

    if (finishedCount > 0) {
      this.logger.log(`Auto-finished ${finishedCount} orders`);
    }

    return finishedCount;
  }

  /**
   * Register a credit payment for an order with payment_form = '2'
   * Supports partial payments and installment-based credit
   */
  async registerCreditPayment(orderId: number, dto: PayOrderDto) {
    // Gate único de caja: el abono es un cobro y exige sesión de quien cobra.
    // Antes de cualquier lectura/escritura para no crear el pago.
    await this.sessionsService.assertSessionForSales(
      RequestContextService.getUserId(),
    );

    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        payments: true,
        order_installments: { orderBy: { installment_number: 'asc' } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Validate it's a credit order
    if (order.payment_form !== '2') {
      throw new BadRequestException('This order is not a credit sale');
    }

    const remainingBalance = Number(order.remaining_balance);
    if (remainingBalance <= 0) {
      throw new BadRequestException('This order has no remaining balance');
    }

    // Determine payment amount
    const paymentAmount = dto.amount || remainingBalance;
    if (paymentAmount > remainingBalance + 0.01) {
      throw new BadRequestException(
        `Payment amount (${paymentAmount}) exceeds remaining balance (${remainingBalance})`,
      );
    }

    // Validate payment method
    const paymentMethod = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id },
      include: { system_payment_method: true },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // Calculate change for cash
    let change = 0;
    if (
      paymentMethod.system_payment_method.type === 'cash' &&
      dto.amount_received
    ) {
      change = dto.amount_received - paymentAmount;
      if (change < 0) {
        throw new BadRequestException(
          'Amount received is less than the payment amount',
        );
      }
    }

    // Generate transaction ID
    const transactionId = `credit_pay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create payment record
    const payment = await this.prisma.payments.create({
      data: {
        order_id: orderId,
        store_payment_method_id: dto.store_payment_method_id,
        amount: paymentAmount,
        currency: order.currency,
        state: 'succeeded',
        transaction_id: transactionId,
        paid_at: new Date(),
        gateway_response: {
          payment_type: 'direct',
          amount_received: dto.amount_received,
          change: change,
          payment_reference: dto.payment_reference,
          metadata: { is_credit_payment: true },
        },
      },
    });

    // Update order balances — persisted ALWAYS. The payment is registered even
    // if the finish is later blocked by insufficient stock, so this balance
    // write is separate from and precedes the finish transition below.
    const newTotalPaid = Number(order.total_paid) + paymentAmount;
    const newRemainingBalance = Math.max(remainingBalance - paymentAmount, 0);

    await this.prisma.orders.update({
      where: { id: orderId },
      data: {
        total_paid: Math.round(newTotalPaid * 100) / 100,
        remaining_balance: Math.round(newRemainingBalance * 100) / 100,
      },
    });

    // The finish transition runs after the table projection below: a
    // projection failure must skip it (no false `finished`) while keeping
    // the committed payment, balances, installments and cash movement.
    let finished = false;
    let finishBlockedReason: string | undefined;

    // Update installment if specified (for installment-based credit)
    if (order.credit_type === 'installments') {
      let remainingPayment = paymentAmount;

      if (dto.installment_id) {
        // Pay specific installment
        const installment = await this.prisma.order_installments.findFirst({
          where: { id: dto.installment_id, order_id: orderId },
        });
        if (installment) {
          const payable = Math.min(
            remainingPayment,
            Number(installment.remaining_balance),
          );
          const newPaid = Number(installment.amount_paid) + payable;
          const newInstBalance =
            Number(installment.remaining_balance) - payable;

          await this.prisma.order_installments.update({
            where: { id: installment.id },
            data: {
              amount_paid: Math.round(newPaid * 100) / 100,
              remaining_balance:
                Math.round(Math.max(newInstBalance, 0) * 100) / 100,
              state: newInstBalance <= 0.01 ? 'paid' : 'partial',
              paid_at: newInstBalance <= 0.01 ? new Date() : null,
            },
          });
          remainingPayment -= payable;
        }
      }

      // If there's remaining payment (or no specific installment), apply sequentially
      if (remainingPayment > 0.01) {
        const pendingInstallments =
          await this.prisma.order_installments.findMany({
            where: {
              order_id: orderId,
              state: { in: ['pending', 'partial', 'overdue'] },
            },
            orderBy: { installment_number: 'asc' },
          });

        for (const inst of pendingInstallments) {
          if (remainingPayment <= 0.01) break;
          const payable = Math.min(
            remainingPayment,
            Number(inst.remaining_balance),
          );
          const newPaid = Number(inst.amount_paid) + payable;
          const newInstBalance = Number(inst.remaining_balance) - payable;

          await this.prisma.order_installments.update({
            where: { id: inst.id },
            data: {
              amount_paid: Math.round(newPaid * 100) / 100,
              remaining_balance:
                Math.round(Math.max(newInstBalance, 0) * 100) / 100,
              state: newInstBalance <= 0.01 ? 'paid' : 'partial',
              paid_at: newInstBalance <= 0.01 ? new Date() : null,
            },
          });
          remainingPayment -= payable;
        }
      }
    }

    this.logger.log(
      `Credit payment of ${paymentAmount} registered for order #${orderId}. Remaining: ${newRemainingBalance}`,
    );

    // Record cash register movement
    this.recordPayOrderCashMovement(
      order.store_id,
      orderId,
      paymentAmount,
      paymentMethod.system_payment_method.type,
    ).catch(() => {});

    // Emit event
    this.eventEmitter.emit('order.credit_payment_received', {
      order_id: orderId,
      amount: paymentAmount,
      remaining_balance: newRemainingBalance,
      is_fully_paid: newRemainingBalance <= 0.01,
    });

    // Emit for accounting auto-entry (installment payment)
    this.eventEmitter.emit('installment_payment.received', {
      credit_id: orderId,
      installment_id: 0,
      payment_id: payment.id,
      amount: paymentAmount,
      store_id: order.store_id,
      organization_id: order.organization_id,
      store_payment_method_id: dto.store_payment_method_id,
      credit_number: order.order_number,
      installment_number: 0,
      customer_id: order.customer_id,
      order_id: orderId,
      user_id: RequestContextService.getUserId(),
    });

    // B.2/T5 — project a FULLY settled credit sale onto its table session.
    // Partial abonos never project. Payment, balances, installments, cash
    // and events above are already committed, so this runs post-commit: a
    // projection failure throws typed ERR-33 (via `projectPaidOrderToTable`)
    // and skips the finish below — no false `finished`, payment kept. The
    // canonical projection is idempotent, so a later staff confirmPayment
    // retry repairs a missed projection without duplicating effects.
    if (newRemainingBalance <= 0.01) {
      await this.projectPaidOrderToTable(orderId, payment.id);
    }

    // If fully paid, finish through updateOrderState — which now deducts stock
    // via the canonical OrderStockCommitService and blocks on INV_STOCK_002 /
    // SERIAL_REQUIRED_001. The balance write above already committed, so a
    // blocked finish NEVER loses the payment.
    if (newRemainingBalance <= 0.01) {
      // F2-guard (AUTOMATIC path): do NOT finish a fully-paid order while the
      // kitchen still has undelivered items. We must NOT throw here — the
      // payment is legitimate and has to be recorded — so we just skip the
      // finish transition and leave the order in its current state. It will
      // finish later (manual `confirmDelivery` or the auto-finish job) once
      // the kitchen delivers.
      if (await this.hasPendingKitchenItems(orderId)) {
        this.logger.log(
          `Order #${orderId} fully paid but kept open: kitchen items still pending (not finishing).`,
        );
      } else {
        this.validateTransition(order.state as OrderState, 'finished');
        try {
          await this.updateOrderState(orderId, 'finished', {
            paid_at: new Date(),
            finished_at: new Date(),
          });
          finished = true;
        } catch (error) {
          // A stock/serial business rule blocked the finish. The payment is
          // already recorded above, so leave the order UNFINISHED and surface
          // the reason WITHOUT failing the whole call (never lose the payment).
          if (error instanceof VendixHttpException) {
            finishBlockedReason = error.message;
            this.logger.warn(
              `Order #${orderId} fully paid but NOT finished (stock/serial rule): ${error.message}`,
            );
          } else {
            throw error;
          }
        }
      }
    }

    // Return updated order
    const updatedOrder = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, name: true, store_code: true } },
        order_items: { include: { products: true, product_variants: true } },
        payments: {
          include: {
            store_payment_method: { include: { system_payment_method: true } },
          },
          orderBy: { created_at: 'asc' },
        },
        order_installments: { orderBy: { installment_number: 'asc' } },
      },
    });

    return {
      order: updatedOrder,
      payment: { transaction_id: transactionId, change, amount: paymentAmount },
      // The payment is always recorded. `finished` reflects whether the order
      // could also be closed; when a stock/serial rule blocked the finish,
      // `finish_blocked_reason` explains why (the order stays open).
      payment_recorded: true,
      finished,
      ...(finishBlockedReason
        ? { finish_blocked_reason: finishBlockedReason }
        : {}),
    };
  }

  /**
   * Forgive an installment — mark it as forgiven and reduce order balance
   * Only owner/admin can perform this action
   */
  async forgiveInstallment(orderId: number, installmentId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: { order_installments: true },
    });

    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.ORD_FIND_001,
        'La orden no existe en este comercio.',
      );
    }
    if (order.payment_form !== '2') {
      throw new VendixHttpException(
        ErrorCodes.ORD_VALIDATE_001,
        'Esta orden no es de tipo crédito. Solo se pueden condonar cuotas en órdenes a crédito.',
      );
    }

    const installment = order.order_installments.find(
      (i: any) => i.id === installmentId,
    );
    if (!installment) {
      throw new VendixHttpException(
        ErrorCodes.ORD_FIND_001,
        'La cuota no existe o no pertenece a esta orden.',
      );
    }
    if (installment.state === 'paid' || installment.state === 'forgiven') {
      throw new VendixHttpException(
        ErrorCodes.ORD_STATUS_001,
        `La cuota ya está en estado terminal (${installment.state}) y no se puede condonar.`,
      );
    }

    const forgivenAmount = Number(installment.remaining_balance);

    // Update installment
    await this.prisma.order_installments.update({
      where: { id: installmentId },
      data: { state: 'forgiven', remaining_balance: 0 },
    });

    // Update order balance
    const newRemaining = Math.max(
      Number(order.remaining_balance) - forgivenAmount,
      0,
    );
    const orderUpdate: any = {
      remaining_balance: Math.round(newRemaining * 100) / 100,
    };

    // Check if all installments are now paid/forgiven
    const remaining = await this.prisma.order_installments.findMany({
      where: {
        order_id: orderId,
        state: { in: ['pending', 'partial', 'overdue'] },
      },
    });

    let shouldFinish = false;
    if (remaining.length === 0 && newRemaining <= 0.01) {
      // F2-guard (AUTOMATIC path): mirror `registerCreditPayment` — the
      // forgiveness is recorded regardless, but we do NOT finish the order
      // while kitchen items are still undelivered, and we do NOT throw. The
      // order finishes later via manual `confirmDelivery` or the
      // auto-finish job.
      if (await this.hasPendingKitchenItems(orderId)) {
        this.logger.log(
          `Order #${orderId} fully settled (forgiveness) but kept open: kitchen items still pending (not finishing).`,
        );
      } else {
        this.validateTransition(order.state as OrderState, 'finished');
        shouldFinish = true;
      }
    }

    await this.prisma.orders.update({
      where: { id: orderId },
      data: orderUpdate,
    });

    if (shouldFinish) {
      // docs/plans/no-overselling-stock-guard-plan.md step 5 — never write
      // `state: 'finished'` directly: `updateOrderState` is the only path
      // that runs the atomic stock commit before the state write. A
      // shortfall throws INV_STOCK_002 and the order stays open (the
      // installment forgiveness above still stands — it is credit
      // bookkeeping, independent of whether stock allows the order to
      // close).
      await this.updateOrderState(orderId, 'finished', {
        finished_at: new Date(),
      });
    }

    this.logger.log(
      `Installment #${installmentId} forgiven for order #${orderId}`,
    );

    return this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        order_installments: { orderBy: { installment_number: 'asc' } },
        payments: true,
      },
    });
  }

  /**
   * Get valid next states for an order
   */
  async getValidTransitions(orderId: number): Promise<OrderState[]> {
    const order = await this.getOrder(orderId);
    const targets = VALID_TRANSITIONS[order.state as OrderState] || [];
    return order.state === 'delivered'
      ? targets.filter((state) => state !== 'processing')
      : targets;
  }

  /**
   * Carril FORZADO de la máquina de estados — único punto de entrada para los
   * botones "manuales" de la UI (`PATCH /store/orders/:id {"state":...}`).
   *
   * Contexto: `UpdateOrderDto extends PartialType(CreateOrderDto)` reexpone
   * `state`, así que ese PATCH podía escribir `orders.state` con un
   * `prisma.orders.update` crudo — sin efectos, sin eventos y sin liberar
   * reservas. Ese fue el vector que hizo reaparecer QUI-557 por la vía de
   * `cancelled`, y el mismo que dejaba reservas eternamente `active` al marcar
   * Enviado a mano: sin `order.shipped`, el OrderAutoFulfillmentListener nunca
   * consume la reserva original de una orden de alcance ORGANIZATION.
   *
   * La regla que fija este método: **forzar significa saltear precondiciones,
   * NUNCA efectos**. Se despacha a los mismos métodos canónicos con
   * `force = true`, así que la cadena de efectos no es una copia que haya que
   * mantener sincronizada — es literalmente el mismo código:
   *
   *   - `cancelled` → {@link cancelOrder}: cancela pagos, libera reservas
   *     (`releaseReservationsByReference`) y emite `order.status_changed`.
   *   - `shipped`   → {@link shipOrder}: sella `shipped_at` y emite
   *     `order.shipped`, que es lo que consume la reserva en alcance ORG.
   *   - `delivered` → {@link deliverOrder}: sella `delivered_at`.
   *   - `finished`  → {@link updateOrderState}, que es exactamente lo que hace
   *     {@link finishOrder} menos la validación, y que además ejecuta el commit
   *     de inventario vía OrderStockCommitService y la guarda de cocina.
   *   - resto (`draft`, `created`, `pending_payment`, `processing`, `refunded`)
   *     → {@link updateOrderState}, el único escritor de `orders.state`.
   *
   * Los endpoints `/flow/*` NO exponen el forzado: ese carril sigue estricto.
   *
   * Toda forzada queda auditada en `internal_notes._flow_metadata.forced_transition`
   * con estado origen, destino, motivo y usuario. `forced` distingue una
   * transición no disponible al carril genérico de una legal. La excepción
   * es delivered -> processing: figura en el mapa sólo para el puente KDS,
   * y desde el PATCH siempre es forzada.
   */
  async forceOrderState(
    orderId: number,
    target: OrderState,
    opts: { reason: string },
  ) {
    const order = await this.getOrder(orderId);
    const from = order.state as OrderState;

    // Idempotente: el botón manual se puede pulsar dos veces (o llegar un
    // reintento del cliente) y la segunda no debe re-ejecutar los efectos ni
    // registrar una forzada que no ocurrió.
    if (from === target) {
      return order;
    }

    const kitchenReversal = from === 'delivered' && target === 'processing';
    const reason = opts.reason?.trim();
    if (kitchenReversal && !reason) {
      throw new VendixHttpException(
        ErrorCodes.ORD_DELIVERED_REVERSAL_REASON_REQUIRED_001,
      );
    }
    const forced = kitchenReversal || !(VALID_TRANSITIONS[from] ?? []).includes(target);

    let updatedOrder: any;
    switch (target) {
      case 'cancelled':
        updatedOrder = await this.cancelOrder(
          orderId,
          { reason: opts.reason },
          true,
        );
        break;
      case 'shipped':
        updatedOrder = await this.shipOrder(orderId, {}, true);
        break;
      case 'delivered':
        updatedOrder = await this.deliverOrder(orderId, {}, true);
        break;
      case 'finished':
        updatedOrder = await this.updateOrderState(orderId, 'finished', {
          finished_at: new Date(),
        });
        break;
      default:
        updatedOrder = kitchenReversal
          ? await this.updateOrderState(orderId, target, {}, { deliveredReversalOwner: 'forced' })
          : await this.updateOrderState(orderId, target);
    }

    // Se escribe DESPUÉS del método canónico para no pisar la metadata que él
    // mismo persiste (`cancelled_at`, `previous_state`, `shipped_at`…).
    await this.appendFlowMetadata(orderId, {
      forced_transition: {
        from,
        to: target,
        forced,
        reason: reason || opts.reason,
        user_id: RequestContextService.getUserId() ?? null,
        at: new Date(),
      },
    });

    this.logger.warn(
      `Order #${orderId} state ${from} -> ${target} via forced lane` +
        `${forced ? ' (transición NO permitida por la máquina de estados)' : ''}: ${opts.reason}`,
    );

    return updatedOrder;
  }

  /**
   * Fast-track an order: run pay (if needed) → ship → deliver → finish in one call.
   * Reuses the public flow methods so all side-effects (events, cash movements,
   * accounting entries, stock consumption) fire exactly as in the regular flow.
   *
   * Note on atomicity: the regular flow methods emit side-effect events and
   * trigger auto-accounting/stock mutations that are NOT idempotent and that
   * cannot be safely deferred inside a single Prisma $transaction without a
   * large refactor. We therefore chain them sequentially; if a later step
   * fails, earlier steps remain persisted and the thrown error reports the
   * last successful state. Callers should treat the exception as "partially
   * applied — resume manually from the current state" and the order remains
   * recoverable because every intermediate state is valid in the state machine.
   */
  async fastTrackOrder(orderId: number, dto: FastTrackOrderDto) {
    const order = await this.getOrder(orderId);

    const terminalStates: OrderState[] = ['finished', 'cancelled', 'refunded'];
    if (terminalStates.includes(order.state as OrderState)) {
      throw new VendixHttpException(
        ErrorCodes.ORD_FAST_TRACK_INVALID_STATE_001,
      );
    }

    // Widened exemption (fast-track only, see `shipOrder`'s
    // `allowExemptDeliveryTypes`): pickup/direct_delivery/dine_in orders
    // never need a shipping method to complete pay→ship→deliver→finish.
    if (
      (!order.delivery_type ||
        !SHIPPING_METHOD_EXEMPT_DELIVERY_TYPES.has(order.delivery_type)) &&
      !order.shipping_method_id
    ) {
      throw new VendixHttpException(ErrorCodes.ORD_SHIP_REQUIRED_FOR_FLOW_001);
    }

    const stepsExecuted: string[] = [];

    const hasSuccessfulPayment = (order.payments || []).some(
      (p) => p.state === 'succeeded',
    );

    // 1) Pay (only if not already paid)
    if (!hasSuccessfulPayment) {
      if (!dto.payment) {
        throw new VendixHttpException(
          ErrorCodes.ORD_FAST_TRACK_PAYMENT_REQUIRED_001,
        );
      }
      // B13 — fastTrackOrder's one-shot state machine (pay → ship → deliver →
      // finish, below) depends on payOrder's OLD strict throw when kitchen
      // items are still pending: without it, `current.state === 'processing'`
      // would fall into the `ship` step and auto-deliver/auto-finish an order
      // whose kitchen never handed the items off. The direct "pagar" call
      // (order detail / `/flow/pay`) does NOT pass this flag and gets the new
      // lenient `processing` (paid) behavior instead — see payOrder above.
      await this.payOrder(orderId, dto.payment, { strictKitchenPending: true });
      stepsExecuted.push('pay');
    }

    // Reload to pick up state transitions performed by payOrder
    let current = await this.getOrder(orderId);

    // If payOrder already finished the order (direct_delivery path), we're done.
    if (current.state === 'finished') {
      this.eventEmitter.emit('order.fast_tracked', {
        store_id: current.store_id,
        order_id: orderId,
        order_number: current.order_number,
        steps_executed: stepsExecuted,
        final_state: current.state,
      });

      return this.prisma.orders.findFirst({
        where: { id: orderId },
        include: this.fastTrackIncludes(),
      });
    }

    // 2) Ship (processing → shipped) — fast track alone is allowed to skip
    // the shipping method for pickup/dine_in (see the widened precheck
    // above and `shipOrder`'s `allowExemptDeliveryTypes`).
    if (current.state === 'processing') {
      await this.shipOrder(orderId, dto.ship ?? {}, false, {
        allowExemptDeliveryTypes: true,
      });
      stepsExecuted.push('ship');
      current = await this.getOrder(orderId);
    }

    // 3) Deliver (shipped → delivered)
    if (current.state === 'shipped') {
      await this.deliverOrder(orderId, dto.deliver ?? {});
      stepsExecuted.push('deliver');
      current = await this.getOrder(orderId);
    }

    // 4) Confirm delivery (delivered → finished)
    if (current.state === 'delivered') {
      await this.confirmDelivery(orderId);
      stepsExecuted.push('finish');
      current = await this.getOrder(orderId);
    }

    this.eventEmitter.emit('order.fast_tracked', {
      store_id: current.store_id,
      order_id: orderId,
      order_number: current.order_number,
      steps_executed: stepsExecuted,
      final_state: current.state,
    });

    this.logger.log(
      `Order #${orderId} fast-tracked: steps=[${stepsExecuted.join(',')}] final_state=${current.state}`,
    );

    return this.prisma.orders.findFirst({
      where: { id: orderId },
      include: this.fastTrackIncludes(),
    });
  }

  private fastTrackIncludes() {
    return {
      stores: { select: { id: true, name: true, store_code: true } },
      order_items: {
        include: {
          products: {
            include: {
              product_images: { where: { is_main: true }, take: 1 },
            },
          },
          product_variants: true,
        },
      },
      addresses_orders_billing_address_idToaddresses: true,
      addresses_orders_shipping_address_idToaddresses: true,
      payments: {
        include: {
          store_payment_method: { include: { system_payment_method: true } },
        },
        orderBy: { created_at: 'asc' as const },
      },
      shipping_method: {
        select: {
          id: true,
          name: true,
          type: true,
          provider_name: true,
          min_days: true,
          max_days: true,
          logo_url: true,
        },
      },
      shipping_rate: {
        include: {
          shipping_zone: {
            select: { id: true, name: true, display_name: true },
          },
        },
      },
      users: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          avatar_url: true,
        },
      },
      order_installments: {
        orderBy: { installment_number: 'asc' as const },
      },
    };
  }

  /**
   * Cobro multimétodo de contado — crea una fila `payments` `succeeded` por
   * tramo, cada una con su propio `transaction_id` (unicidad), su monto, su
   * referencia, su cuenta bancaria y su vuelto (sólo el tramo en efectivo).
   *
   * `gateway_response` conserva las claves planas históricas (`payment_type`,
   * `amount_received`, `change`) y, SÓLO en el tramo en efectivo, añade la
   * forma `metadata.amount_received` que escriben el POS y
   * `processMultiLegDirectPayment` y que leen `resolveCashTender`/el ticket:
   * los tramos no-efectivo no la traen para que el lector ("primer pago con
   * recibido") nunca tome el recibido de una tarjeta.
   */
  private async voidSettlementPendingMarkers(paymentIds: number[]): Promise<void> {
    if (paymentIds.length === 0) return;
    await this.prisma.payments.updateMany({
      where: { id: { in: paymentIds }, state: 'pending' },
      data: { state: 'cancelled', updated_at: new Date() },
    });
  }

  private async createLegPayments(
    orderId: number,
    currency: string,
    legs: NormalizedLeg[],
    change: number,
    historyCtx?: {
      storeId: number;
      organizationId?: number | null;
      settlementPendingPaymentIds?: number[];
      /** Fase 2 paso 5 — `'cash_on_delivery'` (COD, histórico) o `'manual_confirmation'`. */
      settlementOrigin?: string;
      /** Comprobante del marcador manual anulado → metadata del pago real. */
      settlementReceipt?: {
        receipt_s3_key: string | null;
        receipt_uploaded_at: Date | string | null;
        bank_account_id: number | null;
      } | null;
      /**
       * Pago online manual `pending` (fila completa de `getOrder`) que el
       * PRIMER tramo confirma en sitio: pasa a `succeeded` con el monto, el
       * método, la cuenta, la referencia y el vuelto del tramo, conservando su
       * comprobante y su `transaction_id`. Los tramos siguientes se crean.
       */
      confirmInPlacePayment?: any | null;
    },
  ): Promise<
    Array<{
      payment: any;
      leg: NormalizedLeg;
      transactionId: string;
      /** Estado previo de la fila confirmada en sitio (para compensar). */
      confirmedInPlaceOriginal?: any;
    }>
  > {
    // Fase 2 paso 5 — bloque de liquidación (COD o manual) que viaja en la
    // metadata de cada tramo + `payment_registered`. Sólo campos con valor; el
    // camino COD queda byte a byte (`payment_origin` + ids, sin comprobante).
    const settlementIds = historyCtx?.settlementPendingPaymentIds ?? [];
    const settlementReceiptFields = Object.fromEntries(
      Object.entries({
        receipt_s3_key: historyCtx?.settlementReceipt?.receipt_s3_key ?? null,
        receipt_uploaded_at:
          historyCtx?.settlementReceipt?.receipt_uploaded_at ?? null,
        bank_account_id: historyCtx?.settlementReceipt?.bank_account_id ?? null,
      }).filter(([, value]) => value != null),
    );
    // Plan PLAN-pago-multimetodo-fixes paso 1 — objetivo 4: la cuenta
    // bancaria de cada tramo se resuelve y valida ANTES de abrir la
    // transacción (mismo gateway que ya usa el POS,
    // `payments.service.ts:5275`/`:5544`), para rechazar una cuenta ajena a
    // la tienda sin tocar `payments`. Fail-closed: si el gateway no resolvió
    // por DI (specs históricas sin este dependiente) o falta `storeId` en el
    // contexto, un tramo con `bank_account_id` se rechaza en vez de confiar
    // en el id crudo que mandó el navegador.
    const resolvedBankAccountIds = new Map<NormalizedLeg, number>();
    for (const leg of legs) {
      if (leg.bank_account_id == null) continue;
      if (!this.paymentGatewayService || historyCtx?.storeId == null) {
        throw this.wrapPaymentFailure(
          'bank_account_invalid',
          new VendixHttpException(
            ErrorCodes.SYS_INTERNAL_001,
            'No se pudo validar la cuenta bancaria del tramo: falta el contexto de tienda o el validador no está disponible.',
            { store_payment_method_id: leg.store_payment_method_id },
          ),
        );
      }
      try {
        const account =
          await this.paymentGatewayService.resolveAndValidateBankAccount(
            leg.bank_account_id,
            historyCtx.storeId,
            this.prisma,
          );
        resolvedBankAccountIds.set(leg, account.id);
      } catch (err) {
        // PLAN-pago-multimetodo-pendientes paso 3 — cuenta bancaria inválida
        // (inexistente, inactiva o ajena a la tienda/organización) es un
        // rechazo de VALIDACIÓN de payload, no un conflicto de estado del
        // cobro. Se relanza SIN envolver, mismo criterio que el POS
        // (`payments.service.ts` ~:239-241, :282-284, :336-338, :368-370):
        // el gateway tipa `PaymentError`, se mapea con `LEGACY_TO_NEW` y sale
        // como 400 `PAY_VALIDATE_001`. Un error no tipado (infra del
        // gateway) sí cae al 409 genérico de `wrapPaymentFailure` — igual
        // que la falta de contexto de tienda/validador arriba, que sigue
        // envuelta como `SYS_INTERNAL_001` / 500.
        if (err instanceof PaymentError) {
          const mapped = LEGACY_TO_NEW[err.code];
          throw new VendixHttpException(mapped, err.message, err.details);
        }
        throw this.wrapPaymentFailure('bank_account_invalid', err as Error);
      }
    }

    // Plan PLAN-pago-multimetodo-fixes paso 1 — objetivo 1: todos los tramos
    // y su `payment_registered` corren en UNA sola `$transaction`. Si el
    // segundo `payments.create` falla, Prisma revierte el primero y no queda
    // ninguna fila `succeeded` huérfana (antes corrían fuera de transacción,
    // uno por uno, con `this.prisma`).
    return this.prisma.$transaction(async (tx) => {
      const created: Array<{
        payment: any;
        leg: NormalizedLeg;
        transactionId: string;
        confirmedInPlaceOriginal?: any;
      }> = [];
      const inPlace = historyCtx?.confirmInPlacePayment ?? null;
      for (const [legIndex, leg] of legs.entries()) {
        // Ausente ⇒ pago exacto (igual que el escalar de hoy); nunca falsy.
        const legReceived = leg.amount_received ?? leg.amount;
        let payment: any;
        let transactionId: string;
        let confirmedInPlaceOriginal: any;
        if (inPlace && legIndex === 0) {
          // Confirmación en sitio del pago online manual. Guardia de estado:
          // sólo una fila todavía `pending` se confirma; si otro proceso ya la
          // movió, se rechaza (nunca se cobra dos veces el mismo pago).
          transactionId =
            inPlace.transaction_id ?? (await this.generateTransactionId());
          const previousResponse =
            inPlace.gateway_response &&
            typeof inPlace.gateway_response === 'object' &&
            !Array.isArray(inPlace.gateway_response)
              ? (inPlace.gateway_response as Record<string, any>)
              : {};
          const previousMetadata =
            previousResponse.metadata &&
            typeof previousResponse.metadata === 'object'
              ? previousResponse.metadata
              : {};
          const sameMethod =
            inPlace.store_payment_method_id == null ||
            inPlace.store_payment_method_id === leg.store_payment_method_id;
          const confirmed = await tx.payments.updateMany({
            where: { id: inPlace.id, state: 'pending' },
            data: {
              store_payment_method_id: leg.store_payment_method_id,
              bank_account_id:
                resolvedBankAccountIds.get(leg) ??
                leg.bank_account_id ??
                (sameMethod ? (inPlace.bank_account_id ?? null) : null),
              amount: leg.amount,
              state: 'succeeded',
              transaction_id: transactionId,
              gateway_reference:
                leg.payment_reference ?? inPlace.gateway_reference ?? null,
              paid_at: new Date(),
              updated_at: new Date(),
              gateway_response: {
                ...previousResponse,
                payment_type: 'direct',
                amount_received: leg.amount_received,
                change: leg.is_cash ? change : 0,
                metadata: {
                  ...previousMetadata,
                  ...(leg.is_cash ? { amount_received: legReceived } : {}),
                  payment_origin:
                    historyCtx?.settlementOrigin ?? 'manual_confirmation',
                  confirmed_in_place: true,
                  original_pending_payment_ids: settlementIds,
                  original_store_payment_method_id:
                    inPlace.store_payment_method_id ?? null,
                  original_amount:
                    inPlace.amount != null ? Number(inPlace.amount) : null,
                  ...settlementReceiptFields,
                },
              },
            },
          });
          if (!confirmed || confirmed.count !== 1) {
            throw this.wrapPaymentFailure('manual_payment_not_pending', {
              order_id: orderId,
              payment_id: inPlace.id,
            });
          }
          payment = await tx.payments.findFirst({ where: { id: inPlace.id } });
          if (!payment) {
            throw this.wrapPaymentFailure('manual_payment_not_pending', {
              order_id: orderId,
              payment_id: inPlace.id,
            });
          }
          confirmedInPlaceOriginal = inPlace;
        } else {
          transactionId = await this.generateTransactionId();
          payment = await tx.payments.create({
            data: {
              order_id: orderId,
              store_payment_method_id: leg.store_payment_method_id,
              bank_account_id:
                resolvedBankAccountIds.get(leg) ?? leg.bank_account_id ?? null,
              amount: leg.amount,
              currency,
              state: 'succeeded',
              transaction_id: transactionId,
              gateway_reference: leg.payment_reference ?? null,
              paid_at: new Date(),
              gateway_response: {
                payment_type: 'direct',
                amount_received: leg.amount_received,
                change: leg.is_cash ? change : 0,
                ...(leg.is_cash || settlementIds.length
                  ? { metadata: {
                      ...(leg.is_cash ? { amount_received: legReceived } : {}),
                      ...(settlementIds.length
                        ? {
                            payment_origin: historyCtx?.settlementOrigin ?? 'cash_on_delivery',
                            original_pending_payment_ids: settlementIds,
                            ...settlementReceiptFields,
                          }
                        : {}),
                    } }
                  : {}),
              },
            },
          });
        }
        created.push({
          payment,
          leg,
          transactionId,
          ...(confirmedInPlaceOriginal ? { confirmedInPlaceOriginal } : {}),
        });
        // Plan order-truth-and-invoice-tz — un `payment_registered` por
        // tramo, con el MISMO `tx` que el `payments.create` de arriba: si la
        // transacción revierte, el evento revierte con ella.
        if (historyCtx) {
          await this.orderHistoryService?.record(tx, {
            orderId,
            storeId: historyCtx.storeId,
            organizationId: historyCtx.organizationId ?? null,
            type: 'payment_registered',
            paymentId: payment.id,
            amount: leg.amount,
            ...(settlementIds.length
              ? { payload: {
                  payment_origin: historyCtx.settlementOrigin ?? 'cash_on_delivery',
                  original_pending_payment_ids: settlementIds,
                  ...settlementReceiptFields,
                  actual_store_payment_method_id: leg.store_payment_method_id,
                  actual_method: leg.accounting_method,
                  ...(confirmedInPlaceOriginal ? { confirmed_in_place: true } : {}),
                } }
              : {}),
          });
        }
        // PLAN-pago-multimetodo-pendientes paso 2 — porción de venta del
        // evento `payment.received`, calculada SECUENCIALMENTE (mismo patrón
        // que `processMultiLegDirectPayment` del POS,
        // `payments.service.ts:5450`): en este punto de la transacción sólo
        // existen los tramos ANTERIORES, así que son los únicos
        // `prior_amounts` posibles y el último tramo toma el remanente
        // exacto. Calcularlo por lote DESPUÉS de crear todos los tramos
        // rompería esta garantía: cada uno vería a sus hermanos como
        // "previos" y la Σ de porciones dejaría de cuadrar con la orden.
        //
        // Envuelto en try/catch: esto es enriquecimiento de LECTURA para el
        // evento que se emite más tarde (`emitLegPaymentReceivedEvents`),
        // nunca el registro del cobro en sí. Un fallo acá (p.ej. un mock de
        // test sin `orders.findUnique`, o una lectura que revienta) degrada
        // a `sale_share: undefined` — el payload cae íntegro a los totales
        // de la orden (mismo contrato que el pago escalar) — pero JAMÁS debe
        // abortar la transacción que ya está creando la fila `succeeded`.
        try {
          (payment as any).sale_share = await resolvePaymentReceivedSaleFields(
            tx,
            { order_id: orderId, payment_id: payment.id, amount: Number(leg.amount) },
          );
        } catch (error) {
          this.logger.warn(
            `resolvePaymentReceivedSaleFields failed for order ${orderId} payment ${payment.id}; payment.received usará los totales de la orden: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return created;
    });
  }

  /**
   * Compensación multimétodo — cancela TODAS las filas creadas en el intento
   * con el mismo `cancellation_reason` (regla "un payment por intento"), las
   * `N` actualizaciones corren en una sola `$transaction` para que la
   * compensación sea todo o nada.
   */
  private async cancelLegPayments(
    legPayments: Array<{
      payment: any;
      leg: NormalizedLeg;
      confirmedInPlaceOriginal?: any;
    }>,
    cancellationReason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const { payment, confirmedInPlaceOriginal: original } of legPayments) {
        if (original) {
          // La fila confirmada en sitio era el pago online del cliente: no se
          // anula, vuelve a `pending` tal como estaba (sigue esperando que el
          // personal lo registre).
          await tx.payments.update({
            where: { id: payment.id },
            data: {
              state: 'pending',
              store_payment_method_id: original.store_payment_method_id ?? null,
              bank_account_id: original.bank_account_id ?? null,
              amount: original.amount,
              transaction_id: original.transaction_id ?? payment.transaction_id,
              gateway_reference: original.gateway_reference ?? null,
              paid_at: original.paid_at ?? null,
              updated_at: new Date(),
              gateway_response: original.gateway_response ?? Prisma.DbNull,
            },
          });
          continue;
        }
        await tx.payments.update({
          where: { id: payment.id },
          data: {
            state: 'cancelled',
            updated_at: new Date(),
            gateway_response: {
              ...((payment.gateway_response as object) ?? {}),
              cancellation_reason: cancellationReason,
            },
          },
        });
      }
    });
  }

  /**
   * Respuesta de cobro con tramos: `payment` conserva la forma histórica
   * (primer `transaction_id` + vuelto total del acto) y `payments[]` sólo se
   * añade en multi (2+ tramos), igual que el POS — el escalar queda
   * byte a byte para la app móvil.
   */
  private buildLeggedPaymentResponse(
    legPayments: Array<{
      payment: any;
      leg: NormalizedLeg;
      transactionId: string;
    }>,
    change: number,
  ): {
    payment: { transaction_id: string; change: number };
    payments?: Array<{
      id: number;
      transaction_id: string;
      store_payment_method_id: number;
      amount: number;
      change: number;
      payment_method: string;
    }>;
  } {
    const payment = {
      transaction_id: legPayments[0].transactionId,
      change,
    };
    if (legPayments.length < 2) return { payment };
    return {
      payment,
      payments: legPayments.map(({ payment: row, leg, transactionId }) => ({
        id: row.id,
        transaction_id: transactionId,
        store_payment_method_id: leg.store_payment_method_id,
        amount: leg.amount,
        change: leg.is_cash ? change : 0,
        payment_method: leg.display_name,
      })),
    };
  }

  /**
   * Record a sale movement in the cash register if the feature is enabled
   * and the user has an active session. Non-blocking.
   */
  private async recordPayOrderCashMovement(
    storeId: number,
    orderId: number,
    amount: number,
    paymentMethodType: string,
    paymentId?: number,
  ): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (!cr_settings?.enabled) return;

      // Only track non-cash if setting enabled
      if (paymentMethodType !== 'cash' && !cr_settings.track_non_cash_payments)
        return;

      const userId = RequestContextService.getUserId();
      if (!userId) return;

      const session = await this.sessionsService.getActiveSession(userId);
      if (!session) return;

      await this.movementsService.recordSaleMovement(session.id, {
        store_id: storeId,
        user_id: userId,
        amount,
        payment_method: paymentMethodType,
        order_id: orderId,
        payment_id: paymentId,
      });
    } catch {
      // Non-critical: don't fail the payment if movement recording fails
    }
  }

  /**
   * B4 — contra-movimiento de caja de los pagos anulados por `cancelPayment`.
   * Solo revierte pagos que SÍ dejaron un movimiento `sale` en caja (si la
   * caja estaba apagada o el pago era no-efectivo sin rastreo, no hay nada
   * que revertir). No crítico, igual que `recordPayOrderCashMovement`.
   *
   * Resolución de sesión por movimiento (ya no siempre la del operador que
   * anula, que dejaba la venta contada doble si ese admin no tenía caja
   * abierta):
   * 1. La sesión ORIGINAL del movimiento `sale` (`movement.session_id`), si
   *    sigue `open` — el contra-movimiento cae en el mismo cuadre que la
   *    venta que revierte.
   * 2. Si esa sesión ya cerró, la sesión activa del operador que anula
   *    (`getActiveSession(userId)`).
   * 3. Si tampoco hay una sesión activa del operador, no hay dónde asentar
   *    el refund: se deja constancia explícita con `logger.warn` (antes
   *    salía en silencio y la venta original quedaba contada en el cuadre
   *    sin su reversa) y se continúa con los demás movimientos.
   *
   * El `user_id` que queda en el movimiento de reversa es siempre el del
   * operador que anula (RequestContextService.getUserId()), sin importar en
   * qué sesión caiga.
   */
  private async reversePaymentCashMovements(
    storeId: number,
    orderId: number,
    paymentIds: number[],
  ): Promise<void> {
    if (paymentIds.length === 0) return;
    try {
      const userId = RequestContextService.getUserId();
      if (!userId) return;
      const saleMovements = await this.prisma.cash_register_movements.findMany({
        where: {
          order_id: orderId,
          type: 'sale',
          payment_id: { in: paymentIds },
        },
        select: {
          session_id: true,
          payment_id: true,
          amount: true,
          payment_method: true,
        },
      });
      if (saleMovements.length === 0) return;

      const originalSessionIds = Array.from(
        new Set(saleMovements.map((m) => m.session_id)),
      );
      const originalSessions = await this.prisma.cash_register_sessions.findMany({
        where: { id: { in: originalSessionIds } },
        select: { id: true, status: true },
      });
      const originalSessionStatusById = new Map(
        originalSessions.map((s) => [s.id, s.status]),
      );

      // Lazily resolved and cached: most calls only revert a single
      // operator's own sale, so we avoid the extra query unless an
      // original session actually turns out closed.
      let operatorSessionResolved = false;
      let operatorSessionId: number | null = null;
      const resolveOperatorSessionId = async (): Promise<number | null> => {
        if (!operatorSessionResolved) {
          const session = await this.sessionsService.getActiveSession(userId);
          operatorSessionId = session?.id ?? null;
          operatorSessionResolved = true;
        }
        return operatorSessionId;
      };

      for (const movement of saleMovements) {
        const originalStatus = originalSessionStatusById.get(movement.session_id);
        let targetSessionId: number | null =
          originalStatus === 'open' ? movement.session_id : null;

        if (!targetSessionId) {
          targetSessionId = await resolveOperatorSessionId();
        }

        if (!targetSessionId) {
          this.logger.warn(
            `reversePaymentCashMovements: sin sesión de caja abierta para revertir la venta ` +
              `de la orden #${orderId}, pago #${movement.payment_id ?? 'n/a'} ` +
              `(sesión original #${movement.session_id} ya cerrada y el operador #${userId} ` +
              `no tiene sesión activa). La venta original queda sin reversar en el cuadre.`,
          );
          continue;
        }

        await this.movementsService.recordRefundMovement(targetSessionId, {
          store_id: storeId,
          user_id: userId,
          amount: Number(movement.amount),
          payment_method: movement.payment_method ?? '',
          order_id: orderId,
          payment_id: movement.payment_id ?? undefined,
          reference: 'payment_cancelled',
        });
      }
    } catch {
      // Non-critical: la anulación ya quedó persistida.
    }
  }

  private async generateTransactionId(): Promise<string> {
    return `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
  }

  private async computeAndPersistEta(
    orderId: number,
    paidAt: Date,
  ): Promise<void> {
    try {
      const orderWithItems = await this.prisma.orders.findUnique({
        where: { id: orderId },
        include: {
          order_items: {
            include: {
              products: {
                select: { preparation_time_minutes: true },
              },
              // R8-F2 — `computeEta` resuelve variante ?? producto ??
              // default: sin este include la variante nunca llegaba.
              product_variants: {
                select: { preparation_time_minutes: true },
              },
            },
          },
          shipping_method: {
            select: { transit_time_minutes: true },
          },
        },
      });

      if (!orderWithItems) return;

      const settings = await this.settingsService.getSettings();

      const eta = this.orderEtaService.computeEta(
        orderWithItems.order_items.map((item) => ({
          preparation_time_minutes:
            item.products?.preparation_time_minutes ?? null,
          variant_preparation_time_minutes:
            item.product_variants?.preparation_time_minutes ?? null,
        })),
        orderWithItems.shipping_method?.transit_time_minutes ?? 0,
        (settings as any)?.operations,
        paidAt,
      );

      await this.prisma.orders.update({
        where: { id: orderId },
        data: {
          estimated_ready_at: eta.readyAt,
          estimated_delivered_at: eta.deliveredAt,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to compute ETA for order #${orderId}: ${error.message}`,
      );
    }
  }

  /**
   * Round 1 MAJOR #13 — consumo autoritativo del cupón en `flow/pay`.
   *
   * Reglas:
   *  - La orden debe tener `coupon_id` snapshot (seteado por el editor o por
   *    el POS que crea la orden).
   *  - NO debe existir todavía un `coupon_uses` para esta orden y cupón:
   *    el método es idempotente, así un retry de `flow/pay` o un webhook
   *    duplicado de `confirmPayment` no produce doble consumo.
   *  - Incrementa `coupons.current_uses` con un `updateMany` idempotente
   *    (`current_uses < max_uses`, `state='active'`). count=0 ⇒ el cupón
   *    ya no es consumible (agotado o desactivado) y se aborta con
   *    `ORD_EDIT_COUPON_COMMIT_001` (la orden NO queda pagada).
   *
   * El descuento persistido se toma de `orders.discount_amount` que el
   * editor / POS ya calculó y guardó; acá NO recalculamos para no
   * divergir del cupón que el cliente vio.
   */
  private async commitCouponUseForOrder(
    orderId: number,
    transaction?: Prisma.TransactionClient,
    afterCommit: Array<() => Promise<void>> = [],
  ): Promise<void> {
    const client = transaction ?? this.prisma;
    const order = await client.orders.findFirst({
      where: { id: orderId },
      // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 MAJOR.
      // `coupon_code` is needed by the audit row so SIEM rules can
      // answer "which coupon was just consumed?" without joining against
      // `coupons.code`. `store_id` is also surfaced here because the
      // audit helper expects a per-tenant trail.
      select: {
        id: true,
        coupon_id: true,
        coupon_code: true,
        discount_amount: true,
        store_id: true,
      },
    });
    if (!order?.coupon_id) return;

    // Idempotencia: si ya hay un `coupon_uses` para esta orden, no
    // hacemos nada. La UNIQUE implícita `(order_id, coupon_id)` no está
    // declarada en el schema, así que la chequeamos explícitamente.
    //
    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.18 · defense-in-depth guard.
    // Esta guarda es la ÚNICA defensa contra el doble consumo cuando
    // `flow/pay` (direct) y `confirmPayment` (online) ambos llaman a este
    // helper sobre la misma orden: la combinación `(order_id, coupon_id)`
    // debe ser única por construcción. Sin esta guarda, dos `coupon_uses`
    // podrían coexistir para la misma orden y dos cargos podrían
    // incrementar el contador dos veces. La guarda aquí es explícita
    // porque el schema no tiene UNIQUE sobre ese par.
    const existing = await client.coupon_uses.findFirst({
      where: { order_id: orderId, coupon_id: order.coupon_id },
      select: { id: true },
    });
    if (existing) return;

    // El cupón pudo haber sido desactivado o cambiado por el operador
    // entre el editor y el cobro. Re-leemos su estado actual bajo el
    // scope del store para confirmar que sigue consumible.
    const coupon = await client.coupons.findFirst({
      where: { id: order.coupon_id, store_id: order.store_id },
      select: {
        id: true,
        is_active: true,
        current_uses: true,
        max_uses: true,
      },
    });
    if (!coupon) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
        undefined,
        { stage: 'commit_coupon_lookup', coupon_id: order.coupon_id },
      );
    }
    if (!coupon.is_active) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
        undefined,
        {
          stage: 'commit_coupon_state',
          coupon_id: order.coupon_id,
          is_active: coupon.is_active,
        },
      );
    }
    if (
      coupon.max_uses !== null &&
      coupon.max_uses !== undefined &&
      coupon.current_uses >= coupon.max_uses
    ) {
      throw new VendixHttpException(
        ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
        undefined,
        {
          stage: 'commit_coupon_exhausted',
          coupon_id: order.coupon_id,
          current_uses: coupon.current_uses,
          max_uses: coupon.max_uses,
        },
      );
    }

    // Insert + increment en una transacción para que el `coupon_uses`
    // aparezca o no aparezca junto con el contador. Si el `updateMany`
    // del contador falla (race con otro cargo), no dejamos una fila
    // huérfana de `coupon_uses`.
    //
    // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 1 MAJOR #10 / Round 3.5.
    // El `updateMany` es la ÚNICA operación de incremento del contador:
    // usar `update` con `current_uses: { increment: 1 }` directo NO es
    // idempotente — reintentaría el increment incluso cuando el row ya
    // no califica. `updateMany` con el WHERE condicional (`state` +
    // cupo disponible) hace que cualquier retry después de un commit
    // exitoso devuelva count=0 cuando el cupo ya se agotó, evitando el
    // sobreconteo silencioso. count=0 ⇒ `ORD_EDIT_COUPON_COMMIT_001`
    // (abort, la orden NO queda pagada).
    const write = async (tx: Prisma.TransactionClient) => {
      await tx.coupon_uses.create({
        data: {
          coupon_id: order.coupon_id as number,
          order_id: orderId,
          customer_id: null,
          discount_applied: order.discount_amount ?? 0,
        },
      });
      const inc = await tx.coupons.updateMany({
        where: {
          id: order.coupon_id as number,
          is_active: true,
          // Sin límite (`max_uses = null`) ⇒ siempre incrementa.
          // Con límite ⇒ todavía hay cupo.
          OR: [
            { max_uses: null },
            { max_uses: { gt: coupon.current_uses } },
          ],
        },
        data: { current_uses: { increment: 1 } },
      });
      if (inc.count === 0) {
        // Otro cargo ganó la carrera entre el `findFirst` de arriba y
        // este update. El `coupon_uses` que acabamos de crear queda
        // dentro de la misma tx, así que el rollback automático lo
        // elimina y el caller verá `ORD_EDIT_COUPON_COMMIT_001`.
        throw new VendixHttpException(
          ErrorCodes.ORD_EDIT_COUPON_COMMIT_001,
          undefined,
          { stage: 'commit_coupon_race', coupon_id: order.coupon_id },
        );
      }
    };
    if (transaction) await write(transaction);
    else await this.prisma.$transaction(write);

    // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 MAJOR.
    // Audit row AFTER commit (no antes — un fallo del `updateMany` ya
    // hizo rollback y no debe quedar un audit que afirme lo contrario).
    // El campo `coupon_code_before` se persiste aquí, no en el editor,
    // porque es el momento real de consumo: la UI puede ver un cupón
    // "WELCOME5" en el editor pero el `coupon_id` real se resuelve
    // recién en `flow/pay`; registrar aquí garantiza que el timeline
    // muestra el cupón final, no el que el operador había tecleado.
    const audit = async () => {
      try {
        await this.auditService.logCustom(
          (RequestContextService.getUserId() ?? 0) as number,
          'order.coupon_committed',
          AuditResource.ORDERS,
          {
            request_id: RequestContextService.getRequestId() ?? null,
            store_id: order.store_id ?? null,
            order_id: orderId,
            coupon_id: order.coupon_id,
            coupon_code_before: order.coupon_code ?? null,
            discount_applied: order.discount_amount ?? 0,
          },
          orderId,
        );
      } catch (auditErr) {
        // Audit es observabilidad, nunca bloquea el commit del cupón.
        this.logger.warn(
          `[order.coupon_committed audit failed] order=${orderId}: ${(auditErr as Error).message}`,
        );
      }
    };
    if (transaction) afterCommit.push(audit);
    else await audit();
  }

  /**
   * Round 1 MAJOR #11 — traductor único para los rechazos del flujo de pago.
   *
   * El caller (frontend POS, soporte, BI) ve SIEMPRE
   * `ORD_FLOW_PAYMENT_FAILED_001` (HTTP 409) — un solo código de superficie
   * que indica "este intento de cobro falló". La causa original viaja en
   * `details.cause_code` (código tipado cuando aplique) y `details.stage`
   * (etiqueta humana del punto de falla) para que la UI pueda mostrar
   * detalles accionables y soporte pueda pivotar sin reparsear strings.
   *
   * Tres modos:
   *  1. `cause` es `VendixHttpException`: el `cause_code` se toma de su
   *     `errorCode` y el `stage` provisto por el caller.
   *  2. `cause` es `Error` plano: `cause_code = 'n/a'`, mensaje libre.
   *  3. `cause` es un objeto (`{ message, ...rest }`): se usa como `details`
   *     crudo y `cause_code` viene del tercer argumento explícito.
   *
   * El `stage` NUNCA viaja como código de error — es solo una etiqueta
   * legible. La UI y soporte discriminan por `cause_code`.
   */
  /**
   * 1060 paso 3 — compensación de estado del claim de `payOrder`.
   *
   * Si el finish falla tras el claim, la orden quedaría varada en
   * `processing` (estado intermedio del race-claim, no un estado de negocio
   * válido para reintentar el cobro). Se restaura el estado previo al claim
   * para que el cajero pueda reintentar. Best-effort: si la restauración
   * falla, el operador ve la orden en `processing` y la mueve a mano (mismo
   * contrato que los rollbacks ya existentes en `payOrder`).
   *
   * También la llama el catch externo si el cobro falla antes de crear pago.
   * Sólo restaura desde `processing`: no pisa un estado que otra operación ganó.
   */
  private async restorePreClaimState(
    orderId: number,
    preClaimState: OrderState | null,
  ): Promise<void> {
    if (!preClaimState) {
      return;
    }
    try {
      await this.prisma.orders.updateMany({
        where: { id: orderId, state: 'processing' },
        data: { state: preClaimState, updated_at: new Date() },
      });
    } catch (restoreErr) {
      this.logger.error(
        `[payOrder pre-claim state restore failed] order=${orderId}: ${(restoreErr as Error).message}`,
      );
    }
  }

  /** Undo only a digital reservation that was never handed to its processor. */
  private async compensateUnprocessedDigitalReservation(
    orderId: number,
    storeId: number,
    paymentId: number,
    preClaimState: OrderState | null,
    draftReservations: DraftReservationKey[],
  ): Promise<void> {
    if (!preClaimState) {
      throw new Error(`Missing pre-claim state for digital reservation ${paymentId}`);
    }
    await this.prisma.$transaction(async (tx) => {
      const locked = await lockOrderLifecycle(tx, orderId, storeId);
      if (locked.state !== 'processing' && locked.state !== 'pending_payment') {
        throw new Error(`Digital reservation order changed state: order=${orderId} state=${locked.state}`);
      }
      const cancelled = await tx.payments.updateMany({
        where: { id: paymentId, order_id: orderId, state: 'pending' },
        data: { state: 'cancelled', updated_at: new Date() },
      });
      if (cancelled.count !== 1) {
        throw new Error(`Digital reservation already changed: payment=${paymentId}`);
      }
      if (preClaimState === 'draft') {
        for (const reservation of draftReservations) {
          await this.stockLevelManager.releaseReservationQuantity(
            'order',
            orderId,
            reservation.productId,
            reservation.variantId,
            reservation.quantity,
            'cancelled',
            tx,
            { newestFirst: true },
          );
        }
      }
      const restored = await tx.orders.updateMany({
        where: { id: orderId, store_id: storeId, state: locked.state as OrderState },
        data: { state: preClaimState, updated_at: new Date() },
      });
      if (restored.count !== 1) {
        throw new Error(`Digital reservation claim changed: order=${orderId}`);
      }
    });
  }

  /** Release only the quantity reserved by this draft claim, then reopen it
   * for retry. Both effects commit together; never release an older order
   * reserve. Bounded by `reservation.quantity` (docs/plans/no-overselling-
   * stock-guard-plan.md step 4): `promoteDraftToCreated` may have topped up
   * an identity that already carried an older reservation (e.g. a second
   * line of the same product placed earlier by `create`/`addItems`) — a
   * full-identity release here would wipe that older reservation too. */
  private async compensateClaimedDraftPayment(
    orderId: number,
    storeId: number,
    reservations: DraftReservationKey[],
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        for (const reservation of reservations) {
          await this.stockLevelManager.releaseReservationQuantity(
            'order',
            orderId,
            reservation.productId,
            reservation.variantId,
            reservation.quantity,
            'cancelled',
            tx,
            { newestFirst: true },
          );
        }
        const restored = await tx.orders.updateMany({
          where: { id: orderId, store_id: storeId, state: 'processing' },
          data: { state: 'draft', updated_at: new Date() },
        });
        if (restored.count !== 1) {
          throw new Error(`Draft payment claim changed before compensation: order=${orderId}`);
        }
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Emite `payment.received` por cada tramo/pago de un cobro directo de
   * `payOrder`/`confirmPayment` — MISMA forma y MISMAS fuentes de datos que
   * el emisor de referencia del POS (`payments.service.ts` ~1674-1891):
   * lee `order_items` con sus impuestos tipados, arma `sale_tax` con
   * `buildOrderSaleTaxPayload` como respaldo, resuelve la retención sufrida
   * POR TIPO DE OPERACIÓN (`resolveSufferedByOperation`, decisión del dueño
   * 2026-09-26) UNA vez por orden y arma los payloads con
   * `buildPaymentReceivedEvents` (cada pago usa su propio `sale_share`,
   * prorrateado SECUENCIALMENTE por `createLegPayments` al crearse).
   *
   * SÓLO se invoca desde el camino de ÉXITO de cada rama de `payOrder`/
   * `confirmPayment` (después de que el `updateOrderState` que cierra el
   * cobro terminó bien), nunca desde una compensación (`cancelLegPayments`):
   * una carga compensada no debe dejar ni evento emitido ni retención
   * persistida.
   *
   * Decisión de diseño (retención + huérfanos en compensación): la
   * retención se resuelve y persiste ACÁ — después del commit del estado —
   * y NO dentro de la transacción de `createLegPayments`. Si se persistiera
   * ahí (junto con los `payments.create` de cada tramo) y el `updateOrderState`
   * posterior fallara, `cancelLegPayments` sólo anula los `payments`
   * (los marca `cancelled`); nunca toca `withholding_calculations`, así que
   * las filas de retención de una venta que nunca se cerró quedarían
   * huérfanas. Persistir aquí, gateado por el mismo punto de llamada que el
   * evento, garantiza la regla: carga compensada = sin retención persistida
   * y sin evento.
   *
   * Orden interno (PR #858 hallazgos 3 y 5): se prorratea la retención a la
   * porción de este cobro, se PERSISTE y recién entonces se emite, con sólo
   * las líneas persistidas.
   *
   * Envuelta en try/catch que sólo loguea — mismo contrato que
   * `emitPosSaleCompletedIfFullyPaid`: un fallo leyendo impuestos o
   * resolviendo retención nunca debe convertir un cobro ya exitoso en un
   * error HTTP, y ninguna especificación histórica con mocks incompletos
   * puede romperse por esto.
   */
  private async emitLegPaymentReceivedEvents(
    orderId: number,
    order: Awaited<ReturnType<OrderFlowService['getOrder']>>,
    legPayments: Array<{ payment: any; leg: NormalizedLeg }>,
  ): Promise<void> {
    try {
      if (!legPayments || legPayments.length === 0) return;
      // Con 2+ tramos, un tramo sin `sale_share` caería a los totales de la
      // orden y cada tramo reconocería el ingreso completo. Sin asiento es
      // mejor que ingreso duplicado: se registra el error y no se emite.
      if (
        legPayments.length > 1 &&
        legPayments.some(({ payment }) => !(payment as any).sale_share)
      ) {
        this.logger.error(
          `[emitLegPaymentReceivedEvents skipped] order=${orderId}: tramo sin sale_share en cobro multitramo; payment.received no emitido`,
        );
        return;
      }
      const orderItemsWithTaxes = await this.prisma.order_items.findMany({
        where: { order_id: orderId, cancelled_at: null },
        select: {
          total_price: true,
          discount_amount: true,
          quantity: true,
          tax_amount_item: true,
          weight: true,
          price_unit_quantity: true,
          item_type: true,
          order_item_taxes: {
            select: { tax_type: true, tax_amount: true, tax_rate: true },
          },
        },
      });
      const sale_tax = buildOrderSaleTaxPayload({
        product_tax_rows: orderItemsWithTaxes.flatMap((item) =>
          (item.order_item_taxes || []).map((tax) => ({
            ...tax,
            taxable_amount: Number(item.total_price || 0),
          })),
        ),
        order: order as any,
        order_items: orderItemsWithTaxes as any,
      });

      let wh: WithholdingResolution = {
        lines: [],
        uvt_value_used: 0,
        counterparty_type: null,
      };
      // PR #858 — orden ya facturada (factura aceptada a medio pagar y luego
      // se cobra el resto): `onPaymentReceived` toma la rama «con factura» e
      // IGNORA la retención, y la factura ya la registró. Retener aquí dejaba
      // una fila sin asiento que el certificado contaba dos veces. Mismo
      // criterio que el asiento (`resolvePaymentInvoiceBranch`). Si la
      // comprobación falla se conserva el comportamiento previo.
      let orderAlreadyInvoiced = false;
      try {
        const branch = await resolvePaymentInvoiceBranch(this.prisma as any, {
          order_id: orderId,
          organization_id: order.stores?.organization_id,
        });
        orderAlreadyInvoiced = branch.has_invoice;
      } catch (error) {
        this.logger.warn(
          `[emitLegPaymentReceivedEvents] order=${orderId}: no se pudo comprobar si la orden ya está facturada; se sigue sin ese corte: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (orderAlreadyInvoiced) {
        this.logger.log(
          `[emitLegPaymentReceivedEvents] order=${orderId}: orden ya facturada; payment.received se emite sin retención.`,
        );
      } else if (this.withholdingFlow) {
        try {
          const customer_id = order.customer_id
            ? Number(order.customer_id)
            : null;
          const withholdingItems = orderItemsWithTaxes.map((item) => ({
            product_type: item.item_type,
            base: Number(item.total_price || 0),
            // PR #858 hallazgo 4 — reteIVA se calcula sobre el IVA de la
            // operación, no sobre todos los impuestos de la línea: INC/ICA
            // no entran. `tax_type` nulo = IVA (filas legadas sin tipar,
            // regla de `vendix-tax-typing`).
            ivaAmount: (item.order_item_taxes || [])
              .filter((tax) => (tax.tax_type ?? 'iva') === 'iva')
              .reduce((sum, tax) => sum + Number(tax.tax_amount || 0), 0),
          }));
          wh = await this.withholdingFlow.resolveSufferedByOperation({
            organization_id: order.stores?.organization_id,
            store_id: order.store_id,
            customer_id,
            items: withholdingItems,
          });
        } catch (error) {
          this.logger.warn(
            `resolveSufferedByOperation failed for order ${orderId}; degrading to no withholding: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          wh = { lines: [], uvt_value_used: 0, counterparty_type: null };
        }
      } else {
        this.logger.warn(
          `WithholdingFlowService no disponible para la orden ${orderId}; payment.received se emite sin retención.`,
        );
      }

      // PR #858 hallazgo 3 — con abonos previos este cobro cubre sólo
      // `grand_total − settledAmount`, pero `wh` se resolvió sobre TODOS los
      // ítems. Se escala a la porción de este cobro (Σ tramos / grand_total)
      // ANTES de repartir entre tramos; un cobro por el total es identidad.
      const portion = legPayments.reduce(
        (sum, { leg }) => sum + Number(leg.amount || 0),
        0,
      );
      const proratedLines = prorateWithholdingLines(
        wh.lines,
        portion,
        Number((order as any).grand_total || 0),
      );

      // PR #858 hallazgo 5 — persistir ANTES de emitir: un débito en la 1355
      // sin filas `withholding_calculations` que lo respalden es peor que un
      // evento sin retención. Sólo se emite lo que se persistió (mismo filtro
      // que `persistWithholdingLines`: concepto y monto > 0). Si la
      // persistencia falla, se emite sin retención y se deja log.error —
      // misma regla que `invoice-flow.service.ts` (`resolveAndPersist...`).
      let emittedLines: WithholdingLine[] = [];
      if (this.withholdingFlow && !orderAlreadyInvoiced) {
        const persistable = proratedLines.filter(
          (line) => typeof line.concept_id === 'number' && line.amount > 0,
        );
        try {
          await this.withholdingFlow.persistWithholdingLines({
            organization_id: order.stores?.organization_id,
            store_id: order.store_id,
            invoice_id: null,
            // PR #858 hallazgo 2 — la factura de esta orden enlaza estas filas
            // en vez de insertar la sufrida otra vez.
            order_id: orderId,
            customer_id: order.customer_id ? Number(order.customer_id) : null,
            role: 'suffered',
            counterparty_type: wh.counterparty_type,
            uvt_value_used: wh.uvt_value_used,
            lines: persistable,
          });
          emittedLines = persistable;
        } catch (error) {
          this.logger.error(
            `[withholding persist failed] order=${orderId}: payment.received se emite sin retención: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          emittedLines = [];
        }
      }

      const payloads = buildPaymentReceivedEvents({
        order: {
          id: orderId,
          order_number: order.order_number,
          store_id: order.store_id,
          organization_id: order.stores?.organization_id,
          customer_id: order.customer_id,
          subtotal_amount: order.subtotal_amount,
          tip_amount: order.tip_amount,
        },
        sale_tax,
        payments: legPayments.map(({ payment, leg }) => ({
          id: payment.id,
          amount: leg.amount,
          currency: payment.currency,
          accounting_method: leg.accounting_method,
          sale_share: (payment as any).sale_share as
            | PaymentReceivedSaleFields
            | undefined,
        })),
        withholding_lines: emittedLines,
        currency: order.currency || legPayments[0].payment.currency,
        user_id: RequestContextService.getUserId() ?? null,
      });

      // En serie: el listener contable numera el asiento con MAX+1, así que
      // dos tramos emitidos a la vez chocan en `entry_number` (P2002).
      for (const payload of payloads) {
        try {
          await this.eventEmitter.emitAsync('payment.received', payload);
        } catch (error) {
          this.logger.error(
            `[payment.received listener failed] order=${orderId} payment=${payload.payment_id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `[emitLegPaymentReceivedEvents failed] order=${orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Dispara la facturación electrónica de una orden POS cobrada por el flujo
   * de orden (`flow/pay` desde el detalle, `confirmPayment` del pago online).
   *
   * Hasta acá el ÚNICO emisor de `POS_SALE_COMPLETED_EVENT` era
   * `PaymentsService.processPosPayment` (cobro de mostrador), así que las
   * órdenes —mesas incluidas— cobradas desde el detalle nunca se facturaban.
   * Se emite el MISMO evento con el MISMO payload para que
   * `PosSaleCompletedListener` sea el único dueño de la emisión.
   *
   * Compuertas (todas contra la orden PERSISTIDA, después del commit):
   *  - venta presencial (`isPresentialPosSale`): `channel = 'pos'` o mesa
   *    abierta por QR (`channel = 'ecommerce'` + `delivery_type = 'dine_in'`),
   *    que se factura como venta de mostrador. El ecommerce de domicilio /
   *    recogida se factura por su propio carril (checkout + webhook).
   *  - sin `active_financial_split_id`: las cuentas divididas se facturan por
   *    cuenta (`createFromFinancialAccount`); `createFromOrder` lo rechaza.
   *  - pagada COMPLETA: Σ pagos `succeeded`/`captured` ≥ `grand_total`. Un
   *    abono parcial no es una venta cerrada.
   *  - sin documento ya transmitido/anulado: la última factura de venta debe
   *    no existir o estar en `draft`/`validated`/`rejected` — exactamente los
   *    estados sobre los que `PosFiscalEmissionService.runEmission` actúa
   *    (reusa ese documento, nunca crea otro). `sent`/`accepted` ya salieron;
   *    `voided`/`cancelled` son una anulación deliberada.
   *
   * `auto_emit` se resuelve aquí igual que en payments.service
   * (`invoicing.pos.auto_emit ?? DEFAULT_POS_AUTO_EMIT`) y lo APLICA el
   * listener; no hay una segunda lectura del flag.
   *
   * Nunca lanza: el pago ya está confirmado y la facturación no puede
   * revertirlo ni romper la respuesta del cobro.
   */
  private async emitPosSaleCompletedIfFullyPaid(
    orderId: number,
    source: string,
  ): Promise<void> {
    try {
      const order = await this.prisma.orders.findFirst({
        where: { id: orderId },
        select: {
          id: true,
          store_id: true,
          order_number: true,
          channel: true,
          delivery_type: true,
          grand_total: true,
          active_financial_split_id: true,
          payments: { select: { state: true, amount: true } },
        },
      });
      if (!order || !isPresentialPosSale(order)) return;
      if (order.active_financial_split_id != null) return;

      const paid = (order.payments ?? [])
        .filter((p) => p.state === 'succeeded' || p.state === 'captured')
        .reduce(
          (sum, p) => sum.plus(new Prisma.Decimal(p.amount ?? 0)),
          new Prisma.Decimal(0),
        );
      if (paid.lt(new Prisma.Decimal(order.grand_total ?? 0))) return;

      const latestInvoice = await this.prisma.invoices.findFirst({
        where: { order_id: orderId, invoice_type: 'sales_invoice' },
        orderBy: { created_at: 'desc' },
        select: { id: true, status: true },
      });
      if (
        latestInvoice &&
        !['draft', 'validated', 'rejected'].includes(latestInvoice.status)
      ) {
        return;
      }

      let autoEmit = DEFAULT_POS_AUTO_EMIT;
      try {
        const settings = await this.settingsService.getSettings();
        const flag = (settings as any)?.invoicing?.pos?.auto_emit;
        if (typeof flag === 'boolean') autoEmit = flag;
      } catch (settingsErr) {
        this.logger.warn(
          `[pos invoice emit] order=${orderId}: no se pudieron leer los ajustes, se usa el default auto_emit=${DEFAULT_POS_AUTO_EMIT}: ${(settingsErr as Error).message}`,
        );
      }

      const context = RequestContextService.getContext();
      let organizationId = context?.organization_id;
      if (typeof organizationId !== 'number') {
        // Defensa: los webhooks (webhook-handler → confirmPayment) corren dentro
        // de `StoreContextRunner.runInStoreContext`, que SÍ fija
        // organization_id desde la tienda. Este fallback cubre un llamador
        // futuro que invoque el flujo con un contexto sin organización.
        const store = await this.prisma.stores.findFirst({
          where: { id: order.store_id },
          select: { organization_id: true },
        });
        organizationId = store?.organization_id ?? undefined;
      }
      if (typeof organizationId !== 'number') {
        this.logger.warn(
          `[pos invoice emit] order=${orderId}: sin organization_id resoluble; no se dispara la facturación (${source})`,
        );
        return;
      }

      this.eventEmitter.emit(POS_SALE_COMPLETED_EVENT, {
        organization_id: organizationId,
        store_id: order.store_id,
        user_id: context?.user_id,
        order_id: orderId,
        order_number: order.order_number,
        auto_emit: autoEmit,
      } as PosSaleCompletedEvent);
    } catch (err) {
      this.logger.error(
        `[pos invoice emit] order=${orderId} (${source}) falló al preparar la emisión: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
    }
  }

  private wrapPaymentFailure(
    stage: string,
    cause: VendixHttpException | Error | Record<string, unknown>,
    explicitCauseCode?: string,
  ): VendixHttpException {
    let causeCode = explicitCauseCode ?? 'n/a';
    let message: string | undefined;
    let extraDetails: Record<string, unknown> = {};

    if (cause instanceof VendixHttpException) {
      causeCode = (cause as any).errorCode ?? causeCode;
      message = cause.message;
      // VendixHttpException stores public details in HttpException's
      // response body, not on a `.details` property of the instance.
      const causeResponse = cause.getResponse();
      const causeDetails = typeof causeResponse === 'object' && causeResponse !== null
        ? (causeResponse as { details?: Record<string, unknown> }).details
        : undefined;
      if (causeDetails && typeof causeDetails === 'object') {
        extraDetails = { ...causeDetails };
      }
    } else if (cause instanceof Error) {
      message = cause.message;
    } else if (cause && typeof cause === 'object') {
      message =
        typeof (cause as any).message === 'string'
          ? (cause as any).message
          : undefined;
      extraDetails = { ...cause };
    }

    return new VendixHttpException(
      ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001,
      message,
      {
        stage,
        cause_code: causeCode,
        ...extraDetails,
      },
    );
  }
}
