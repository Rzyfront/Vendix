import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Optional,
  Logger,
} from '@nestjs/common';
import { Prisma, refunds_state_enum } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import {
  buildTaxBreakdown,
  scaleBreakdownToTotal,
  type TaxBreakdownItem,
} from 'src/common/interfaces/tax-breakdown.interface';
import {
  RefundCalculationService,
  RefundCalculationResult,
  REFUND_LEDGER_STATES,
} from './refund-calculation.service';
import { RefundCoverageService } from './refund-coverage.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { resolveRefundStockUnits } from '../../../products/services/packaging.util';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { RefundPayoutChannel } from '../dto/resolve-refund.dto';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import {
  MovementsService,
  type RefundCashMovementOutcome,
} from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
import { KitchenFireService } from '../../../kitchen-fire/kitchen-fire.service';
import { AutoEntryService } from '../../../accounting/auto-entries/auto-entry.service';
import { AuditResource } from '@common/audit/audit.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { PaymentGatewayService } from '../../../payments/services/payment-gateway.service';
import {
  ManualRefundDeliveryService,
  MANUAL_REFUND_DELIVERY_KEY,
  MANUAL_REFUND_DELIVERY_SOURCE,
  type ManualRefundDeliveryPayload,
} from '../../../accounting/auto-entries/manual-refund-delivery.service';
import {
  resolveEffectiveRefundChannel,
  awaitsExternalReversal,
  API_REVERSIBLE_REFUND_PROCESSORS,
  type EffectiveRefundChannel,
} from './refund-channel.util';
import { REFUNDABLE_ORDER_STATES } from '../order-action-policy.util';
import { OrderHistoryService } from '../../order-history/order-history.service';

// order-truth-and-invoice-tz plan (B1b) — was a hand-synced local copy of
// `['delivered', 'finished']`; now reuses the single source of truth in
// `order-action-policy.util.ts` (`canRefund`/`getAvailableActions` read the
// same array) so this guard can never drift from the read-side action list.
const REFUNDABLE_STATES: ReadonlyArray<string> = REFUNDABLE_ORDER_STATES;

/** ADR-12 — prefix of the deterministic `refund_transaction_id` placeholders
 * that `recordCancellationPendingRefunds` stamps on cancellation refunds.
 * A placeholder is NOT a gateway id: `manuallyResolveRefund` lets the real
 * payout reference replace it, while a genuine gateway id stays protected.
 */
export const CANCELLATION_REFUND_TX_PREFIX = 'adr12:cancel:';

export function buildCancellationRefundTxId(orderId: number, leg: string): string {
  return `${CANCELLATION_REFUND_TX_PREFIX}o${orderId}:${leg}`;
}

export function isCancellationRefundPlaceholder(
  txId: string | null | undefined,
): boolean {
  return !!txId && txId.startsWith(CANCELLATION_REFUND_TX_PREFIX);
}

/**
 * CP-REFUND-FLOW-REDESIGN paso 4 — aviso explícito del movimiento de caja
 * que viaja en la respuesta del refund (`cash_movement`). `skipped` solo
 * cuando el módulo de caja está apagado (no hay nada que entregar);
 * cualquier otro camino entrega durable (`recorded`) o deja fila en el
 * outbox (`pending` + `failure_id` consultable).
 */
export type RefundCashMovementNotice =
  | RefundCashMovementOutcome
  | { status: 'skipped'; reason: string };

/**
 * CP-REFUND-FLOW-REDESIGN paso 6 — post-commit work collected in-tx by the
 * dish branch (`processDishRefundLine`). SSE pushes and the COGS reclass run
 * only after the refund commits (same rule as every other post-commit effect:
 * accounting/KDS failures must never roll back money already returned).
 */
export interface DishRefundPostCommit {
  /** Tickets fully cancelled in-tx → `emitTicketCancelledEvent` each. */
  cancelledTicketIds: number[];
  /** Tickets partially cancelled in-tx → `emitTicketUpdatedEvent` each. */
  updatedTicketIds: number[];
  /** One reclass per fully-covered dish line with known cost > 0. */
  reclassJobs: Array<{
    order_item_id: number;
    organization_id: number;
    disposition: 'reuse' | 'waste';
    total_cost: number;
  }>;
}

/** One settled leg to return: either a `payments` row (`payment_id`) or a
 * real CxC abono (`ar_payment_id`) — never both, never neither.
 */
export interface CancellationPendingLeg {
  payment_id?: number;
  ar_payment_id?: number;
  amount: Prisma.Decimal;
  /** Concrete rail for the audit notes (e.g. 'card', 'wompi', 'abono CxC #5 (transferencia)'). */
  method_label: string;
}

@Injectable()
export class RefundFlowService {
  private readonly logger = new Logger(RefundFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly calculationService: RefundCalculationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly settingsService: SettingsService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
    // QUI-431 — serial pool + enforcement (no-op for non-serialized products).
    private readonly serialEnforcement: SerialNumberEnforcementService,
    private readonly serialNumbers: InventorySerialNumbersService,
    // QUI-457 — credit customer wallet on `store_credit` refunds.
    private readonly walletService: WalletService,
    private readonly walletBalance: WalletBalanceService,
    // refund-gateway-fix (W2-A): the dispatch path now calls
    // PaymentGatewayService.reversePaymentWithProcessor() in-process. The
    // previous async round-trip via an event listener left many refunds
    // stranded in pending_approval when the listener was never
    // registered. forwardRef resolves the PaymentsModule ↔ OrderFlowModule
    // cycle (see order-flow.module.ts:39).
    @Inject(forwardRef(() => PaymentGatewayService))
    private readonly paymentGatewayService: PaymentGatewayService,
    private readonly manualRefundDelivery: ManualRefundDeliveryService,
    // CP-REFUND-FLOW-REDESIGN paso 6 — dish branch (KDS cancel + COGS
    // reclass). `@Optional()` so the historic spec constructions keep
    // working (same pattern as OrderFlowService:kitchenFireService); in
    // prod both providers always resolve via KitchenFireModule /
    // AccountingModule (see order-flow.module.ts). A dish line with no
    // KitchenFireService fails LOUD in-tx (never skips the KDS silently);
    // a missing AutoEntryService degrades to a logged error post-commit
    // (the refund is already committed by then).
    @Optional() private readonly kitchenFireService?: KitchenFireService,
    @Optional() private readonly autoEntryService?: AutoEntryService,
    // Release-853 (paso 7) — re-agregación del caché de cobertura por línea
    // (`recomputeLineCache`). `@Optional()` por la misma razón que los dos
    // de arriba: los specs históricos construyen sin él; en prod siempre
    // resuelve (mismo módulo, sin ciclo). Donde falta, el caché no se
    // re-agrega — todos los llamados van con `?.` por eso.
    @Optional() private readonly coverageService?: RefundCoverageService,
    // Plan order-truth-and-invoice-tz — Paso 6. Único escritor de
    // `order_events`. `@Optional()` por el mismo motivo que los tres de
    // arriba: no romper los specs históricos que construyen el servicio a
    // mano. En prod siempre resuelve vía `OrderHistoryModule` (importado en
    // `order-flow.module.ts`, mismo módulo que provee este servicio).
    @Optional() private readonly orderHistoryService?: OrderHistoryService,
  ) {}

  /** Cash cancellation uses the same refund document and ceiling as returns,
   * but deliberately does not invoke createRefund's stock or cash-register
   * side effects: cancelOrder already owns those effects exactly once.
   */
  async recordCancellationCashRefund(
    tx: Prisma.TransactionClient,
    order: {
      id: number;
      store_id: number;
      stores?: { organization_id: number | null } | null;
      grand_total: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      shipping_cost: Prisma.Decimal;
      shipping_tax_amount: Prisma.Decimal;
      shipping_tax_type: string | null;
      tip_amount?: Prisma.Decimal | null;
      currency: string | null;
      payments: { id: number; state: string }[];
    },
    paymentIds: number[],
    amount: Prisma.Decimal,
    reason: string,
  ) {
    const breakdown = await this.calculationService.calculateCancellationCashRefund(
      order.id, amount, tx, order,
    );
    const refund = await tx.refunds.create({
      data: {
        order_id: order.id,
        payment_id: paymentIds.length === 1 ? paymentIds[0] : null,
        amount: breakdown.amount,
        subtotal_refund: breakdown.subtotal,
        tax_refund: breakdown.tax,
        shipping_refund: breakdown.shipping,
        currency: order.currency,
        reason,
        notes: `Cancelación; pagos en efectivo: ${paymentIds.join(', ')}`,
        refund_method: 'cash',
        state: 'processing',
        processed_by_user_id: RequestContextService.getUserId(),
        requested_at: new Date(),
        processed_at: null,
      },
    });
    // Plan order-truth-and-invoice-tz — Paso 6. Reembolso documental de la
    // cancelación (no cambia `orders.state`: cancelOrder ya registra su
    // propio `state_changed` a 'cancelled' en el mismo tx).
    await this.orderHistoryService?.record(tx, {
      orderId: order.id,
      storeId: order.store_id,
      organizationId: order.stores?.organization_id ?? null,
      type: 'refund_created',
      paymentId: paymentIds.length === 1 ? paymentIds[0] : null,
      amount: breakdown.amount.toString(),
      payload: { reason, refund_id: refund.id, refund_method: 'cash' },
    });
    return { refund, breakdown };
  }

