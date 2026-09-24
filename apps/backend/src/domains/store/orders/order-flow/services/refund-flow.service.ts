import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
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
} from './refund-calculation.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { resolveRefundStockUnits } from '../../../products/services/packaging.util';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { RefundPayoutChannel } from '../dto/resolve-refund.dto';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
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

const REFUNDABLE_STATES = ['delivered', 'finished'];

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
  ) {}

  /** Cash cancellation uses the same refund document and ceiling as returns,
   * but deliberately does not invoke createRefund's stock or cash-register
   * side effects: cancelOrder already owns those effects exactly once.
   */
  async recordCancellationCashRefund(
    tx: Prisma.TransactionClient,
    order: {
      id: number;
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
    return { refund, breakdown };
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

    return this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
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
            products: { select: { id: true, track_inventory: true } },
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

    // Calculate the refund breakdown
    const calculation = await this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
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

    // Execute everything in a transaction
    return this.prisma
      .$transaction(async (tx) => {
        // 1. Create refund record
        const refund = await tx.refunds.create({
          data: {
            order_id: orderId,
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

        // 3. Process inventory per item
        for (const item of calculation.items) {
          if (item.inventory_action === 'no_return') continue;

          const orderItem = order.order_items.find(
            (oi) => oi.id === item.order_item_id,
          );
          if (!orderItem?.products) continue;

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

        // 4. Update payment state
        const activePayment = order.payments.find(
          (p) => p.state === 'succeeded' || p.state === 'pending',
        );
        if (activePayment) {
          await tx.payments.update({
            where: { id: activePayment.id },
            data: {
              state: calculation.is_full_refund
                ? 'refunded'
                : 'partially_refunded',
              updated_at: new Date(),
            },
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

        this.logger.log(
          `Refund #${completedRefund.id} processed for order #${orderId}: ` +
            `${calculation.total_refund.toFixed(2)} (${calculation.is_full_refund ? 'full' : 'partial'})`,
        );

        // QUI-457: If refund_method === 'store_credit', credit the customer's
        // wallet so the refund value is actually available to them. Non-blocking
        // because the refund row is already committed — a credit failure only
        // means an operator alert via log; the sale refund is intact.
        if (dto.refund_method === 'store_credit' && order.customer_id) {
          try {
            const customerWallet =
              await this.walletService.getOrCreateWallet(order.customer_id);
            await this.walletBalance.credit(
              customerWallet.id,
              Number(calculation.total_refund),
              {
                reference_type: 'refund',
                reference_id: completedRefund.id,
                description: `Refund #${completedRefund.id} for order #${orderId}`,
                created_by: userId,
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
        if (userId && movesCash) {
          this.recordRefundCashRegisterMovement(
            order.store_id,
            userId,
            calculation.total_refund,
            orderId,
          ).catch(() => {});
        }

        return completedRefund;
      });
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
    const activePayment = order.payments?.find(
      (p: any) => p.state === 'succeeded' || p.state === 'pending',
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
   * Record a refund movement in the cash register if the feature is enabled
   * and the user has an active session. Non-blocking.
   */
  private async recordRefundCashRegisterMovement(
    storeId: number,
    userId: number,
    amount: number,
    orderId: number,
  ): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (!cr_settings?.enabled) return;

      const session = await this.sessionsService.getActiveSession(userId);
      if (!session) return;

      await this.movementsService.recordRefundMovement(session.id, {
        store_id: storeId,
        user_id: userId,
        amount,
        payment_method: 'cash',
        order_id: orderId,
        reference: `Refund for order #${orderId}`,
      });
    } catch {
      // Non-critical: don't fail the refund if movement recording fails
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
      refund.refund_transaction_id !== reference
    ) {
      // A gateway refund ID may already occupy this unique column. Never
      // overwrite it with a different manual payout reference.
      throw new VendixHttpException(ErrorCodes.REF_RESOLUTION_CONFLICT_001);
    }

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
          where: { order_id: orderId, state: 'completed' }, select: { id: true },
        });
        const claim = await tx.refunds.updateMany({
          where: {
            id: refundId, order_id: orderId,
            state: { in: nonterminalStates },
          },
          data: updateData,
        });
        if (claim.count !== 1) throw new VendixHttpException(ErrorCodes.REF_RESOLUTION_CONFLICT_001);
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
        }
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.REF_RESOLUTION_CONFLICT_001);
      }
      throw error;
    }
    const updatedRefund = { ...refund, ...updateData };
    if (deliveryId !== null) {
      // The row survives a process crash here; the retry worker also sweeps
      // stranded rows. A journal failure cannot undo a real-world payout.
      try { await this.manualRefundDelivery.deliver(deliveryId); }
      catch (error) {
        this.logger.error(`Refund #${refundId} accounting delivery #${deliveryId} remains unresolved: ${error}`);
        try { await this.manualRefundDelivery.enqueue(deliveryId); }
        catch (queueError) { this.logger.error(`Refund #${refundId} delivery retry could not be queued: ${queueError}`); }
      }
      try {
        this.eventEmitter.emit('refund.completed', {
          refund_id: refundId, order_id: orderId,
          organization_id: order.stores.organization_id, store_id: order.store_id,
          accounting_delivery: 'manual_durable',
        });
      } catch (error) {
        this.logger.error(`Refund #${refundId} cache invalidation event failed: ${error}`);
      }
    }
    this.logger.log(
      `Refund #${refundId} (order #${orderId}) manually resolved to '${newState}' by user #${userId}: "${trimmedNotes.slice(0, 80)}${trimmedNotes.length > 80 ? '…' : ''}"`,
    );
    return updatedRefund;
  }

  private buildManualRefundCompletion(
    order: {
      grand_total: Prisma.Decimal;
      shipping_cost: Prisma.Decimal;
      shipping_tax_amount: Prisma.Decimal;
      shipping_tax_type: string | null;
      order_items: { order_item_taxes: { tax_type: string | null; tax_amount: Prisma.Decimal }[] }[];
      refunds: { id: number; amount: Prisma.Decimal; shipping_refund: Prisma.Decimal | null }[];
    },
    refund: {
      id: number;
      amount: Prisma.Decimal;
      subtotal_refund: Prisma.Decimal | null;
      tax_refund: Prisma.Decimal | null;
      shipping_refund: Prisma.Decimal | null;
      refund_items: {
        tax_amount: Prisma.Decimal | null;
        order_items: { order_item_taxes: { tax_type: string | null; tax_amount: Prisma.Decimal }[] };
      }[];
    },
  ): { taxAmount: number; taxBreakdown: TaxBreakdownItem[]; isFullRefund: boolean } {
    const productTax = new Prisma.Decimal(refund.tax_refund ?? 0);
    const shipping = new Prisma.Decimal(refund.shipping_refund ?? 0);
    const subtotal = new Prisma.Decimal(refund.subtotal_refund ?? 0);
    const amount = new Prisma.Decimal(refund.amount);
    if (
      amount.lessThanOrEqualTo(0) ||
      subtotal.lessThan(0) || productTax.lessThan(0) || shipping.lessThan(0) ||
      !subtotal.plus(productTax).plus(shipping).equals(amount)
    ) {
      throw new VendixHttpException(ErrorCodes.REF_TAX_BREAKDOWN_MISSING_001);
    }

    // Item refunds use only their refunded lines. Payment-scoped cancellation
    // refunds have no items and use the whole order's original fiscal mix.
    const productRows = refund.refund_items.length > 0
      ? refund.refund_items.flatMap((item) =>
          scaleBreakdownToTotal(
            buildTaxBreakdown(item.order_items.order_item_taxes),
            Number(item.tax_amount ?? 0),
          ),
        )
      : scaleBreakdownToTotal(
          buildTaxBreakdown(order.order_items.flatMap((item) => item.order_item_taxes)),
          Number(productTax),
        );
    const taxBreakdown = buildTaxBreakdown(productRows);
    const typedProductTax = taxBreakdown.reduce(
      (sum, row) => sum.plus(row.tax_amount), new Prisma.Decimal(0),
    );
    if (!typedProductTax.equals(productTax)) {
      throw new VendixHttpException(ErrorCodes.REF_TAX_BREAKDOWN_MISSING_001);
    }

    let shippingTaxCents = 0;
    const shippingTaxTotal = new Prisma.Decimal(order.shipping_tax_amount);
    if (shipping.greaterThan(0) && shippingTaxTotal.greaterThan(0)) {
      const shippingCostCents = new Prisma.Decimal(order.shipping_cost).times(100).toNumber();
      if (shippingCostCents <= 0 || !order.shipping_tax_type) {
        throw new VendixHttpException(ErrorCodes.REF_TAX_BREAKDOWN_MISSING_001);
      }
      const totalTaxCents = shippingTaxTotal.times(100).toNumber();
      const currentCents = shipping.times(100).toNumber();
      const prior = order.refunds.filter((row) => row.id !== refund.id);
      const priorShippingCents = prior.reduce(
        (sum, row) => sum + new Prisma.Decimal(row.shipping_refund ?? 0).times(100).toNumber(), 0,
      );
      const proportional = (cents: number) => Math.round(totalTaxCents * cents / shippingCostCents);
      const priorTaxCents = prior.reduce(
        (sum, row) => sum + proportional(new Prisma.Decimal(row.shipping_refund ?? 0).times(100).toNumber()), 0,
      );
      if (priorShippingCents + currentCents > shippingCostCents || priorTaxCents > totalTaxCents) {
        throw new VendixHttpException(ErrorCodes.REF_TAX_BREAKDOWN_MISSING_001);
      }
      shippingTaxCents = priorShippingCents + currentCents >= shippingCostCents
        ? totalTaxCents - priorTaxCents
        : Math.min(totalTaxCents - priorTaxCents, proportional(currentCents));
      taxBreakdown.push({
        tax_type: order.shipping_tax_type as TaxBreakdownItem['tax_type'],
        tax_amount: shippingTaxCents / 100,
      });
    }
    const taxAmount = productTax.plus(new Prisma.Decimal(shippingTaxCents).div(100)).toNumber();
    const completedTotal = order.refunds.reduce(
      (sum, row) => sum.plus(row.amount), new Prisma.Decimal(0),
    );
    return {
      taxAmount,
      taxBreakdown,
      isFullRefund: completedTotal.plus(amount).greaterThanOrEqualTo(order.grand_total),
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
