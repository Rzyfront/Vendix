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
} from 'src/common/interfaces/tax-breakdown.interface';
import {
  RefundCalculationService,
  RefundCalculationResult,
} from './refund-calculation.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { resolveRefundStockUnits } from '../../../products/services/packaging.util';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { PaymentGatewayService } from '../../../payments/services/payment-gateway.service';
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
  ) {}

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

        // ¿Llegamos a un estado terminal? Para refunds no-gateway, la promesa
        // se cumplió en la tx así que siempre emitimos. Para refunds
        // gateway, sólo emitimos cuando el processor devolvió `completed` o
        // `failed` (`processing` significa que la pasarela sigue trabajando
        // y no debe generar asiento todavía).
        const reachedTerminalState =
          !awaitsReversal ||
          dispatchStatus === 'completed' ||
          dispatchStatus === 'failed';

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

          // Emit `refund.completed` ONLY when we reached a terminal state.
          // For non-gateway channels the refund was already `completed` in
          // the tx; for gateway channels we wait for the processor to come
          // back with `completed` or `failed`. `processing` means the
          // gateway is still working — emitting now would generate an
          // accounting entry for a reversal that hasn't actually happened
          // yet, which is the exact defect audit B.3 flagged.
          if (reachedTerminalState) {
            this.eventEmitter.emit('refund.completed', {
              refund_id: completedRefund.id,
              order_id: orderId,
              organization_id: order.stores?.organization_id,
              store_id: order.store_id,
              amount: calculation.total_refund,
              subtotal: calculation.subtotal_refund,
              tax: calculation.tax_refund,
              tax_amount: calculation.tax_refund,
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
   *   - `completed` / `failed` → el processor respondió terminalmente;
   *     el caller emite `refund.completed` para que la contabilidad
   *     registre la reversión (éxito o falla).
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
  ) {
    // (3) Re-verificación defensiva de la nota — el DTO ya exige
    // `@IsNotEmpty()`, pero esta función puede llamarse desde otros
    // call-sites en el futuro. Trim explícito para no aceptar
    // `"   "` como nota válida.
    const trimmedNotes =
      typeof resolutionNotes === 'string' ? resolutionNotes.trim() : '';
    if (!trimmedNotes) {
      throw new BadRequestException(
        'resolution_notes is required for manual refund resolution',
      );
    }

    // (1) Scoped lookup (el Store scope del `StorePrismaService` filtra
    // cross-tenant). Traemos `order_id` junto con `state` y
    // `processed_at` para validar pertenencia y construir el update
    // en la misma lectura.
    const refund = await this.prisma.refunds.findFirst({
      where: { id: refundId },
      select: {
        id: true,
        order_id: true,
        state: true,
        processed_at: true,
        amount: true,
        subtotal_refund: true,
        tax_refund: true,
        shipping_refund: true,
        refund_method: true,
        stores: { select: { organization_id: true } },
      },
    });
    if (!refund || refund.order_id !== orderId) {
      // ERR-02: 404 con código explícito. No distinguimos "no existe"
      // de "no pertenece a esta orden / tienda" para no leakear la
      // existencia de refunds de otras tiendas vía respuesta
      // diferenciada.
      throw new NotFoundException(`Refund #${refundId} not found`);
    }

    // (2) Guarda de estado no-terminal. `completed | failed | cancelled`
    // son terminales: reescribir uno corrompería el histórico contable.
    // El plan declara este caso ERR-01 (409) — aquí usamos
    // BadRequestException porque ya es el patrón del archivo (línea
    // 870 y siguientes); el filtro global del módulo contable acepta
    // códigos 4xx indistintamente para mapeo cliente.
    const terminalStates: refunds_state_enum[] = [
      refunds_state_enum.completed,
      refunds_state_enum.failed,
      refunds_state_enum.cancelled,
    ];
    if (terminalStates.includes(refund.state)) {
      throw new BadRequestException(
        `Refund #${refundId} is already in terminal state '${refund.state}' and cannot be resolved again`,
      );
    }

    const newState =
      targetState === 'completed'
        ? refunds_state_enum.completed
        : refunds_state_enum.failed;

    // `processed_at` se setea cuando el refund termina EXITOSAMENTE.
    // Si va a `failed` y ya tenía valor (poco probable, pero por si
    // el processor lo había marcado y luego queremos forzar `failed`
    // vía manual), preservamos ese valor histórico. Si era null,
    // sigue null — un `failed` no es una "ejecución completada".
    const processedAt =
      newState === refunds_state_enum.completed
        ? new Date()
        : refund.processed_at ?? null;

    const updatedRefund = await this.prisma.refunds.update({
      where: { id: refundId },
      data: {
        state: newState,
        resolved_by_user_id: userId,
        resolution_notes: trimmedNotes,
        processed_at: processedAt,
        updated_at: new Date(),
      },
    });

    // (4) Emit canónico — exactamente el mismo shape que usa
    // `createRefund` en líneas 485-509. Los listeners de contabilidad
    // y de invalidación de caché consumen este evento.
    if (newState === refunds_state_enum.completed) {
      // Lookup del canal efectivo para que la contabilidad enrute a la
      // PUC correcta (1105/1110/2335). Se calcula contra el método de
      // pago ORIGINAL — el operador que cerró el refund no lo cambió,
      // sólo cerró la fila. Re-llamamos al resolver con el input
      // `paymentType` que la orden llevaba cuando se creó el refund.
      //
      // Esta consulta extra es aceptable: el resolve endpoint es
      // operator-driven (1-2 clicks), no high-throughput. Si el
      // resolver requiere `payments` que la fila no carga, devolvemos
      // `null` y el listener cae al fallback `cash` — mismo
      // comportamiento que el emit original cuando no hay pagos. El
      // log warning deja rastro para diagnóstico.
      const refundWithPayment = await this.prisma.refunds.findFirst({
        where: { id: refundId },
        include: {
          payments: {
            select: {
              store_payment_method: {
                select: { system_payment_method: { select: { type: true } } },
              },
            },
          },
        },
      });
      let paymentType: string | null = null;
      if (
        refundWithPayment?.payments?.store_payment_method?.system_payment_method
          ?.type
      ) {
        paymentType =
          refundWithPayment.payments.store_payment_method
            .system_payment_method.type;
      }
      const effectiveChannel = resolveEffectiveRefundChannel(
        refund.refund_method ?? 'original_payment',
        paymentType,
      );

      this.eventEmitter.emit('refund.completed', {
        refund_id: updatedRefund.id,
        order_id: orderId,
        organization_id: refund.stores?.organization_id,
        store_id: undefined, // El refund row no carga store_id directamente;
        //   el listener de cache lo usa opcionalmente. Lo dejamos
        //   undefined para no inventar el id — si el listener lo
        //   necesita, la organización ya está en el payload.
        amount: Number(updatedRefund.amount),
        subtotal: refund.subtotal_refund ? Number(refund.subtotal_refund) : undefined,
        tax: refund.tax_refund ? Number(refund.tax_refund) : undefined,
        tax_amount: refund.tax_refund ? Number(refund.tax_refund) : undefined,
        shipping: refund.shipping_refund
          ? Number(refund.shipping_refund)
          : undefined,
        is_full_refund: false, // El manual resolve NO es por flujo completo —
        //   la UX permite ambos. Sin este dato en la URL no podemos
        //   inferir; lo marcamos false para que contabilidad no
        //   aplique lógica de refund total.
        user_id: userId,
        refund_method: refund.refund_method ?? undefined,
        effective_channel: effectiveChannel,
        resolution_notes: trimmedNotes,
      });
    }

    // Log diagnóstico — el caller sólo necesita la fila actualizada, pero
    // el equipo de soporte revisa el log para auditar quién cerró qué.
    this.logger.log(
      `Refund #${refundId} (order #${orderId}) manually resolved to '${newState}' by user #${userId}: "${trimmedNotes.slice(0, 80)}${trimmedNotes.length > 80 ? '…' : ''}"`,
    );

    return updatedRefund;
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