  /** ADR-12 — one `requested` refund per settled non-cash leg, created inside
   * the caller's cancel transaction BEFORE the atomic claim, so a lost race
   * rolls every leg back with the claim. The original payments stay
   * `succeeded`: this method documents the debt to return, it never reverses.
   *
   * `alreadyPlanned` is the cash amount the caller already recorded in this
   * same transaction: the cumulative ceiling (cash + every leg) is checked
   * ONCE against `grand_total` here, because per-leg checks alone would let
   * cash 60 + card 60 pass a ceiling of 100.
   *
   * `refund_method` is the domain vocabulary for "return via the original
   * rail" (`original_payment` → 1110 fallback in accounting); the concrete
   * rail travels on the linked payment row and in `notes`. Manual closure
   * overwrites it with the real payout channel anyway.
   */
  async recordCancellationPendingRefunds(
    tx: Prisma.TransactionClient,
    order: {
      id: number;
      store_id: number;
      stores?: { organization_id: number | null } | null;
      grand_total: Prisma.Decimal;
      tax_amount: Prisma.Decimal;
      shipping_cost: Prisma.Decimal;
      shipping_tax_amount: Prisma.Decimal;
      shipping_tax_type: string | null;
      tip_amount?: Prisma.Decimal | null;
      currency: string | null;
      payments: { id: number; state: string }[];
    },
    legs: CancellationPendingLeg[],
    reason: string,
    alreadyPlanned: Prisma.Decimal = new Prisma.Decimal(0),
  ) {
    if (legs.length === 0) {
      return [];
    }
    const ceiling = await this.calculationService.calculate(
      { order_id: order.id, items: [], include_shipping: false }, tx,
    );
    const plannedTotal = legs.reduce(
      (acc, leg) => acc.plus(new Prisma.Decimal(leg.amount as any)),
      new Prisma.Decimal(alreadyPlanned as any),
    );
    if (plannedTotal.greaterThan(new Prisma.Decimal(ceiling.max_refundable).plus(0.01))) {
      throw new VendixHttpException(
        ErrorCodes.REF_VALIDATE_001,
        `Cancellation refunds ${plannedTotal.toString()} exceed the remaining refundable total ${ceiling.max_refundable.toFixed(2)}`,
      );
    }
    const created: Awaited<ReturnType<RefundFlowService['recordCancellationCashRefund']>>[] = [];
    for (const leg of legs) {
      const hasPayment = leg.payment_id != null;
      const hasArPayment = leg.ar_payment_id != null;
      if (hasPayment === hasArPayment) {
        throw new VendixHttpException(
          ErrorCodes.REF_VALIDATE_001,
          'Cancellation refund leg must reference exactly one of payment_id or ar_payment_id',
        );
      }
      const amount = new Prisma.Decimal(leg.amount as any);
      if (amount.lessThanOrEqualTo(0)) {
        this.logger.warn(
          `recordCancellationPendingRefunds: skipping zero-value leg of order #${order.id} ` +
            `(payment_id=${leg.payment_id ?? 'n/a'} ar_payment_id=${leg.ar_payment_id ?? 'n/a'}): nothing to return`,
        );
        continue;
      }
      const legKey = hasPayment ? `p${leg.payment_id}` : `ar${leg.ar_payment_id}`;
      const refundTransactionId = buildCancellationRefundTxId(order.id, legKey);
      const existing = await tx.refunds.findFirst({
        where: { refund_transaction_id: refundTransactionId },
        select: { id: true },
      });
      if (existing) {
        this.logger.warn(
          `recordCancellationPendingRefunds: refund for leg ${legKey} of order #${order.id} ` +
            `already exists (#${existing.id}) — skipping duplicate`,
        );
        continue;
      }
      const breakdown = await this.calculationService.calculateCancellationRefund(
        order.id, amount, tx, order,
      );
      const refund = await tx.refunds.create({
        data: {
          order_id: order.id,
          payment_id: leg.payment_id ?? null,
          ar_payment_id: leg.ar_payment_id ?? null,
          amount: breakdown.amount,
          subtotal_refund: breakdown.subtotal,
          tax_refund: breakdown.tax,
          shipping_refund: breakdown.shipping,
          currency: order.currency,
          reason,
          notes: `Cancelación ADR-12; pierna ${leg.method_label}`,
          refund_method: 'original_payment',
          refund_transaction_id: refundTransactionId,
          state: 'requested',
          processed_by_user_id: RequestContextService.getUserId(),
          requested_at: new Date(),
          processed_at: null,
        },
      });
      await this.orderHistoryService?.record(tx, {
        orderId: order.id,
        storeId: order.store_id,
        organizationId: order.stores?.organization_id ?? null,
        type: 'refund_created',
        paymentId: leg.payment_id ?? null,
        amount: breakdown.amount.toString(),
        payload: { reason, refund_id: refund.id, refund_method: 'original_payment', ar_payment_id: leg.ar_payment_id ?? null },
      });
      created.push({ refund, breakdown });
    }
    return created;
  }

  async completeCancellationCashRefund(refundId: number) {
    return this.prisma.refunds.update({
      where: { id: refundId },
      data: { state: 'completed', processed_at: new Date(), updated_at: new Date() },
    });
  }

  async emitCancellationCashRefund(
    order: { id: number; store_id: number; grand_total: Prisma.Decimal },
    result: Awaited<ReturnType<RefundFlowService['recordCancellationCashRefund']>>,
  ) {
    const store = await this.prisma.stores.findUnique({
      where: { id: order.store_id }, select: { organization_id: true },
    });
    if (!store) {
      this.logger.error(`Refund #${result.refund.id}: store #${order.store_id} missing; accounting event not emitted`);
      return;
    }
    const items = await this.prisma.order_items.findMany({
      where: { order_id: order.id },
      select: { order_item_taxes: { select: { tax_type: true, tax_amount: true } } },
    });
    const tax_breakdown = scaleBreakdownToTotal(
      buildTaxBreakdown(items.flatMap((item) => item.order_item_taxes || [])),
      Number(result.breakdown.tax),
    );
    if (result.breakdown.shippingTax.greaterThan(0) && result.breakdown.shippingTaxType) {
      if (tax_breakdown.length === 0 && result.breakdown.tax.greaterThan(0)) {
        tax_breakdown.push({ tax_type: 'iva', tax_amount: Number(result.breakdown.tax) });
      }
      tax_breakdown.push({
        tax_type: result.breakdown.shippingTaxType as TaxBreakdownItem['tax_type'],
        tax_amount: Number(result.breakdown.shippingTax),
      });
    }
    const totalTax = result.breakdown.tax.plus(result.breakdown.shippingTax);
    this.eventEmitter.emit('refund.completed', {
      refund_id: result.refund.id,
      order_id: order.id,
      organization_id: store.organization_id,
      store_id: order.store_id,
      amount: Number(result.breakdown.amount),
      subtotal: Number(result.breakdown.subtotal),
      tax: Number(totalTax),
      tax_amount: Number(totalTax),
      tax_breakdown,
      shipping: Number(result.breakdown.shipping),
      is_full_refund: result.breakdown.amount.equals(order.grand_total),
      user_id: RequestContextService.getUserId(),
      refund_method: 'cash',
      effective_channel: 'cash',
    });
  }

  async previewRefund(
    orderId: number,
    dto: CreateRefundDto,
  ): Promise<RefundCalculationResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true, state: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    if (!REFUNDABLE_STATES.includes(order.state)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
      );
    }

    // Release-853 (paso 7): el preview usa el MISMO techo que la creación
    // (`include_pending_states: true`) — un `max_refundable` calculado con
    // otro techo que el que valida la creación es una promesa rota.
    return this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
      include_pending_states: true,
    });
  }

  async createRefund(orderId: number, dto: CreateRefundDto) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, organization_id: true } },
        // [resid-fiscal] — Sólo ítems no cancelados participan en el cálculo
        // del refund. El `grand_total` ya excluye cancelados, pero este
        // include relee líneas y las suma para devolver proporcionalmente;
        // sin filtro, una línea cancelada entra como base de reembolso y
        // devuelve dinero por algo que el cliente no compró.
        order_items: {
          where: { cancelled_at: null },
          include: {
            // Paso 6 — `product_type` routes dish lines to the KDS-aware
            // branch (`inventory_consumed_at_fire`/`skip_kds` already travel
            // on the row); the authoritative flag read happens in-tx under
            // the order lock (see the inventory loop below).
            products: { select: { id: true, track_inventory: true, product_type: true } },
            product_variants: { select: { id: true } },
          },
        },
        payments: {
          include: {
            store_payment_method: {
              select: {
                system_payment_method: { select: { type: true } },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    if (!REFUNDABLE_STATES.includes(order.state)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
      );
    }

    // Calculate the refund breakdown. Step 1: pending-aware ceiling, so an
    // in-flight partial already reserves its share before this one is sized.
    const calculation = await this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
      include_pending_states: true,
    });

    // REFUND OVERHAUL — resolve missing location_id for `restock` and `write_off`
    // to the store's canonical default warehouse. Fallback chain mirrors
    // LocationsService.getDefaultLocation: stores.default_location_id → active
    // warehouse → active any → throw. If still null after the chain, the
    // store has no usable location and the refund cannot write inventory.
    const defaultLocationId = await this.resolveDefaultLocation(
      order.store_id,
    );
    for (const item of calculation.items) {
      if (
        (item.inventory_action === 'restock' ||
          item.inventory_action === 'write_off') &&
        !item.location_id
      ) {
        if (!defaultLocationId) {
          throw new BadRequestException(
            `Store has no active warehouse to restock "${item.product_name}". ` +
              `Set stores.default_location_id or pick a location manually.`,
          );
        }
        item.location_id = defaultLocationId;
      }
    }

    const userId = RequestContextService.getUserId();

    // REFUND OVERHAUL — derivar el canal EFECTIVO por donde se moverá el
    // dinero. La intención del operador (`dto.refund_method`) no basta: para
    // `original_payment` el canal real depende del tipo de pago original
    // (cash → caja, bank_transfer → cartera, wompi/paypal/stripe → gateway).
    // El resolver vive en `refund-channel.util.ts` para que la lógica sea
    // compartible entre backend, tests y futuros consumidores.
    const paymentType: string | null =
      order.payments?.[0]?.store_payment_method?.system_payment_method?.type ??
      null;
    const effectiveChannel: EffectiveRefundChannel = resolveEffectiveRefundChannel(
      dto.refund_method,
      paymentType,
    );
    // ¿Hay una pasarela real que va a reversar y promover este refund? Sólo en
    // ese caso es legítimo dejarlo en un estado NO terminal. El canal
    // `gateway` por sí solo no alcanza: también es el valor de fallback para
    // tipos de pago desconocidos, y en esos no existe processor ni endpoint de
    // aprobación, así que aparcarlos los atasca para siempre.
    const awaitsReversal = awaitsExternalReversal(dto.refund_method, paymentType);

    // Paso 6 — dish post-commit collector (KDS SSE + COGS reclass). Filled
    // in-tx by `processDishRefundLine`, drained in the `.then()` below.
    // Empty for non-dish refunds: the drain is a guarded no-op.
    const dishPostCommit: DishRefundPostCommit = {
      cancelledTicketIds: [],
      updatedTicketIds: [],
      reclassJobs: [],
    };

    // Execute everything in a transaction
    return this.prisma
      .$transaction(async (tx) => {
        // Step 1 (CP-REFUND-FLOW-REDESIGN) — atomic lifecycle claim. The
        // pre-tx reads above raced: two concurrent partials could both pass
        // the ceiling and jointly over-refund. Serializing on the order row
        // (same `FOR UPDATE` shape as `manuallyResolveRefund`) plus a fresh
        // state check and a ceiling re-validation under the lock closes both
        // the double-partial race and the refund-vs-cancel TOCTOU. There is
        // no flippable row to `updateMany`-claim on a creation path, so the
        // re-reads under the lock are the claim; P2002 still maps to a
        // creation conflict in the rejection handler below.
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND store_id = ${order.store_id} FOR UPDATE`;
        const fresh = await tx.orders.findFirst({
          where: { id: orderId },
          select: { state: true },
        });
        if (!fresh || !REFUNDABLE_STATES.includes(fresh.state)) {
          throw new BadRequestException(
            `Cannot refund order in state '${fresh?.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
          );
        }
        // Re-validate the same request against the pending-aware ceiling.
        // Throws on breach; the persisted amounts stay the deterministic
        // outer breakdown (order lines are immutable once sold).
        await this.calculationService.calculate(
          {
            order_id: orderId,
            items: dto.items,
            include_shipping: dto.include_shipping,
            include_pending_states: true,
          },
          tx,
        );

        // Step 2 (CP-REFUND-FLOW-REDESIGN) — settled legs under the claim.
        // `partially_refunded` belongs to the search: after a first partial
        // the leg stays in play, and a second partial that covers the
        // accumulated total must still find it to promote it to `refunded`
        // (evidence 7384: payment stuck at `partially_refunded` with the
        // order already `refunded`). The refund links to the first settled
        // leg by id — deterministic for single-payment orders; scalar
        // `payment_id` cannot split-link a multi-payment distribution.
        const settledPayments = (order.payments ?? [])
          .filter((p) =>
            p.state === 'succeeded' ||
            p.state === 'pending' ||
            p.state === 'partially_refunded',
          )
          .sort((a, b) => a.id - b.id);
        const linkedPaymentId =
          settledPayments.length > 0 ? settledPayments[0].id : null;

        // 1. Create refund record
        const refund = await tx.refunds.create({
          data: {
            order_id: orderId,
            payment_id: linkedPaymentId,
            amount: calculation.total_refund,
            subtotal_refund: calculation.subtotal_refund,
            tax_refund: calculation.tax_refund,
            shipping_refund: calculation.shipping_refund,
            reason: dto.reason,
            notes: dto.notes,
            refund_method: dto.refund_method,
            state: 'processing',
            processed_by_user_id: userId,
            requested_at: new Date(),
          },
        });

        // Plan order-truth-and-invoice-tz — Paso 6. `refund_created` primero;
        // el `state_changed` a 'refunded' (si aplica) se registra más abajo,
        // junto a la escritura de `orders.state`.
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: order.store_id,
          organizationId: order.stores?.organization_id ?? null,
          type: 'refund_created',
          paymentId: linkedPaymentId,
          amount: calculation.total_refund.toString(),
          actorUserId: userId,
          payload: {
            reason: dto.reason,
            refund_id: refund.id,
            refund_method: dto.refund_method,
            is_full_refund: calculation.is_full_refund,
          },
        });

        // Unidades de stock que mueve cada línea devuelta. Devolver 1 bulto de
        // 50 repone 50 unidades: la cantidad devuelta cuenta presentaciones y
        // el inventario vive en la unidad mínima. Se resuelve una sola vez y lo
        // consumen tanto el `refund_item` como el movimiento de inventario, para
        // que el documento y el stock no puedan contar cosas distintas.
        const stockUnitsByOrderItem = new Map<number, number>();
        for (const item of calculation.items) {
          const soldLine = order.order_items.find(
            (oi) => oi.id === item.order_item_id,
          );
          stockUnitsByOrderItem.set(
            item.order_item_id,
            resolveRefundStockUnits(
              item.quantity,
              soldLine?.quantity,
              soldLine?.stock_units_consumed,
            ),
          );
        }

        // 2. Create refund_items. Capture the created id per order_item so the
        // serial-return step (QUI-431) can link serials to the refund line.
        const refundItemIdByOrderItem = new Map<number, number>();
        for (const item of calculation.items) {
          const stockUnits = stockUnitsByOrderItem.get(item.order_item_id);
          // REFUND OVERHAUL — bank_account_id is required-by-DTO for
          // `bank_transfer` refunds. For other methods, persist NULL so the
          // audit trail is unambiguous.
          const dtoItem = dto.items.find(
            (di) => di.order_item_id === item.order_item_id,
          );
          const refundItem = await tx.refund_items.create({
            data: {
              refund_id: refund.id,
              order_item_id: item.order_item_id,
              quantity: item.quantity,
              refund_amount: item.refund_amount,
              tax_amount: item.tax_amount,
              discount_amount: item.discount_amount,
              inventory_action: item.inventory_action,
              location_id: item.location_id,
              reason: item.reason,
              bank_account_id:
                dto.refund_method === 'bank_transfer'
                  ? dtoItem?.bank_account_id ?? null
                  : null,
              // Solo se persiste cuando difiere de la cantidad devuelta: un
              // null significa "la línea no usó presentación", igual que en la
              // venta.
              stock_units_consumed:
                stockUnits != null && stockUnits !== item.quantity
                  ? stockUnits
                  : null,
            },
          });
          refundItemIdByOrderItem.set(item.order_item_id, refundItem.id);
        }

        // 2b. Step 3 (CP-REFUND-FLOW-REDESIGN) — per-line coverage cache,
        // same tx that inserts the `refund_items` above. Release-853 (paso
        // 7): el SQL inline se extrajo a `recomputeLineCache` (una sola
        // agregación para creación, caídas a `failed` y resolve manual) y
        // además resetea a 0 las líneas sin ledger — el SQL viejo sólo
        // tocaba las líneas cubiertas y congelaba el resto. Incondicional
        // (también item-less): re-escribir valores idénticos es barato y
        // mantiene el caché auto-reparable en cada creación.
        await this.coverageService?.recomputeLineCache(tx, orderId);

        // 3. Process inventory per item
        //
        // Paso 6 — dish lines (`product_type='prepared'`, stock-mode
        // `skip_kds` excluded) take the KDS-aware branch below; every other
        // line keeps the retail path byte-identical. The fire flag is
        // re-read fresh here, under the order lock: a fire concurrent with
        // this refund must not slip a restock past the fired⇒write_off
        // validation (TOCTOU).
        const dishItemIds = calculation.items
          .filter((item) => {
            if (item.inventory_action === 'no_return') return false;
            const oi = order.order_items.find(
              (o) => o.id === item.order_item_id,
            );
            return (
              oi?.products?.product_type === 'prepared' &&
              oi.skip_kds !== true
            );
          })
          .map((item) => item.order_item_id);
        const firedByOrderItem = new Map<number, boolean>();
        if (dishItemIds.length > 0) {
          const freshDishFlags = await tx.order_items.findMany({
            where: { id: { in: dishItemIds }, order_id: orderId },
            select: { id: true, inventory_consumed_at_fire: true },
          });
          for (const row of freshDishFlags) {
            firedByOrderItem.set(
              row.id,
              row.inventory_consumed_at_fire === true,
            );
          }
        }
        for (const item of calculation.items) {
          if (item.inventory_action === 'no_return') continue;

          const orderItem = order.order_items.find(
            (oi) => oi.id === item.order_item_id,
          );
          if (!orderItem?.products) continue;

          // Paso 6 — dish branch: state-guided disposition (fired⇒write_off
          // only), leaf-level reversal at historical cost (never the sold
          // dish), KDS item cancel in-tx, audit + COGS reclass post-commit.
          // Retail lines (incl. stock-mode `skip_kds` dishes, whose own
          // stock the payment consumed as a regular sale) fall through
          // untouched.
          if (
            orderItem.products.product_type === 'prepared' &&
            orderItem.skip_kds !== true
          ) {
            await this.processDishRefundLine(tx, {
              orderId,
              storeId: order.store_id,
              organizationId: order.stores?.organization_id,
              refundId: refund.id,
              orderReason: dto.reason,
              item,
              soldQuantity: Number(orderItem.quantity ?? 0),
              fired:
                firedByOrderItem.get(item.order_item_id) ??
                orderItem.inventory_consumed_at_fire === true,
              userId,
              postCommit: dishPostCommit,
            });
            continue;
          }

          const stockUnits =
            stockUnitsByOrderItem.get(item.order_item_id) ?? item.quantity;

          if (item.inventory_action === 'restock' && item.location_id) {
            await this.stockLevelManager.updateStock(
              {
                product_id: orderItem.products.id,
                variant_id: orderItem.product_variants?.id,
                location_id: item.location_id,
                quantity_change: stockUnits,
                movement_type: 'return',
                reason: `Refund #${refund.id}: ${dto.reason}`,
                user_id: userId,
                order_item_id: orderItem.id,
                create_movement: true,
              },
              tx,
            );

            // QUI-431 — serialized product returning to sellable stock: move
            // the serials that were sold on the original order_item back to
            // `returned` then `in_stock` (reenterStock=true), snapshot them on
            // the refund line, and link them to the refund_item document.
            await this.returnSerialsForRefund(
              tx,
              orderItem.products.id,
              orderItem.id,
              refundItemIdByOrderItem.get(item.order_item_id),
              item.quantity,
              true,
            );
          } else if (
            item.inventory_action === 'write_off' &&
            item.location_id
          ) {
            await this.stockLevelManager.updateStock(
              {
                product_id: orderItem.products.id,
                variant_id: orderItem.product_variants?.id,
                location_id: item.location_id,
                quantity_change: -stockUnits,
                movement_type: 'damage',
                reason: `Refund write-off #${refund.id}: ${dto.reason}`,
                user_id: userId,
                order_item_id: orderItem.id,
                create_movement: true,
              },
              tx,
            );

            // QUI-431 — write-off of a serialized unit: the customer returned
            // it but it does NOT re-enter sellable stock (it was written off as
            // damaged). Move the serials sold on the original line to
            // `returned` (reenterStock=false), snapshot + link to refund_item.
            await this.returnSerialsForRefund(
              tx,
              orderItem.products.id,
              orderItem.id,
              refundItemIdByOrderItem.get(item.order_item_id),
              item.quantity,
              false,
            );
          }
        }

        // 4. Update payment state across every settled leg. A full-coverage
        // refund promotes ALL settled legs to `refunded` (the accumulated
        // refunds covered the order); a partial marks the linked leg
        // `partially_refunded` and leaves sibling legs untouched. Re-marking
        // an already `partially_refunded` leg is idempotent.
        if (calculation.is_full_refund) {
          for (const leg of settledPayments) {
            await tx.payments.update({
              where: { id: leg.id },
              data: { state: 'refunded', updated_at: new Date() },
            });
          }
        } else if (linkedPaymentId != null) {
          await tx.payments.update({
            where: { id: linkedPaymentId },
            data: { state: 'partially_refunded', updated_at: new Date() },
          });
        }

        // 5. Update order state only if full refund
        if (calculation.is_full_refund) {
          await tx.orders.update({
            where: { id: orderId },
            data: {
              state: 'refunded',
              updated_at: new Date(),
            },
          });
          await this.orderHistoryService?.record(tx, {
            orderId,
            storeId: order.store_id,
            organizationId: order.stores?.organization_id ?? null,
            type: 'state_changed',
            fromState: fresh.state,
            toState: 'refunded',
          });
        }

        // 6. Mark refund as pending or completed
        //
        // Hotfix post-PR-576: el bug original_payment revertía dinero en DB
        // (mark completed) sin reversar nada en Wompi/cash_on_delivery/etc.
        // Para refunds que viajan por una pasarela reversible (gateway)
        // dejamos el refund como `pending_approval` dentro de la tx y luego,
        // en el `.then()` de abajo, `dispatchRefundProcessor` llama al
        // processor real (Wompi.reverse, etc.) y exige éxito antes de
        // promover a `completed`. Si el processor no está integrado (la
        // mayoría de las tiendas hoy), el refund queda en estado
        // `pending_approval` para intervención manual del operador —
        // exactamente la semántica que el comentario en `:428-431` describía
        // pero nunca implementó. Para canales directos (cash, bank_transfer,
        // store_credit) la promesa se cumple sincrónicamente en la tx y
        // queda `completed`. Antes del fix el código usaba `'pending'`,
        // que NO es un valor válido de `refunds_state_enum` (el enum declara
        // `requested | pending_approval | approved | processing | completed`)
        // y provocaba SYS_INTERNAL_001 en `tx.refunds.update()`.
        const finalState = awaitsReversal ? 'pending_approval' : 'completed';
        const completedRefund = await tx.refunds.update({
          where: { id: refund.id },
          data: {
            state: finalState,
            processed_at: finalState === 'completed' ? new Date() : null,
            updated_at: new Date(),
          },
          include: {
            refund_items: {
              include: {
                order_items: true,
              },
            },
          },
        });

        return completedRefund;
      })
      .then(async (completedRefund) => {
        // 7. Dispatch the original_payment reversal to the processor BEFORE
        // emitting refund.completed.
        //
        // refund-gateway-fix (W2-A): la rama vieja emitía un evento async
        // y dejaba el refund en `pending_approval` para que un listener
        // del processor lo promoviera a `completed` o rechazara con
        // `failed`. Ese round-trip dejaba refunds invisibles durante horas
        // (hasta que el listener reaccionaba) y muchos ni llegaban a
        // cerrarse cuando el listener no estaba registrado.
        //
        // Ahora la rama llama en proceso al processor real
        // (PaymentGatewayService.reversePaymentWithProcessor) y actualiza
        // el refund row con el estado terminal (`completed`/`failed`) o
        // `processing` (cuando la pasarela contestó `pending`). Esto le
        // devuelve control al usuario sincrónicamente y elimina el estado
        // limbo para refunds que viajaban por un canal reversible.
        //
        // El gate se hace por CANAL EFECTIVO, no por `refund_method` crudo.
        // Así, `original_payment` sobre `cash` o `bank_transfer` NO entra al
        // processor (su promesa se cumplió en la tx) y el refund ya está
        // `completed`. Sobre `gateway` (`wompi`/`paypal`/`stripe`) sí.
        //
        // Capturamos `dispatchStatus` para que el bloque de emit de abajo
        // pueda distinguir los refunds que AÚN no son terminales (no deben
        // generar `refund.completed` para que la contabilidad no registre
        // una reversión que todavía no terminó).
        let dispatchStatus: 'completed' | 'failed' | 'processing' | null = null;
        if (awaitsReversal) {
          // FIX refund 500: el processor dispatch es no-bloqueante para el
          // refund row (que ya está committed). Si falla, NO propagamos el
          // throw al cliente — el refund sigue válido en `pending_approval`
          // para intervención manual del operador, y el `SYS_INTERNAL_001`
          // que el filtro global devolvería solo confundiría al usuario.
          // Loggeamos el error para diagnóstico. `dispatchRefundProcessor`
          // ya captura internamente los throws del processor y los traduce
          // a `status: 'failed'`, así que este catch sólo atrapa bugs en el
          // dispatch mismo (DB update fallido, etc.).
          try {
            const dispatchResult = await this.dispatchRefundProcessor(
              order,
              completedRefund,
              Number(calculation.total_refund),
            );
            dispatchStatus = dispatchResult.status;
          } catch (err) {
            this.logger.error(
              `Refund #${completedRefund.id}: processor dispatch threw — refund stays in 'pending_approval' for manual operator intervention. ${err instanceof Error ? err.message : String(err)}`,
              err instanceof Error ? err.stack : undefined,
            );
          }
        }

        // `refund.completed` reconoce una reversión exitosa, no cualquier
        // estado terminal. Un fallo o pendiente de pasarela no puede generar
        // el asiento bancario de una devolución; los canales no-gateway ya
        // completaron el refund en la transacción.
        const refundCompleted =
          !awaitsReversal || dispatchStatus === 'completed';

        // 8. Emit events after transaction (and processor dispatch) completes
        try {
          // Preserve the original fiscal-type mix so the tax reversal posts
          // proportionally against each tax's PUC account (IVA→2408, INC→2436).
          const items = await this.prisma.order_items.findMany({
            where: { order_id: orderId },
            select: {
              order_item_taxes: {
                select: { tax_type: true, tax_amount: true },
              },
            },
          });
          const tax_breakdown = scaleBreakdownToTotal(
            buildTaxBreakdown(items.flatMap((i) => i.order_item_taxes || [])),
            Number(calculation.tax_refund || 0),
          );
          // Impuesto del envío devuelto (proporcional a la copia de la orden):
          // se suma DESPUÉS del prorrateo de productos, con su propio tipo,
          // para reversar 2408/2436 y no el ingreso de flete. Si los productos
          // no dejaron desglose tipado pero sí devolvieron impuesto, se
          // antepone una fila IVA por él (misma cuenta que la línea legada):
          // un desglose no vacío hace que el asiento ignore el total escalar.
          const shipping_tax_refund = Number(calculation.shipping_tax_refund || 0);
          const product_tax_refund = Number(calculation.tax_refund || 0);
          if (shipping_tax_refund > 0 && calculation.shipping_tax_type) {
            if (tax_breakdown.length === 0 && product_tax_refund > 0) {
              tax_breakdown.push({ tax_type: 'iva', tax_amount: product_tax_refund });
            }
            tax_breakdown.push({
              tax_type: calculation.shipping_tax_type as TaxBreakdownItem['tax_type'],
              tax_amount: shipping_tax_refund,
            });
          }
          const refund_tax_total =
            Math.round(product_tax_refund * 100 + shipping_tax_refund * 100) / 100;

          // Match manual resolution: emit only after successful completion.
          if (refundCompleted) {
            this.eventEmitter.emit('refund.completed', {
              refund_id: completedRefund.id,
              order_id: orderId,
              organization_id: order.stores?.organization_id,
              store_id: order.store_id,
              amount: calculation.total_refund,
              subtotal: calculation.subtotal_refund,
              // Productos + impuesto del envío devuelto.
              tax: refund_tax_total,
              tax_amount: refund_tax_total,
              tax_breakdown,
              shipping: calculation.shipping_refund,
              is_full_refund: calculation.is_full_refund,
              user_id: userId,
              // REFUND OVERHAUL — include refund_method so AutoEntryService
              // can pick the correct credit-side mapping key (1105 / 1110 / 2335).
              // Previously the event omitted this and the journal always
              // resolved to refund.completed.cash → 1105 Caja.
              refund_method: dto.refund_method,
              // REFUND OVERHAUL — incluir el canal EFECTIVO (cash /
              // bank_transfer / store_credit / gateway) para auditoría y para
              // que AutoEntryService pueda enrutar por canal real en lugar de
              // adivinarlo desde `refund_method` (que es intención del
              // operador, no el canal final).
              effective_channel: effectiveChannel,
            });
          }

          if (calculation.is_full_refund) {
            this.eventEmitter.emit('order.status_changed', {
              store_id: order.store_id,
              organization_id: order.stores?.organization_id,
              order_id: orderId,
              order_number: order.order_number,
              old_state: order.state,
              new_state: 'refunded',
            });
          }
        } catch (error) {
          this.logger.error(
            `Failed to emit refund events for order #${orderId}: ${error.message}`,
          );
        }

        // Paso 6 — dish post-commit drain: KDS SSE + COGS reclass collected
        // in-tx by `processDishRefundLine`. Best-effort per job (the refund
        // already committed): each failure is logged with the refund id for
        // operator reconciliation, never thrown. Guarded no-op for refunds
        // without dish lines.
        if (
          dishPostCommit.cancelledTicketIds.length > 0 ||
          dishPostCommit.updatedTicketIds.length > 0 ||
          dishPostCommit.reclassJobs.length > 0
        ) {
          const kds = this.kitchenFireService;
          for (const ticketId of dishPostCommit.cancelledTicketIds) {
            try {
              await kds?.emitTicketCancelledEvent(ticketId);
            } catch (error) {
              this.logger.error(
                `Refund #${completedRefund.id}: post-commit ticket.cancelled SSE for ticket #${ticketId} failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          for (const ticketId of dishPostCommit.updatedTicketIds) {
            try {
              await kds?.emitTicketUpdatedEvent(ticketId);
            } catch (error) {
              this.logger.error(
                `Refund #${completedRefund.id}: post-commit ticket.updated SSE for ticket #${ticketId} failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          for (const job of dishPostCommit.reclassJobs) {
            if (!this.autoEntryService) {
              this.logger.error(
                `AutoEntryService no disponible: reclass ${job.disposition} de ` +
                  `ítem #${job.order_item_id} (refund #${completedRefund.id}, costo ${job.total_cost}) ` +
                  `requiere conciliación desde audit_logs`,
              );
              continue;
            }
            try {
              await this.autoEntryService.onPreparedDishDisposition({
                order_id: orderId,
                order_item_id: job.order_item_id,
                organization_id: job.organization_id,
                store_id: order.store_id,
                disposition: job.disposition,
                total_cost: job.total_cost,
                user_id: userId ?? undefined,
              });
            } catch (error) {
              this.logger.error(
                `Refund #${completedRefund.id}: COGS reclass (${job.disposition}) ` +
                  `for item #${job.order_item_id} failed, reconcile from audit_logs ` +
                  `order_item.refund_dish_disposition: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }

        this.logger.log(
          `Refund #${completedRefund.id} processed for order #${orderId}: ` +
            `${calculation.total_refund.toFixed(2)} (${calculation.is_full_refund ? 'full' : 'partial'})`,
        );

        // QUI-457: If refund_method === 'store_credit', credit the customer's
        // wallet so the refund value is actually available to them. Non-blocking
        // because the refund row is already committed — a credit failure only
        // means an operator alert via log; the sale refund is intact.
        // Paso 4: vía `creditForRefund` (fila durable con reference refund;
        // sin emisión `wallet.credited`: ver nota contable en WalletService).
        if (dto.refund_method === 'store_credit' && order.customer_id) {
          try {
            await this.walletService.creditForRefund(
              order.customer_id,
              Number(calculation.total_refund),
              {
                refund_id: completedRefund.id,
                order_id: orderId,
                user_id: userId,
              },
            );
            this.logger.log(
              `Wallet credited: customer=${order.customer_id} amount=${calculation.total_refund} refund=#${completedRefund.id}`,
            );
          } catch (e) {
            this.logger.error(
              `Failed to credit wallet for refund #${completedRefund.id} (customer=${order.customer_id}): ${e?.message ?? e}`,
            );
          }
        }

        // Record cash register refund movement (non-blocking).
        //
        // SOLO cuando el canal efectivo es `cash`. Antes este gate era
        // `movesCash = refund_method !== 'store_credit' && refund_method !== 'bank_transfer'`,
        // lo que aplicaba a `cash` Y `original_payment` — un error que producía
        // un movimiento fantasma de caja para reembolsos con tarjeta. La
        // consecuencia era una salida de efectivo registrada en `movements` que
        // nunca ocurrió en la realidad.
        //
        // `original_payment` sobre pago gateway → el processor (Wompi/cash_on_delivery/etc.)
        // se llama a sí mismo abajo en `dispatchRefundProcessor` cuando la
        // integración existe; mientras tanto el refund queda como
        // `state='pending_approval'` para intervención manual del operador.
        // `store_credit` → ya se acreditó la wallet arriba.
        // `bank_transfer` → el operador transfiere desde su app bancaria
        // manualmente; no hay integración API.
        const movesCash = effectiveChannel === 'cash';
        // Paso 4: entrega durable y awaited — la respuesta lleva el aviso
        // explícito (`recorded` / `pending` + fila del outbox) en vez de un
        // éxito silencioso. El refund ya está committed: un `pending` no lo
        // revierte, solo le dice al operador que la caja quedó por entregar.
        let cash_movement: RefundCashMovementNotice | undefined;
        if (userId && movesCash) {
          cash_movement = await this.recordRefundCashRegisterMovement({
            organization_id: order.stores?.organization_id,
            store_id: order.store_id,
            user_id: userId,
            refund_id: completedRefund.id,
            order_id: orderId,
            payment_id: completedRefund.payment_id ?? null,
            amount: calculation.total_refund,
            channel: effectiveChannel,
          });
        }

        return cash_movement === undefined
          ? completedRefund
          : { ...completedRefund, cash_movement };
      },
      // Step 1: the `.then(onFulfilled, onRejected)` two-arg form only
      // handles the TRANSACTION rejection — `$transaction` itself takes a
      // single callback (its 2nd param is options, NOT a handler), so the
      // mapping MUST live here. Post-commit behavior (resilience guards
      // above) is untouched. A unique violation inside the claim window
      // surfaces as a creation conflict instead of a generic 500.
      (error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          throw new VendixHttpException(
            ErrorCodes.REF_CREATE_001,
            `Concurrent refund creation conflict on order #${orderId}`,
          );
        }
        throw error;
      },
    );
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 6 — dish branch of `createRefund`, in-tx.
   *
   * State-guided disposition for one `prepared` line (stock-mode `skip_kds`
   * lines never reach here — the retail path owns them):
   *   - fired (`inventory_consumed_at_fire=true`) ⇒ `write_off` ONLY, with
   *     motivo. The cooked ingredients are gone: no stock movement at all
   *     (a leaf `damage` move would subtract twice — the fire already
   *     consumed them); the booked COGS is reclassed to loss post-commit
   *     (DR 5295 / CR 6135) with full traceability in `audit_logs`.
   *   - not fired ⇒ `restock` reverses EXACTLY the recorded consumption
   *     transactions for this line (sign +, historical unit cost, cost
   *     layer recreated) — the fire/payment transaction is the source of
   *     truth (same canon as `OrderFlowService.disposeConsumedPreparedLeaves`:
   *     never restock the sold dish). Re-exploding the CURRENT recipe here
   *     would restock QUI-655 exclusions and post-fire recipe edits as
   *     phantom stock, and would fabricate leaves for recipe-less fires, so
   *     the reversal is sourcing-ledger, not re-derivation. `write_off` on a
   *     non-fired line keeps the consumption standing (waste reclass).
   *   - partial quantities converge exactly across cumulative partials: this
   *     refund reverses `round(consumed × cumAfter/sold) − round(consumed ×
   *     cumBefore/sold)` per leaf, where the cumulative counts come from the
   *     `refund_items` ledger (which already includes this refund's rows).
   *   - KDS: this line's ticket items cancel in-tx (item-level — sibling
   *     lines on the same ticket keep cooking); SSE (`ticket.cancelled` /
   *     `ticket.updated`) and the COGS reclass (`onPreparedDishDisposition`,
   *     existing lane, no new mapping keys) run post-commit via `postCommit`.
   *     The reclass posts only when the line is FULLY covered, because the
   *     lane's idempotency key is the order_item (a second post would be
   *     skipped as duplicate): stock converges in-tx per partial, the single
   *     reclass lands when the line closes.
   *
   * Never touches the anti-double-discount invariant: no flag is flipped
   * here, so a later payment still skips fired lines (`flag=true`) and
   * committed lines exactly as before.
   */
  private async processDishRefundLine(
    tx: Prisma.TransactionClient,
    input: {
      orderId: number;
      storeId: number;
      organizationId: number | null | undefined;
      refundId: number;
      orderReason: string;
      item: RefundCalculationResult['items'][number];
      soldQuantity: number;
      fired: boolean;
      userId: number | null | undefined;
      postCommit: DishRefundPostCommit;
    },
  ): Promise<void> {
    const {
      orderId, storeId, organizationId, refundId, item, soldQuantity, fired,
      userId, postCommit,
    } = input;
    const orderItemId = item.order_item_id;
    const refundQty = Number(item.quantity ?? 0);
    const disposition: 'reuse' | 'waste' =
      item.inventory_action === 'restock' ? 'reuse' : 'waste';

    // 1. State-guided validation (authoritative flags: read in-tx under the
    // order lock by the caller). Plain BadRequest messages — no new error
    // codes (step 6 owns no error-code surface).
    if (fired && disposition === 'reuse') {
      throw new BadRequestException(
        `Order item #${orderItemId} is a dish already fired to the kitchen: ` +
          `it only admits write_off (the cooked ingredients cannot return to stock).`,
      );
    }
    const motivo = (item.reason?.trim() || input.orderReason?.trim() || '');
    if (disposition === 'waste' && !motivo) {
      throw new BadRequestException(
        `Order item #${orderItemId} is a dish write-off: a reason (motivo) is required.`,
      );
    }
    if (organizationId == null) {
      throw new InternalServerErrorException(
        `Refund #${refundId}: organization unknown, dish disposition for ` +
          `item #${orderItemId} cannot be audited`,
      );
    }
    const kds = this.kitchenFireService;
    if (!kds) {
      throw new InternalServerErrorException(
        'KitchenFireService no disponible en RefundFlowService (revisar imports de OrderFlowModule)',
      );
    }

    // 2. Recorded consumption for this line (fire leaves, or the own-stock
    // sale for non-restaurant/legacy paths). Empty for recipe-less fires
    // and never-consumed lines: both correctly reverse to nothing.
    const consumed = await tx.inventory_transactions.findMany({
      where: { order_item_id: orderItemId, quantity_change: { lt: 0 } },
      select: {
        product_id: true,
        product_variant_id: true,
        quantity_change: true,
        unit_cost: true,
        total_cost: true,
      },
    });
    const fullConsumedCost = consumed.reduce(
      (sum, ct) => sum + Math.abs(Number(ct.total_cost ?? 0)),
      0,
    );

    // 3. Cumulative line coverage from the ledger (this refund's rows were
    // inserted in step 2 of this same tx, so they are already included).
    // Release-853 (paso 7): filtrado por `REFUND_LEDGER_STATES` — sin el
    // filtro, un refund `failed` previo inflaba `cumAfter` y el prorrateo
    // reponía insumos de más (o encolaba un reclass indebido).
    let cumAfter = refundQty;
    if (soldQuantity > 0 && refundQty > 0) {
      const ledger = await tx.refund_items.findMany({
        where: {
          order_item_id: orderItemId,
          refunds: { state: { in: [...REFUND_LEDGER_STATES] } },
        },
        select: { quantity: true },
      });
      cumAfter = ledger.reduce(
        (sum, row) => sum + Number(row.quantity ?? 0),
        0,
      );
    }
    const cumBefore = Math.max(0, cumAfter - refundQty);
    const fullCovered = soldQuantity > 0 && cumAfter >= soldQuantity;

    // 4. Reuse: reverse the recorded consumption at historical cost,
    // pro-rated to this refund's incremental share. No order_item_id on the
    // reversal (same Restrict reason as cancelOrderItem); cumulative
    // partials converge through the ledger math above, not through tags.
    const reversedLeaves: Array<{
      product_id: number;
      quantity: number;
      unit_cost: number;
    }> = [];
    if (disposition === 'reuse' && soldQuantity > 0 && refundQty > 0) {
      for (const ct of consumed) {
        const consumedQty = Math.abs(ct.quantity_change);
        const targetNow = Math.round((consumedQty * cumAfter) / soldQuantity);
        const targetBefore = Math.round((consumedQty * cumBefore) / soldQuantity);
        const reverseQty = Math.max(0, targetNow - targetBefore);
        if (reverseQty <= 0) continue;
        const historicalTotal = Math.abs(Number(ct.total_cost ?? 0));
        const unitCost = Number(
          ct.unit_cost ?? (consumedQty > 0 ? historicalTotal / consumedQty : 0),
        );
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
            quantity_change: reverseQty,
            movement_type: 'return',
            movement_unit_cost: unitCost > 0 ? unitCost : undefined,
            reason:
              `Refund #${refundId} restock plato (orden #${orderId} ítem #${orderItemId})` +
              (motivo ? `: ${motivo}` : ''),
            source_module: 'dish_refund',
            create_movement: true,
            validate_availability: false,
          },
          tx,
        );
        // updateStock(return) restores quantity/value snapshots but no cost
        // layer — recreate it at the historical cost (cancelOrderItem canon).
        await tx.inventory_cost_layers.create({
          data: {
            organization_id: organizationId,
            product_id: ct.product_id,
            product_variant_id: ct.product_variant_id,
            location_id: locationId,
            quantity_remaining: reverseQty,
            unit_cost: new Prisma.Decimal(unitCost),
            received_at: new Date(),
          },
        });
        reversedLeaves.push({
          product_id: ct.product_id,
          quantity: reverseQty,
          unit_cost: unitCost,
        });
      }
    }

    // 5. KDS cancel in-tx (item-level; SSE post-commit via `postCommit`).
    const { cancelledTicketIds, updatedTicketIds } =
      await kds.cancelTicketItemsForRefund(tx, orderId, [orderItemId]);
    for (const id of cancelledTicketIds) {
      if (!postCommit.cancelledTicketIds.includes(id)) {
        postCommit.cancelledTicketIds.push(id);
      }
    }
    for (const id of updatedTicketIds) {
      if (!postCommit.updatedTicketIds.includes(id)) {
        postCommit.updatedTicketIds.push(id);
      }
    }

    // 6. Audit (same family as cancelOrderItem's prepared_disposition).
    const requestId = RequestContextService.getRequestId();
    await tx.audit_logs.create({
      data: {
        user_id: userId ?? null,
        organization_id: organizationId,
        store_id: storeId,
        action: 'order_item.refund_dish_disposition',
        resource: AuditResource.ORDERS,
        resource_id: orderId,
        request_id: requestId && requestId.length <= 100 ? requestId : null,
        metadata: {
          order_id: orderId,
          order_item_id: orderItemId,
          refund_id: refundId,
          reason: motivo || null,
          destination: disposition,
          fired,
          refunded_qty: refundQty,
          cumulative_refunded_qty: cumAfter,
          consumed_cost: fullConsumedCost,
          reversed_leaves: reversedLeaves,
        } as Prisma.InputJsonValue,
      },
    });

    // 7. COGS reclass on full line coverage (reuse: DR 1435 / CR 6135
    // symmetric reversal; waste: DR 5295 / CR 6135, COGS a pérdida).
    if (fullCovered && fullConsumedCost > 0) {
      postCommit.reclassJobs.push({
        order_item_id: orderItemId,
        organization_id: organizationId,
        disposition,
        total_cost: Math.round(fullConsumedCost * 100) / 100,
      });
    }
  }

  /**
   * QUI-431 — Return the serials of a refunded line of a serialized product,
   * inside the refund transaction (`tx`).
   *
   * No-op for non-serialized products (the enforcement service short-circuits).
   *
   * Steps:
   *  1. Find the serials that were `sold` on the ORIGINAL order_item via the
   *     polymorphic junction (`sales_document_serials`, type='order_item'),
   *     limited to `qty` (the refunded quantity for partial returns).
   *  2. For each: `returnSerial(reenterStock)` — `sold → returned` and, when
   *     `reenterStock` is true, `returned → in_stock` so it rejoins the
   *     sellable pool (it retains its location_id from the sale).
   *  3. Persist the CSV snapshot on the refund_item and link each serial to the
   *     refund_item document via the junction (type='refund_item').
   */
  private async returnSerialsForRefund(
    tx: any,
    product_id: number,
    order_item_id: number,
    refund_item_id: number | undefined,
    qty: number,
    reenterStock: boolean,
  ): Promise<void> {
    if (!(await this.serialEnforcement.isSerialized(product_id, tx))) {
      return;
    }

    // Serials sold on the original order_item (FIFO so partial returns are
    // deterministic). The junction is the strong link captured at sale time.
    const links = await tx.sales_document_serials.findMany({
      where: {
        document_item_type: 'order_item',
        document_item_id: order_item_id,
      },
      orderBy: { id: 'asc' },
      take: qty,
    });
    if (links.length === 0) return;

    const returnedSerialNumbers: string[] = [];
    for (const link of links) {
      const serial = await this.serialNumbers.returnSerial(
        link.serial_number_id,
        reenterStock,
        tx,
      );
      if (serial?.serial_number) {
        returnedSerialNumbers.push(serial.serial_number);
      }

      // Strong link to the refund document line. The unique constraint on
      // (serial_number_id, document_item_type, document_item_id) throws
      // P2002 if the serial was already linked to THIS refund_item (e.g., a
      // previous attempt that rolled back the transaction but left the link
      // behind, or a re-submit of the same wizard). Swallow P2002 to keep
      // the refund idempotent — the serial is still correctly accounted for
      // because `returnSerial` already mutated its state to `returned`/`in_stock`.
      // Re-throw any other Prisma error.
      if (refund_item_id != null) {
        try {
          await this.serialNumbers.linkToDocument(
            link.serial_number_id,
            'refund_item',
            refund_item_id,
            tx,
          );
        } catch (err: any) {
          if (err?.code === 'P2002') {
            this.logger.warn(
              `Serial #${link.serial_number_id} already linked to refund_item #${refund_item_id} — skipping duplicate link (idempotent retry).`,
            );
          } else {
            throw err;
          }
        }
      }
    }

    // Immutable snapshot on the refund line (CSV of serial_number strings).
    if (refund_item_id != null && returnedSerialNumbers.length > 0) {
      await tx.refund_items.updateMany({
        where: { id: refund_item_id },
        data: { serial_numbers_snapshot: returnedSerialNumbers.join(', ') },
      });
    }
  }

  /**
   * Dispatch the `original_payment` reversal to the corresponding payment
   * processor SYNCHRONOUSLY and persist the outcome on the refund row.
   *
   * Historia:
   *   - Pre-PR-576: esta función no existía. Los refunds `original_payment`
   *     sobre pago por gateway se marcaban `completed` en la tx sin reversar
   *     nada en Wompi/cash_on_delivery/etc. (bug crítico).
   *   - PR-576: introdujo esta función con el patrón "emit +
   *     listener round-trip". El listener del processor promovía a
   *     `completed` o rechazaba con `failed`. Sin listener, el refund
   *     quedaba `pending_approval` para intervención manual — muchos
   *     refunds se atascaron ahí indefinidamente.
   *   - W2-A (refund-gateway-fix): la rama emite-en-proceso. Llamamos
   *     `PaymentGatewayService.reversePaymentWithProcessor` directamente,
   *     mapeamos `RefundResult.status` → `refunds_state_enum`, y
   *     actualizamos el refund row con el estado terminal (o
   *     `processing` cuando la pasarela sigue trabajando). Esto le
   *     devuelve control al usuario sincrónicamente y elimina el limbo.
   *
   * Devuelve `{ status: 'completed' | 'failed' | 'processing', message? }`.
   *
   *   - `completed` → el caller emite `refund.completed` para que la
   *     contabilidad registre la reversión exitosa.
   *   - `failed` → el intento terminó sin éxito; el caller NO emite
   *     `refund.completed`, igual que en la resolución manual fallida.
   *   - `processing` → el processor reportó `pending` o no había
   *     processor reversible que llamar; el caller NO emite y el
   *     refund queda en `processing`/`pending_approval` para
   *     reconciliación posterior (webhook del gateway, intervención
   *     manual del operador, o el próximo reintento).
   */
  private async dispatchRefundProcessor(
    order: any,
    completedRefund: any,
    amount: number,
  ): Promise<{ status: 'completed' | 'failed' | 'processing'; message?: string }> {
    // Step 2 follow-up: `partially_refunded` stays in play so a second
    // `original_payment` gateway refund still auto-dispatches instead of
    // parking as manual `processing`.
    const activePayment = order.payments?.find(
      (p: any) =>
        p.state === 'succeeded' ||
        p.state === 'pending' ||
        p.state === 'partially_refunded',
    );

    if (!activePayment) {
      this.logger.warn(
        `Refund #${completedRefund.id}: no active payment found, leaving pending for manual operator intervention.`,
      );
      return { status: 'processing', message: 'No active payment on the order' };
    }

    const systemMethodType =
      activePayment.store_payment_method?.system_payment_method?.type;
    const transactionId = activePayment.transaction_id;

    if (!transactionId) {
      this.logger.warn(
        `Refund #${completedRefund.id}: payment has no transaction_id (method=${systemMethodType ?? 'unknown'}), leaving pending.`,
      );
      return { status: 'processing', message: 'Payment has no gateway transaction_id' };
    }

    // Sólo llamamos al processor real para gateways reversibles por API.
    // Para cualquier otro canal (cash, bank_transfer, store_credit, voucher,
    // wallet, etc.) la promesa se cumplió en la tx y no corresponde tocar
    // aquí. Devolverse con `processing` y dejar el refund row intacto
    // (seguirá en `pending_approval` para intervención manual si el
    // operador eligió un canal no-gateway, o en `completed` si la tx ya
    // lo cerró).
    const reversible = (API_REVERSIBLE_REFUND_PROCESSORS as readonly string[]).includes(
      systemMethodType,
    );
    if (!reversible) {
      return {
        status: 'processing',
        message: `${systemMethodType ?? 'unknown'} requires manual operator intervention`,
      };
    }

    // Llamada síncrona al processor. Wompi / PayPal / Stripe reversan la
    // transacción en la pasarela y devuelven `RefundResult` con
    // `status ∈ {'succeeded', 'failed', 'pending'}`. Si la pasarela
    // lanzó una excepción (red caída, credenciales inválidas, etc.), la
    // capturamos y marcamos el refund como `failed` — preferimos
    // honrar la verdad ("no pudimos reversar") antes que fingir éxito.
    let result;
    try {
      result = await this.paymentGatewayService.reversePaymentWithProcessor(
        transactionId,
        amount,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Refund #${completedRefund.id}: reversePaymentWithProcessor threw — ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.prisma.refunds.update({
        where: { id: completedRefund.id },
        data: {
          state: refunds_state_enum.failed,
          gateway_response: JSON.stringify({ error: message }),
          processed_at: null,
          updated_at: new Date(),
        },
      });
      // Release-853 (paso 7): al caer a `failed` el refund sale del ledger
      // — el caché por línea se re-agrega sin él (best-effort post-commit:
      // el dinero ya se movió y el caché nunca revienta la respuesta).
      await this.refreshLineCacheBestEffort(order.id, completedRefund.id);
      return { status: 'failed', message };
    }

    // REFUND_STATE: RefundResult.status (proveniente del processor) →
    // refunds_state_enum (columna Prisma). Mismo mapa que el
    // `createRefundRecord` interno del gateway usa (convención de
    // dominio: succeeded→completed, failed→failed, pending→processing).
    const REFUND_STATE: Record<typeof result.status, refunds_state_enum> = {
      succeeded: refunds_state_enum.completed,
      failed: refunds_state_enum.failed,
      pending: refunds_state_enum.processing,
    };
    const newState = REFUND_STATE[result.status] ?? refunds_state_enum.processing;

    // Persistimos el resultado en el refund row ya committed.
    // `refund_transaction_id` lleva el id que la pasarela devolvió
    // (ej. `wo-refund-abc-123`) para reconciliación con el webhook.
    // `gateway_response` lleva la respuesta cruda para auditorías
    // (Prisma.JsonNull si el processor no devolvió nada — sin esto,
    // escribir `undefined` fallaría la validación de tipo).
    await this.prisma.refunds.update({
      where: { id: completedRefund.id },
      data: {
        state: newState,
        refund_transaction_id: result.refundId ?? null,
        gateway_response:
          result.gatewayResponse !== undefined
            ? (result.gatewayResponse as any)
            : Prisma.JsonNull,
        processed_at: result.status === 'succeeded' ? new Date() : null,
        updated_at: new Date(),
      },
    });
    if (newState === refunds_state_enum.failed) {
      await this.refreshLineCacheBestEffort(order.id, completedRefund.id);
    }

    this.logger.log(
      `Refund #${completedRefund.id}: processor returned status=${result.status}, persisted state=${newState}`,
    );

    // Traducimos al vocabulario del refund-flow (completed / failed /
    // processing) para que el caller decida si emite `refund.completed`.
    const terminal: Record<typeof result.status, 'completed' | 'failed' | 'processing'> = {
      succeeded: 'completed',
      failed: 'failed',
      pending: 'processing',
    };
    return {
      status: terminal[result.status],
      message: result.message,
    };
  }

  /**
   * Release-853 (paso 7) — re-agregación best-effort del caché de cobertura
   * tras una caída a `failed` fuera de tx (dispatch de pasarela). El refund
   * ya cambió de estado y el dinero ya se movió: si el re-agregado falla
   * se loguea para reconciliación del operador y la próxima creación o
   * resolve lo repara (el helper es idempotente). Nunca lanza.
   */
  private async refreshLineCacheBestEffort(
    orderId: number,
    refundId: number,
  ): Promise<void> {
    try {
      await this.coverageService?.recomputeLineCache(this.prisma, orderId);
    } catch (error) {
      this.logger.error(
        `Refund #${refundId} (order #${orderId}): line-cache recompute after failed transition failed, reconcile from refund_items ledger: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 4 — entrega durable del movimiento de caja
   * del refund. Reemplaza al best-effort silencioso: cada camino devuelve
   * un aviso explícito que viaja en la respuesta (`recorded` / `pending` /
   * `skipped`), y `pending` siempre deja fila en el outbox. Non-blocking
   * para el refund (ya committed): hasta el fallo del propio outbox se
   * degrada a `pending` con log, nunca lanza.
   */
  private async recordRefundCashRegisterMovement(input: {
    organization_id: number | null | undefined;
    store_id: number;
    user_id: number;
    refund_id: number;
    order_id: number;
    payment_id: number | null;
    amount: number | Prisma.Decimal;
    channel: string;
  }): Promise<RefundCashMovementNotice> {
    try {
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (!cr_settings?.enabled) {
        this.logger.warn(
          `Refund #${input.refund_id} (order #${input.order_id}): cash register ` +
            `module disabled — no cash movement to deliver (skipped).`,
        );
        return { status: 'skipped', reason: 'cash_register_disabled' };
      }
      if (input.organization_id == null) {
        this.logger.error(
          `Refund #${input.refund_id} (order #${input.order_id}): cannot ` +
            `deliver cash movement — organization unknown, outbox row unwritable.`,
        );
        return { status: 'pending', failure_id: null, reason: 'unknown_organization' };
      }

      // Sesión activa tal cual (`getActiveSession`); `null` = el durable
      // escribe al outbox en vez de retornar en silencio.
      const session = await this.sessionsService.getActiveSession(input.user_id);

      return await this.movementsService.recordRefundCashMovementDurable({
        organization_id: input.organization_id,
        store_id: input.store_id,
        user_id: input.user_id,
        refund_id: input.refund_id,
        order_id: input.order_id,
        payment_id: input.payment_id,
        amount: Number(input.amount),
        channel: input.channel,
        session_id: session?.id ?? null,
      });
    } catch (error) {
      // Non-critical: don't fail the refund if movement recording fails —
      // but say so explicitly instead of swallowing it.
      this.logger.error(
        `Refund #${input.refund_id} (order #${input.order_id}): cash movement ` +
          `delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        status: 'pending',
        failure_id: null,
        reason: 'delivery_error',
      };
    }
  }

  async getOrderRefunds(orderId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    return this.prisma.refunds.findMany({
      where: { order_id: orderId },
      include: {
        refund_items: {
          include: {
            order_items: true,
            inventory_locations: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        users: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * refund-gateway-fix (W2-B) — cierre MANUAL de un refund que el flujo
   * automático no terminó (processor colgado, refund legacy sin processor,
   * reversión confirmada por canal externo).
   *
   * Por qué existe esta vía:
   *   El plan CP-refund-gateway-dispatch-fix documenta el caso de la tienda
   *   Nails Estilo Alai: un refund de $20K quedó en `pending_approval`
   *   indefinidamente porque el processor no emitió el evento de
   *   aprobación. Antes de este método no había escape — la fila quedaba
   *   ahí para siempre, contando contra `REFUND_PENDING_STATES` y
   *   distorsionando la tarjeta "Por reembolsar" del dashboard.
   *
   * Reglas de aceptación (ver plan B.2 / ERR-01..ERR-03):
   *  1. El refund debe pertenecer al `orderId` (ERR-02 si no).
   *     Esto cubre IDOR entre tiendas: si una tienda mete el `refundId`
   *     de OTRA tienda, devuelve 404 con código explícito — no leakeamos
   *     la existencia del refund ajeno.
   *  2. El refund debe estar en estado NO terminal
   *     (`requested | pending_approval | approved | processing`).
   *     Cerrar uno ya cerrado corrompería la contabilidad y rompería
   *     `REFUND_PENDING_STATES` (ERR-01).
   *  3. `resolution_notes` debe llegar no-vacío. El DTO ya lo exige con
   *     `@IsNotEmpty()`, pero re-verificamos defensivamente porque un
   *     bypass del class-validator no debería poder saltarse la auditoría.
   *  4. Sólo `target_state='completed'` emite `refund.completed` —
   *     `failed` NO mueve dinero, así que el asiento contable
   *     apropiado es uno de cancelación (lo cubre `cash-settlement` /
   *     rutas), no la reversión. El listener cache-invalidation SÍ
   *     necesita dispararse — pero `accounting-events.listener`
   *     sólo escucha `refund.completed`, así que emitirla en un
   *     `failed` generaría un asiento de reversión incorrecto.
   *
   * Payload del emit (canónico, mismo shape que usa `createRefund`):
   *   `accounting-events.listener.ts:577` y
   *   `financial-analytics-cache-invalidation.listener.ts:52` consumen
   *   `refund.completed` — cambiar el shape los rompería en silencio.
   *   Por eso este método REPLICA el bloque de emit existente, sólo
   *   intercambiando el `result` por el update manual.
   *
   * CP-REFUND-FLOW-REDESIGN paso 5 — normalización al contrato ordinario:
   *   un `completed` manual aplica los mismos side-effects que un
   *   `completed` ordinario (pagos con semántica multi-pago del paso 2,
   *   orden a `refunded` al cubrir el acumulado, wallet vía
   *   `creditForRefund`, caja vía `recordRefundCashRegisterMovement`
   *   durable del paso 4) y emite `refund.completed` con los campos
   *   canónicos (montos, `tax_breakdown`, `refund_method`,
   *   `effective_channel`). Dos lados quedan explícitamente manuales
   *   (escape hatch de la Business decision): (1) el asiento contable
   *   sigue en el carril durable `manual_refund_delivery_v1` — el
   *   listener ordinario lo salta por el marcador `manual_durable`, así
   *   que el carril único anti-doble-reversa refund-vs-NC queda intacto
   *   y ningún consumidor recibe un doble post; (2) inventario y caché
   *   de cobertura NO se re-aplican porque ya se escribieron en la
   *   creación del refund (re-mover stock duplicaría unidades) y los
   *   refunds sin ítems (cancelación) no tienen nada que aplicar.
   */
  async manuallyResolveRefund(
    orderId: number,
    refundId: number,
    targetState: 'completed' | 'failed',
    resolutionNotes: string,
    userId: number,
    payoutReference?: string,
    payoutChannel?: RefundPayoutChannel,
  ) {
    const trimmedNotes =
      typeof resolutionNotes === 'string' ? resolutionNotes.trim() : '';
    if (!trimmedNotes) {
      throw new BadRequestException(
        'resolution_notes is required for manual refund resolution',
      );
    }
    const reference = typeof payoutReference === 'string' ? payoutReference.trim() : '';
    if (
      targetState === 'completed' &&
      (!reference || reference.length > 255 ||
        !Object.values(RefundPayoutChannel).includes(payoutChannel as RefundPayoutChannel))
    ) {
      throw new VendixHttpException(ErrorCodes.REF_PAYOUT_REQUIRED_001);
    }

    // refunds has no `stores` relation. The scoped order read establishes the
    // real store and organization; the refund lookup remains bound to orderId.
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        store_id: true,
        // Paso 5: estado + cliente + piernas de pago para los side-effects
        // ordinarios (promoción de orden/pagos, wallet). `order_number`
        // alimenta `order.status_changed` como en `createRefund`.
        state: true,
        customer_id: true,
        order_number: true,
        payments: { select: { id: true, state: true } },
        grand_total: true,
        shipping_cost: true,
        shipping_tax_amount: true,
        shipping_tax_type: true,
        stores: { select: { organization_id: true } },
        order_items: {
          select: {
            order_item_taxes: { select: { tax_type: true, tax_amount: true } },
          },
        },
        refunds: {
          where: { state: 'completed' },
          select: { id: true, amount: true, shipping_refund: true },
        },
      },
    });
    if (!order?.stores?.organization_id) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }
    const refund = await this.prisma.refunds.findFirst({
      where: { id: refundId, order_id: orderId },
      include: {
        refund_items: {
          select: {
            tax_amount: true,
            order_items: {
              select: {
                order_item_taxes: { select: { tax_type: true, tax_amount: true } },
              },
            },
          },
        },
      },
    });
    if (!refund || refund.order_id !== orderId) {
      throw new NotFoundException(`Refund #${refundId} not found`);
    }

    const nonterminalStates: refunds_state_enum[] = [
      refunds_state_enum.requested,
      refunds_state_enum.pending_approval,
      refunds_state_enum.approved,
      refunds_state_enum.processing,
    ];
    if (!nonterminalStates.includes(refund.state)) {
      throw new VendixHttpException(
        ErrorCodes.REF_RESOLUTION_CONFLICT_001,
        `Refund #${refundId} is already in terminal state '${refund.state}' and cannot be resolved again`,
      );
    }
    if (
      targetState === 'completed' &&
      refund.refund_transaction_id &&
      refund.refund_transaction_id !== reference &&
      !isCancellationRefundPlaceholder(refund.refund_transaction_id)
    ) {
      // A gateway refund ID may already occupy this unique column. Never
      // overwrite it with a different manual payout reference. ADR-12
      // placeholders are the deliberate exception: they are deterministic
      // no-dup keys, not gateway ids, so the real payout reference replaces
      // them — otherwise no cancellation refund could ever close manually.
      throw new VendixHttpException(ErrorCodes.REF_RESOLUTION_CONFLICT_001);
    }

    // Paso 5 — cobertura acumulada en decimales exactos: lo ya completado
    // (cargado en el select de arriba) más este refund cubre el total de la
    // orden con tolerancia de 1¢, igual que el techo del paso 1.
    const orderGrandTotal = new Prisma.Decimal(order.grand_total as any);
    const priorCompletedTotal = (order.refunds ?? []).reduce(
      (acc, row) => acc.plus(new Prisma.Decimal(row.amount as any)),
      new Prisma.Decimal(0),
    );
    // Valor pre-tx (lectura sin lock): se RECALCULA bajo el lock dentro de
    // la tx de abajo (release-853, paso 7) — un resolve concurrente puede
    // completar otro parcial entre ambas lecturas y dejarlo viejo.
    let isFullRefund = priorCompletedTotal
      .plus(new Prisma.Decimal(refund.amount as any))
      .greaterThanOrEqualTo(orderGrandTotal.minus(0.01));
    // La orden sólo se promueve desde estados reembolsables: una orden
    // `cancelled` (cancelación ADR-12/efectivo) conserva su estado — el
    // `refunded` ordinario nunca pisa una cancelación.
    let willPromoteOrder =
      targetState === 'completed' &&
      isFullRefund &&
      REFUNDABLE_STATES.includes(order.state);
    // Piernas liquidadas con el mismo predicado del paso 2: una pierna
    // `partially_refunded` sigue en juego para promoverse a `refunded`.
    const settledLegs = (order.payments ?? [])
      .filter(
        (leg) =>
          leg.state === 'succeeded' ||
          leg.state === 'pending' ||
          leg.state === 'partially_refunded',
      )
      .sort((a, b) => a.id - b.id);

    const newState = targetState === 'completed'
      ? refunds_state_enum.completed
      : refunds_state_enum.failed;
    const processedAt = newState === refunds_state_enum.completed
      ? new Date()
      : refund.processed_at ?? null;
    const updateData = {
      state: newState,
      resolved_by_user_id: userId,
      resolution_notes: trimmedNotes,
      processed_at: processedAt,
      updated_at: new Date(),
      ...(targetState === 'completed' ? {
        refund_transaction_id: reference,
        refund_method: payoutChannel!,
      } : {}),
    };
    let deliveryId: number | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize two manual completions for the same order, so the prior
        // shipping/tip allocation snapshot has a deterministic predecessor.
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND store_id = ${order.store_id} FOR UPDATE`;
        const prior = await tx.refunds.findMany({
          where: { order_id: orderId, state: 'completed' },
          select: { id: true, amount: true },
        });
        // Release-853 (paso 7) — `is_full_refund` bajo el lock: la lectura
        // pre-tx pudo quedar vieja si otro resolve concurrente completó un
        // parcial en el medio. Sólo `completed` cubre (un `failed`/`pending`
        // no movió dinero y no promueve pagos ni orden a `refunded`).
        isFullRefund = prior
          .reduce(
            (acc, row) => acc.plus(new Prisma.Decimal((row.amount as any) ?? 0)),
            new Prisma.Decimal(0),
          )
          .plus(new Prisma.Decimal(refund.amount as any))
          .greaterThanOrEqualTo(orderGrandTotal.minus(0.01));
        willPromoteOrder =
          targetState === 'completed' &&
          isFullRefund &&
          REFUNDABLE_STATES.includes(order.state);
        const claim = await tx.refunds.updateMany({
          where: {
            id: refundId, order_id: orderId,
            state: { in: nonterminalStates },
          },
          data: updateData,
        });
        if (claim.count !== 1) throw new VendixHttpException(ErrorCodes.REF_RESOLUTION_CONFLICT_001);
        // Plan order-truth-and-invoice-tz — Paso 6. Resolución manual del
        // refund (completed o failed); el `state_changed` de la orden (si
        // esta rama promueve) se registra junto a esa escritura, más abajo.
        await this.orderHistoryService?.record(tx, {
          orderId,
          storeId: order.store_id,
          organizationId: order.stores.organization_id,
          type: 'refund_resolved',
          paymentId: refund.payment_id ?? null,
          amount: refund.amount.toString(),
          actorUserId: userId,
          payload: {
            refund_id: refundId,
            target_state: targetState,
            resolution_notes: trimmedNotes,
            payout_reference: targetState === 'completed' ? reference : null,
            payout_channel: targetState === 'completed' ? payoutChannel : null,
          },
        });
        if (targetState === 'completed') {
          const payload: ManualRefundDeliveryPayload = {
            version: 1, refund_id: refundId, order_id: orderId,
            organization_id: order.stores.organization_id,
            store_id: order.store_id, user_id: userId,
            payout_channel: payoutChannel!,
            prior_refund_ids: prior.map((row) => row.id),
          };
          const delivery = await tx.accounting_entry_failures.create({ data: {
            organization_id: payload.organization_id,
            store_id: payload.store_id,
            handler_key: MANUAL_REFUND_DELIVERY_KEY,
            source_type: MANUAL_REFUND_DELIVERY_SOURCE,
            source_id: refundId,
            event_payload: payload as unknown as Prisma.InputJsonValue,
            error_message: 'PENDING_DELIVERY: manual refund accounting not yet posted',
          } });
          deliveryId = delivery.id;

          // Paso 5 — side-effects ordinarios de pago/orden, atómicos con el
          // claim. Idempotentes para refunds atascados (la creación ya los
          // aplicó con los mismos valores) y correctivos para piernas de
          // cancelación (ADR-12), que nacen sin tocar pagos. Un parcial sin
          // `payment_id` vinculado no atribuye pierna: se salta antes que
          // marcar un pago ajeno.
          if (isFullRefund) {
            for (const leg of settledLegs) {
              await tx.payments.update({
                where: { id: leg.id },
                data: { state: 'refunded', updated_at: new Date() },
              });
            }
          } else {
            const linkedPaymentId = refund.payment_id;
            if (
              linkedPaymentId != null &&
              settledLegs.some((leg) => leg.id === linkedPaymentId)
            ) {
              await tx.payments.update({
                where: { id: linkedPaymentId },
                data: { state: 'partially_refunded', updated_at: new Date() },
              });
            }
          }
          if (willPromoteOrder) {
            await tx.orders.update({
              where: { id: orderId },
              data: { state: 'refunded', updated_at: new Date() },
            });
            await this.orderHistoryService?.record(tx, {
              orderId,
              storeId: order.store_id,
              organizationId: order.stores.organization_id,
              type: 'state_changed',
              fromState: order.state,
              toState: 'refunded',
            });
          }
        } else {
          // Release-853 (paso 7) — rama `failed`: el refund sale del ledger
          // en este mismo claim, así que el caché por línea se re-agrega
          // sin él (las líneas que quedan sin ledger vuelven a 0). En-tx
          // bajo el lock de la orden: si el re-agregado falla, el resolve
          // entero revierte en vez de dejar caché y ledger descuadrados.
          await this.coverageService?.recomputeLineCache(tx, orderId);
        }
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.REF_RESOLUTION_CONFLICT_001);
      }
      throw error;
    }
    const updatedRefund = { ...refund, ...updateData };
    // Paso 5 — `payoutChannel` es un canal directo (cash/bank_transfer/
    // store_credit/gateway): el resolver lo mapea uno-a-uno sin necesitar
    // el tipo del pago original.
    const effectiveChannel =
      deliveryId !== null
        ? resolveEffectiveRefundChannel(payoutChannel!, null)
        : null;
    let cash_movement: RefundCashMovementNotice | undefined;
    if (deliveryId !== null) {
      // The row survives a process crash here; the retry worker also sweeps
      // stranded rows. A journal failure cannot undo a real-world payout.
      try { await this.manualRefundDelivery.deliver(deliveryId); }
      catch (error) {
        this.logger.error(`Refund #${refundId} accounting delivery #${deliveryId} remains unresolved: ${error}`);
        try { await this.manualRefundDelivery.enqueue(deliveryId); }
        catch (queueError) { this.logger.error(`Refund #${refundId} delivery retry could not be queued: ${queueError}`); }
      }
      // Paso 5 — emit canónico: los mismos campos que `createRefund`
      // (montos, desglose, método, canal efectivo) reconstruidos de la fila
      // persistida. El marcador `manual_durable` se conserva para que el
      // listener ordinario NO postee un segundo asiento: el carril único
      // sigue siendo la delivery durable de arriba.
      const fiscal = this.buildManualResolveFiscalPayload(order, refund);
      try {
        this.eventEmitter.emit('refund.completed', {
          refund_id: refundId, order_id: orderId,
          organization_id: order.stores.organization_id, store_id: order.store_id,
          amount: fiscal.amount,
          subtotal: fiscal.subtotal,
          tax: fiscal.tax,
          tax_amount: fiscal.tax_amount,
          tax_breakdown: fiscal.tax_breakdown,
          shipping: fiscal.shipping,
          is_full_refund: isFullRefund,
          user_id: userId,
          refund_method: payoutChannel!,
          effective_channel: effectiveChannel!,
          accounting_delivery: 'manual_durable',
        });
      } catch (error) {
        this.logger.error(`Refund #${refundId} cache invalidation event failed: ${error}`);
      }

      if (willPromoteOrder) {
        try {
          this.eventEmitter.emit('order.status_changed', {
            store_id: order.store_id,
            organization_id: order.stores.organization_id,
            order_id: orderId,
            order_number: order.order_number,
            old_state: order.state,
            new_state: 'refunded',
          });
        } catch (error) {
          this.logger.error(`Refund #${refundId} order status event failed: ${error}`);
        }
      }

      // Paso 5 — wallet vía el mismo `creditForRefund` durable del paso 4.
      // Non-blocking como en el ordinario: el refund ya está committed.
      if (payoutChannel === RefundPayoutChannel.STORE_CREDIT && order.customer_id) {
        try {
          await this.walletService.creditForRefund(
            order.customer_id,
            fiscal.amount,
            { refund_id: refundId, order_id: orderId, user_id: userId },
          );
          this.logger.log(
            `Wallet credited: customer=${order.customer_id} amount=${fiscal.amount} refund=#${refundId} (manual resolve)`,
          );
        } catch (e) {
          this.logger.error(
            `Failed to credit wallet for manually resolved refund #${refundId} (customer=${order.customer_id}): ${e?.message ?? e}`,
          );
        }
      }

      // Paso 5 — caja vía el helper durable compartido del paso 4. Sólo
      // cuando el canal efectivo es `cash` (misma compuerta del ordinario);
      // la respuesta lleva el aviso explícito igual que `createRefund`.
      if (userId && effectiveChannel === 'cash') {
        cash_movement = await this.recordRefundCashRegisterMovement({
          organization_id: order.stores.organization_id,
          store_id: order.store_id,
          user_id: userId,
          refund_id: refundId,
          order_id: orderId,
          payment_id: refund.payment_id ?? null,
          amount: fiscal.amount,
          channel: effectiveChannel,
        });
      }
    }
    this.logger.log(
      `Refund #${refundId} (order #${orderId}) manually resolved to '${newState}' by user #${userId}: "${trimmedNotes.slice(0, 80)}${trimmedNotes.length > 80 ? '…' : ''}"`,
    );
    return cash_movement === undefined
      ? updatedRefund
      : { ...updatedRefund, cash_movement };
  }

  /**
   * CP-REFUND-FLOW-REDESIGN paso 5 — reconstruye los montos canónicos del
   * emit `refund.completed` desde la fila persistida del refund (misma
   * derivación que el bloque de emit de `createRefund`, sin re-consultar:
   * todo viene de los selects ya cargados). Las filas tipadas se toman de
   * los ítems del refund cuando existen y de la orden en caso contrario
   * (refunds de cancelación sin ítems). El impuesto del envío usa la misma
   * fórmula determinista de `RefundCalculationService.calculate` sobre la
   * copia congelada de la orden (`shipping_refund` es BRUTO).
   */
  private buildManualResolveFiscalPayload(
    order: {
      shipping_cost: Prisma.Decimal | number;
      shipping_tax_amount: Prisma.Decimal | number;
      shipping_tax_type: string | null;
      order_items?: {
        order_item_taxes?: {
          tax_type?: string | null;
          tax_amount?: Prisma.Decimal | number | null;
        }[] | null;
      }[] | null;
      refunds?: {
        shipping_refund?: Prisma.Decimal | number | null;
      }[] | null;
    },
    refund: {
      amount: Prisma.Decimal | number;
      subtotal_refund?: Prisma.Decimal | number | null;
      tax_refund?: Prisma.Decimal | number | null;
      shipping_refund?: Prisma.Decimal | number | null;
      refund_items?: {
        order_items?: {
          order_item_taxes?: {
            tax_type?: string | null;
            tax_amount?: Prisma.Decimal | number | null;
          }[] | null;
        } | null;
      }[] | null;
    },
  ): {
    amount: number;
    subtotal: number;
    tax: number;
    tax_amount: number;
    tax_breakdown: TaxBreakdownItem[];
    shipping: number;
  } {
    const productTax = Number(refund.tax_refund ?? 0);
    const itemTaxRows = (refund.refund_items ?? []).flatMap(
      (item) => item.order_items?.order_item_taxes ?? [],
    );
    const orderTaxRows = (order.order_items ?? []).flatMap(
      (item) => item.order_item_taxes ?? [],
    );
    // B1 gate step 10: buildTaxBreakdown exige tax_amount presente; la
    // normalización vive en el borde (filas ?? 0 se ignoran igual adentro).
    const taxRows = (itemTaxRows.length > 0 ? itemTaxRows : orderTaxRows).map(
      (row) => ({ ...row, tax_amount: row.tax_amount ?? 0 }),
    );
    const tax_breakdown = scaleBreakdownToTotal(
      buildTaxBreakdown(taxRows),
      productTax,
    );
    const shippingRefundCents = Math.round(
      Number(refund.shipping_refund ?? 0) * 100,
    );
    const shippingCostCents = Math.round(Number(order.shipping_cost ?? 0) * 100);
    const shippingTaxCents = Math.round(
      Number(order.shipping_tax_amount ?? 0) * 100,
    );
    let shippingTaxRefund = 0;
    if (
      shippingRefundCents > 0 &&
      shippingCostCents > 0 &&
      shippingTaxCents > 0
    ) {
      const proportional = (cents: number) =>
        Math.round((shippingTaxCents * cents) / shippingCostCents);
      let priorCents = 0;
      let priorTaxCents = 0;
      for (const row of order.refunds ?? []) {
        const cents = Math.round(Number(row.shipping_refund ?? 0) * 100);
        if (cents <= 0) continue;
        priorCents += cents;
        priorTaxCents += proportional(cents);
      }
      const remaining = Math.max(0, shippingTaxCents - priorTaxCents);
      shippingTaxRefund =
        (priorCents + shippingRefundCents >= shippingCostCents
          ? remaining
          : Math.min(remaining, proportional(shippingRefundCents))) / 100;
    }
    const shippingTaxType =
      shippingTaxRefund > 0 ? (order.shipping_tax_type ?? null) : null;
    if (shippingTaxRefund > 0 && shippingTaxType) {
      if (tax_breakdown.length === 0 && productTax > 0) {
        tax_breakdown.push({ tax_type: 'iva', tax_amount: productTax });
      }
      tax_breakdown.push({
        tax_type: shippingTaxType as TaxBreakdownItem['tax_type'],
        tax_amount: shippingTaxRefund,
      });
    }
    const tax =
      Math.round(productTax * 100 + shippingTaxRefund * 100) / 100;
    return {
      amount: Number(refund.amount ?? 0),
      subtotal: Number(refund.subtotal_refund ?? 0),
      tax,
      tax_amount: tax,
      tax_breakdown,
      shipping: Number(refund.shipping_refund ?? 0),
    };
  }

  /**
   * REFUND OVERHAUL — resolve the canonical "main warehouse" for a store.
   * Mirrors the fallback chain in `LocationsService.getDefaultLocation`:
   *   1. `stores.default_location_id` (operator-pinned)
   *   2. any active warehouse for the store
   *   3. any active location for the store
   *   4. org-level central warehouse
   * Returns null if no usable location exists (caller should throw a clear
   * error rather than silently fall back to a random location).
   */
  private async resolveDefaultLocation(storeId: number): Promise<number | null> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { default_location_id: true, organization_id: true },
    });
    if (!store) return null;

    if (store.default_location_id) {
      const active = await this.prisma.inventory_locations.findFirst({
        where: { id: store.default_location_id, is_active: true },
        select: { id: true },
      });
      if (active) return active.id;
    }

    const fallback = await this.prisma.inventory_locations.findFirst({
      where: {
        is_active: true,
        OR: [
          { store_id: storeId },
          { organization_id: store.organization_id, store_id: null },
        ],
      },
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      select: { id: true },
    });
    return fallback?.id ?? null;
  }
}
