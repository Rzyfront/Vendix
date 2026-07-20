import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  serial_status_enum,
  sales_document_item_type_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  StockLevelManager,
  UpdateStockParams,
} from '../../inventory/shared/services/stock-level-manager.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';
import { InventorySerialNumbersService } from '../../inventory/serial-numbers/inventory-serial-numbers.service';
import { PurchaseOrdersService } from '../../orders/purchase-orders/purchase-orders.service';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';

interface DispatchNoteEvent {
  dispatch_note_id: number;
  dispatch_number: string;
  store_id: number;
  sales_order_id?: number | null;
  order_id?: number | null;
}

interface DispatchNoteVoidedEvent extends DispatchNoteEvent {
  void_reason: string;
}

interface DispatchNoteReceivedEvent {
  dispatch_note_id: number;
  dispatch_number: string;
  store_id: number;
  direction: string;
  subtype: string;
  supplier_id?: number | null;
  related_dispatch_id?: number | null;
  from_location_id?: number | null;
  to_location_id?: number | null;
}

@Injectable()
export class DispatchNoteEventsListener {
  private readonly logger = new Logger(DispatchNoteEventsListener.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly stockLevelManager: StockLevelManager,
    // Canonical delivery-commit path. Routes every remisión delivery through
    // the single OrderStockCommitService so stock deduction behaves identically
    // to order-flow / POS (fix stock fantasma + doble descuento standalone).
    // Required in DI — OrderStockCommitModule is imported by DispatchNotesModule.
    private readonly orderStockCommit: OrderStockCommitService,
    // QUI-431 — optional so the existing unit spec (2-arg construction) keeps
    // compiling/working: when absent (tests), the serial side-effects no-op.
    private readonly serials?: InventorySerialNumbersService,
    // Fase 4 — optional (mismo motivo que `serials`): cuando falta (tests) los
    // eventos contables `dispatch_note.accounting.*` simplemente no se emiten.
    // En producción lo inyecta el EventEmitterModule global. Los nombres de
    // evento contable son DISTINTOS de dispatch_note.delivered/received/voided
    // para NO re-disparar estos mismos handlers de stock (evita bucle).
    private readonly eventEmitter?: EventEmitter2,
    // Order-first receipt bridge: when a purchase_receipt remisión carries a
    // purchase_order_id, the `received` handler delegates the canonical
    // stock-in / FIFO / UoM / IVA / accounting to PurchaseOrdersService.receive()
    // instead of doing its own stock_in. Optional so the existing unit spec
    // (3-arg construction) keeps compiling; when absent the delegation is a
    // logged no-op (never a silent double stock-in).
    private readonly purchaseOrdersService?: PurchaseOrdersService,
    // QUI-498 — SINGLE reconciler for the order ↔ remisión lifecycle. Optional
    // for the same reason as `serials` / `eventEmitter` / `purchaseOrdersService`:
    // the existing unit spec constructs with 3 args, so when absent (tests) the
    // order-state reconciliation and COD balance clearing simply no-op. In
    // production Nest injects it (OrderFlowModule is imported by
    // DispatchNotesModule). It replaces the old direct `checkAndUpdateOrderStatus`
    // updateMany: reconcileOrderFromDispatch derives the order state from its
    // remisiones + balance (POST-COMMIT) and applyDispatchCodPayment clears a COD
    // balance idempotently.
    private readonly orderFlowService?: OrderFlowService,
  ) {}

  /**
   * Resuelve el organization_id del contexto de request; si falta (p.ej. un
   * re-disparo fuera de request), cae a leer store.organization_id. Devuelve
   * null cuando no hay forma de resolverlo (el emisor contable se omite).
   */
  private async resolveOrgId(store_id: number): Promise<number | null> {
    const fromCtx = RequestContextService.getOrganizationId();
    if (fromCtx) return fromCtx;
    try {
      const store = await this.prisma.withoutScope().stores.findUnique({
        where: { id: store_id },
        select: { organization_id: true },
      });
      return store?.organization_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * ORDER-FIRST receipt delegation. When a purchase_receipt remisión carries a
   * purchase_order_id, the received goods must flow through the SINGLE canonical
   * engine — PurchaseOrdersService.receive() — which owns stock-in, FIFO/CPP
   * costing, UoM conversion (purchase_to_stock_factor), IVA lifecycle and the
   * `purchase_order.received` accounting. We never call updateStock for this
   * path (that would double the stock-in).
   *
   * Idempotency: receive() stamps its stock-in movements with reason
   * 'Purchase order receipt' (no "remisión #N"), so the top-level
   * inventory_movements guard cannot catch a re-fire of THIS path. We dedupe on
   * purchase_order_receptions instead: every delegation writes the remisión ref
   * into the reception notes, and a re-fire finds that reception and skips.
   */
  private async delegatePurchaseReceiptToPurchaseOrder(
    dispatchNoteId: number,
    purchaseOrderId: number,
    items: Array<{
      product_id: number;
      product_variant_id: number | null;
      dispatched_quantity: number;
      // QUI-425 — per-line pricing overrides persisted on the dispatch_note_item.
      // Prisma returns Decimal columns as Prisma.Decimal (null when unset).
      new_base_price?: Prisma.Decimal | null;
      new_profit_margin?: Prisma.Decimal | null;
    }>,
    dispatchNumber: string,
  ): Promise<void> {
    if (!this.purchaseOrdersService) {
      this.logger.error(
        `[received] Dispatch note #${dispatchNumber}: PurchaseOrdersService not injected — cannot delegate PO-linked receipt (PO #${purchaseOrderId}). Skipping to avoid a wrong/duplicate stock-in.`,
      );
      return;
    }

    // Idempotency dedupe on purchase_order_receptions (see method doc).
    const receiptTag = `remisión #${dispatchNoteId}`;
    const existingReception = await this.prisma
      .withoutScope()
      .purchase_order_receptions.findFirst({
        where: {
          purchase_order_id: purchaseOrderId,
          notes: { contains: receiptTag },
        },
        select: { id: true },
      });
    if (existingReception) {
      this.logger.warn(
        `[received] Dispatch note #${dispatchNumber}: PO reception already exists for ${receiptTag} (reception #${existingReception.id}) — re-fire, skipping delegation`,
      );
      return;
    }

    // Re-derive each PO line id by matching product_id (+ variant) against the
    // PO's lines (the remisión does not persist a per-line PO reference).
    const poItems = await this.prisma
      .withoutScope()
      .purchase_order_items.findMany({
        where: { purchase_order_id: purchaseOrderId },
        select: { id: true, product_id: true, product_variant_id: true },
      });

    const receiveItems: Array<{
      id: number;
      quantity_received: number;
      new_base_price?: number;
      new_profit_margin?: number;
    }> = [];
    for (const item of items) {
      const poLine = poItems.find(
        (p) =>
          p.product_id === item.product_id &&
          (p.product_variant_id ?? null) === (item.product_variant_id ?? null),
      );
      if (!poLine) {
        this.logger.error(
          `[received] Dispatch note #${dispatchNumber}: product #${item.product_id} not found on PO #${purchaseOrderId} — line skipped`,
        );
        continue;
      }
      // dispatched_quantity is in PURCHASE units (same basis the direct receive
      // path uses); receive() applies purchase_to_stock_factor internally.
      const receiveItem: {
        id: number;
        quantity_received: number;
        new_base_price?: number;
        new_profit_margin?: number;
      } = {
        id: poLine.id,
        quantity_received: item.dispatched_quantity,
      };
      // QUI-425 — forward the operator's per-line price/margin override to
      // receive() ONLY when it was actually captured. Attaching the field
      // unconditionally would push receive() down its pricing path (recomputing
      // base_price/margin) even for plain receipts with no override, so we
      // replicate the frontend's "attach-only-if-defined" contract.
      if (item.new_base_price != null) {
        receiveItem.new_base_price = Number(item.new_base_price);
      }
      if (item.new_profit_margin != null) {
        receiveItem.new_profit_margin = Number(item.new_profit_margin);
      }
      receiveItems.push(receiveItem);
    }

    if (receiveItems.length === 0) {
      this.logger.error(
        `[received] Dispatch note #${dispatchNumber}: no PO lines resolved for PO #${purchaseOrderId} — nothing to receive`,
      );
      return;
    }

    await this.purchaseOrdersService.receive(purchaseOrderId, {
      items: receiveItems,
      // Stamp the remisión ref so the reception is deduped on re-fire (above)
      // and the PO reception history is traceable back to the remisión document.
      notes: `Recepción por ${receiptTag}`,
    });

    this.logger.log(
      `[received] Dispatch note #${dispatchNumber}: delegated ${receiveItems.length} line(s) to PurchaseOrdersService.receive(PO #${purchaseOrderId})`,
    );
  }

  // ─── CONFIRMED ──────────────────────────────────────────────
  @OnEvent('dispatch_note.confirmed')
  async handleConfirmed(event: DispatchNoteEvent) {
    try {
      const dispatch_note = await this.prisma.dispatch_notes.findFirst({
        where: { id: event.dispatch_note_id },
        include: {
          dispatch_note_items: true,
        },
      });

      if (!dispatch_note) {
        this.logger.warn(
          `[confirmed] Dispatch note #${event.dispatch_note_id} not found`,
        );
        return;
      }

      // Only reserve stock for OUTBOUND standalone dispatch notes (no sales
      // order and no order). When linked to a sales order OR an order, stock was
      // already reserved during that order's confirmation — reserving again here
      // would double-count. INBOUND subtypes (purchase_receipt, transfer_in,
      // customer_return) bring goods IN at `received`; reserving at confirm would
      // lock phantom stock at the destination that `handleReceived` never
      // releases. `!== 'inbound'` (not `=== 'outbound'`) so legacy rows with a
      // null direction still reserve as before.
      const isInbound = dispatch_note.direction === 'inbound';
      if (
        !isInbound &&
        !dispatch_note.sales_order_id &&
        !dispatch_note.order_id
      ) {
        for (const item of dispatch_note.dispatch_note_items) {
          const location_id =
            item.location_id || dispatch_note.dispatch_location_id;

          if (!location_id) continue;

          try {
            await this.stockLevelManager.reserveStock(
              item.product_id,
              item.product_variant_id ?? undefined,
              location_id,
              item.dispatched_quantity,
              'order',
              dispatch_note.id,
              undefined,
              false, // Don't validate availability — already confirmed by user
              undefined,
              null, // No expiration for dispatch reservations
            );
          } catch (err) {
            this.logger.error(
              `[confirmed] Failed to reserve stock for product ${item.product_id} on dispatch note #${event.dispatch_number}: ${err.message}`,
            );
          }
        }
      }

      this.logger.log(
        `[confirmed] Dispatch note #${event.dispatch_number} processed` +
          (dispatch_note.sales_order_id
            ? ` (linked to SO #${dispatch_note.sales_order_id})`
            : dispatch_note.order_id
              ? ` (linked to order #${dispatch_note.order_id})`
              : ' (standalone — stock reserved)'),
      );
    } catch (error) {
      this.logger.error(
        `[confirmed] Error processing dispatch note #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── DELIVERED ──────────────────────────────────────────────
  @OnEvent('dispatch_note.delivered')
  async handleDelivered(event: DispatchNoteEvent) {
    try {
      const dispatch_note = await this.prisma.dispatch_notes.findFirst({
        where: { id: event.dispatch_note_id },
        include: {
          dispatch_note_items: true,
        },
      });

      if (!dispatch_note) {
        this.logger.warn(
          `[delivered] Dispatch note #${event.dispatch_note_id} not found`,
        );
        return;
      }

      // ── Guard anti re-deducción ─────────────────────────────────────────
      // CONTRATO VERIFICADO: cuando este listener corre, la remisión YA quedó
      // status:'delivered' con delivered_at seteado. Tanto el flujo directo
      // (DispatchNoteFlowService.deliver) como la liquidación de ruta
      // (RouteFlowService.markDispatchNoteDeliveredInTx) persisten la
      // transición ANTES de emitir el evento — por eso delivered_at/status NO
      // distinguen un primer disparo de un re-disparo.
      //
      // Idempotencia real por caso:
      //  - Ligada a orden (order_id): el servicio canónico marca
      //    order_items.inventory_committed por línea → un re-disparo es no-op.
      //  - Standalone (sin orden ni SO): sus reservas se llavean por
      //    dispatch_note.id (único). Un commit previo las dejó 'consumed' sin
      //    ninguna 'active'; ese es el marcador de re-disparo para el caso que
      //    NO tiene order_items que marcar. Una remisión cuya reserva se
      //    liberó/canceló antes de entregar (caso stock fantasma) no deja
      //    filas 'consumed', así que igual deduce (el bug que este refactor
      //    corrige).
      if (!dispatch_note.sales_order_id && !dispatch_note.order_id) {
        const [active, consumed] = await Promise.all([
          this.prisma.withoutScope().stock_reservations.count({
            where: {
              reserved_for_type: 'order',
              reserved_for_id: dispatch_note.id,
              status: 'active',
            },
          }),
          this.prisma.withoutScope().stock_reservations.count({
            where: {
              reserved_for_type: 'order',
              reserved_for_id: dispatch_note.id,
              status: 'consumed',
            },
          }),
        ]);
        if (active === 0 && consumed > 0) {
          this.logger.warn(
            `[delivered] Remisión standalone #${event.dispatch_number}: reservas ya consumidas (active=0, consumed=${consumed}) — re-disparo, se omite la deducción para evitar doble descuento`,
          );
          return;
        }
      }

      // Deducción de stock unificada vía servicio canónico. blockOnInsufficient
      // FALSE: la mercancía ya salió físicamente, no se bloquea — el canónico
      // deduce con piso 0 y alerta el faltante (fix stock fantasma). Internamente
      // consume la reserva activa de la referencia (SO ?? order ?? note.id),
      // deduce una sola vez (movement_type stock_out), marca
      // order_items.inventory_committed cuando la remisión liga a una orden, y su
      // barrido defensivo libera residuales con decrementOnHand:false (fix doble
      // descuento standalone). consumeSerials FALSE: el ciclo de vida de seriales
      // de la remisión lo maneja markDispatchSerialsSold más abajo.
      //
      // NOTA transfer_out: para transfer_out, commitDispatchDelivery deduce
      // stock_out del origen (movement_type stock_out). El +destino lo hace el
      // listener handleReceived cuando la transfer_in llega a 'received'. NO
      // hay doble deducción: commitDispatchDelivery usa el order_id/note.id como
      // referencia, y el transfer_in usa el dispatch_note.id de la transfer_in
      // (una remisión distinta). Para transfers standalone (sin order_id), el
      // guard anti-doble-deducción de stock_reservations arriba aplica.
      const userId = RequestContextService.getUserId();
      const res = await this.orderStockCommit.commitDispatchDelivery(
        dispatch_note,
        {
          movementType: 'stock_out',
          blockOnInsufficient: false,
          consumeSerials: false,
          reason: `Despacho remisión #${dispatch_note.id}`,
          userId: userId ?? undefined,
        },
      );

      // Sincronización de estado del documento padre (idempotente). El servicio
      // canónico ya liberó/consumió las reservas; aquí sólo avanzamos el estado
      // del documento padre. La rama sales_order CONSERVA
      // checkAndUpdateSalesOrderStatus intacta. La rama `orders` (QUI-498) ahora
      // delega en el reconciliador único (reconcileOrderFromDispatch), que corre
      // DESPUÉS de commitDispatchDelivery (arriba) para garantizar el orden
      // stock_out → order.status_changed (nunca `finished` sin haber deducido
      // stock). Best-effort: el reconciliador ya traga sus propios errores.
      if (dispatch_note.sales_order_id) {
        try {
          await this.checkAndUpdateSalesOrderStatus(
            dispatch_note.sales_order_id,
            'shipped',
          );
        } catch (err) {
          this.logger.error(
            `[delivered] Failed to update sales order #${dispatch_note.sales_order_id}: ${err.message}`,
          );
        }
      } else if (dispatch_note.order_id && this.orderFlowService) {
        try {
          await this.orderFlowService.reconcileOrderFromDispatch(
            dispatch_note.order_id,
            dispatch_note.store_id,
          );
        } catch (err) {
          this.logger.error(
            `[delivered] Failed to reconcile order #${dispatch_note.order_id}: ${err.message}`,
          );
        }
      }

      // QUI-431 — serial lifecycle: the serials reserved + linked at confirm
      // are now sold. Transition reserved → sold for every serial linked to
      // this remisión's items. Idempotent (transition is a no-op when already
      // in the target status) and isolated: a serial failure never blocks the
      // stock flow above (already committed).
      await this.markDispatchSerialsSold(
        dispatch_note.dispatch_note_items.map((i) => i.id),
        event.dispatch_number,
      );

      // Fase 4 — COGS contable para customer_delivery, tanto STANDALONE como
      // ligada a una orden (order_id). BUG-2: antes se excluían las remisiones
      // con order_id asumiendo que ya reconocían COGS vía `order.completed`; esa
      // asunción es FALSA en el camino de despacho. El stock se deduce AQUÍ
      // (commitDispatchDelivery), así que cuando la orden luego llega a
      // `finished`, commitOrderDelivery encuentra las líneas ya commiteadas y
      // devuelve totalCost=0 → `order.completed` NO postea COGS. Resultado: sin
      // este gate el COGS de un pedido COD despachado nunca se contabilizaba.
      // Por eso se reconoce aquí con el costo REAL devuelto por
      // commitDispatchDelivery (iguala el movimiento de inventario). Se siguen
      // excluyendo: las ligadas a un sales_order (SO), cuyo ciclo contable es
      // propio, y los traslados (transfer_out) que NO son venta → sin COGS.
      if (
        dispatch_note.subtype === 'customer_delivery' &&
        !dispatch_note.sales_order_id &&
        Number(res.totalCost) > 0
      ) {
        const organization_id = await this.resolveOrgId(dispatch_note.store_id);
        if (organization_id && this.eventEmitter) {
          this.eventEmitter.emit('dispatch_note.accounting.cogs', {
            dispatch_note_id: dispatch_note.id,
            dispatch_number: dispatch_note.dispatch_number,
            organization_id,
            store_id: dispatch_note.store_id,
            total_cost: Number(res.totalCost),
            user_id: userId ?? undefined,
          });
        }
      }

      this.logger.log(
        `[delivered] Dispatch note #${event.dispatch_number} processed — ${res.committedItemCount} item(s) deducted (stock_out)`,
      );
    } catch (error) {
      this.logger.error(
        `[delivered] Error processing dispatch note #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── VOIDED ─────────────────────────────────────────────────
  @OnEvent('dispatch_note.voided')
  async handleVoided(event: DispatchNoteVoidedEvent) {
    try {
      const dispatch_note = await this.prisma.dispatch_notes.findFirst({
        where: { id: event.dispatch_note_id },
        include: {
          dispatch_note_items: true,
        },
      });

      if (!dispatch_note) {
        this.logger.warn(
          `[voided] Dispatch note #${event.dispatch_note_id} not found`,
        );
        return;
      }

      // Dos ramas mutuamente excluyentes por el sello temporal:
      //  - was_confirmed (confirmada, NO entregada): sólo libera reservas +
      //    devuelve seriales (aún no hubo movimiento de stock que revertir).
      //  - delivered_at != null (ya materializada): reversión completa de stock
      //    (Fase 2). Desde Fase 2 `delivered→voided` y `received→voided` SON
      //    transiciones válidas (ver dispatch-note-flow.service.ts).
      const was_confirmed =
        dispatch_note.confirmed_at != null &&
        dispatch_note.delivered_at == null;

      if (was_confirmed) {
        if (!dispatch_note.sales_order_id && !dispatch_note.order_id) {
          // Standalone dispatch: cancel the reservations we made on confirm
          try {
            await this.stockLevelManager.releaseReservationsByReference(
              'order',
              dispatch_note.id,
              'cancelled',
            );
          } catch (err) {
            this.logger.error(
              `[voided] Failed to release reservations for dispatch note #${event.dispatch_number}: ${err.message}`,
            );
          }
        }
        // If linked to a sales order OR an order, we do NOT release their
        // reservations — they belong to that order's own lifecycle.

        // QUI-431 — serial lifecycle: revert the serials reserved at confirm
        // back to in_stock and unlink them, so they rejoin the sellable pool
        // and can be dispatched again. Runs for ALL voided-while-confirmed
        // notes (standalone or order-linked): the serial reservation + junction
        // link belong to THIS remisión regardless of how the stock reservation
        // is owned.
        await this.revertDispatchSerialsToStock(
          dispatch_note.dispatch_note_items.map((i) => i.id),
          event.dispatch_number,
        );
      }

      if (dispatch_note.delivered_at != null) {
        // Fase 2 (P0): la remisión ya se materializó (outbound entregada o
        // inbound recibida — `receive()` reutiliza delivered_at como sello de
        // recepción). Anularla revierte el movimiento de stock de forma
        // simétrica, devuelve los seriales al pool y libera el flag
        // inventory_committed de la orden ligada.
        await this.reverseStockOnVoid(dispatch_note, event.dispatch_number);

        // Seriales: sold/reserved → in_stock + desvincular (funciona desde
        // cualquier estado de origen). Cubre el caso post-entrega que la rama
        // was_confirmed no alcanza (delivered_at != null).
        await this.revertDispatchSerialsToStock(
          dispatch_note.dispatch_note_items.map((i) => i.id),
          event.dispatch_number,
        );

        // Liberar inventory_committed sólo para remisiones outbound ligadas a
        // una orden (el claim atómico lo puso commitDispatchDelivery). Así la
        // orden puede volver a despacharse tras la anulación.
        if (
          dispatch_note.direction === 'outbound' &&
          dispatch_note.order_id
        ) {
          await this.releaseCommittedOrderItems(dispatch_note);
        }
      }

      this.logger.log(
        `[voided] Dispatch note #${event.dispatch_number} processed — reason: ${event.void_reason}`,
      );
    } catch (error) {
      this.logger.error(
        `[voided] Error processing dispatch note #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── RECEIVED (inbound) ─────────────────────────────────────
  @OnEvent('dispatch_note.received')
  async handleReceived(event: DispatchNoteReceivedEvent) {
    try {
      const dispatch_note = await this.prisma.dispatch_notes.findFirst({
        where: { id: event.dispatch_note_id },
        include: {
          dispatch_note_items: true,
        },
      });

      if (!dispatch_note) {
        this.logger.warn(
          `[received] Dispatch note #${event.dispatch_note_id} not found`,
        );
        return;
      }

      // Guard anti doble-deducción: check whether we already processed this
      // dispatch note by looking for an inventory_movements row whose notes
      // contain the dispatch note id. The StockLevelManager persists the
      // `reason` string (which includes "remisión #N") into both
      // inventory_movements.reason and inventory_movements.notes, so a match
      // means stock was already moved.
      const existingMovement =
        await this.prisma.withoutScope().inventory_movements.findFirst({
          where: {
            notes: { contains: `remisión #${dispatch_note.id}` },
          },
          select: { id: true },
        });
      if (existingMovement) {
        this.logger.warn(
          `[received] Dispatch note #${event.dispatch_number}: stock already moved (inventory_movement exists) — re-fire, skipping`,
        );
        return;
      }

      const userId = RequestContextService.getUserId();

      // Determine the destination location for the stock-in movement.
      // Priority: to_location_id (set on the note) → item.location_id →
      // dispatch_location_id.
      const resolveLocationId = (
        item: { location_id: number | null },
      ): number | null =>
        dispatch_note.to_location_id ??
        item.location_id ??
        dispatch_note.dispatch_location_id ??
        null;

      // Branch by subtype — each does a different StockLevelManager movement.
      const subtype = dispatch_note.subtype;
      this.logger.log(
        `[received] Processing dispatch note #${event.dispatch_number} — subtype: ${subtype}`,
      );

      // Fase 4 — costo real acumulado de la entrada (suma de cost_snapshot de
      // cada updateStock). Alimenta el asiento contable para que el valor del
      // asiento iguale exactamente el movimiento de inventario.
      let receivedCost = 0;

      if (subtype === 'purchase_receipt') {
        if (dispatch_note.purchase_order_id != null) {
          // ORDER-FIRST: delegate the canonical stock-in / FIFO / UoM / IVA /
          // accounting to PurchaseOrdersService.receive(). This is the SINGLE
          // stock-in path for PO-linked receipts — we do NOT call updateStock
          // here (that would double-count). receive() also emits
          // `purchase_order.received`, which drives the DR 1435 / CR 2205
          // accounting, so the dispatch_note.accounting.received emit below is
          // intentionally skipped (receivedCost stays 0 for this path).
          await this.delegatePurchaseReceiptToPurchaseOrder(
            dispatch_note.id,
            dispatch_note.purchase_order_id,
            dispatch_note.dispatch_note_items,
            event.dispatch_number,
          );
        } else {
          // Standalone purchase receipt (no PO). Stock-in with
          // movement_unit_cost = item unit_price.
          for (const item of dispatch_note.dispatch_note_items) {
            const location_id = resolveLocationId(item);
            if (!location_id) continue;

            try {
              const r = await this.stockLevelManager.updateStock({
                product_id: item.product_id,
                variant_id: item.product_variant_id ?? undefined,
                location_id,
                quantity_change: item.dispatched_quantity,
                movement_type: 'stock_in',
                reason: `Purchase receipt remisión #${dispatch_note.id}`,
                user_id: userId ?? undefined,
                movement_unit_cost: Number(item.unit_price) || undefined,
                create_movement: true,
              });
              receivedCost += Number(r.cost_snapshot?.total_cost || 0);
            } catch (err) {
              this.logger.error(
                `[received] Failed to stock_in for product ${item.product_id} on dispatch note #${event.dispatch_number}: ${err.message}`,
              );
            }
          }
        }
      } else if (subtype === 'transfer_in') {
        // Transfer-in: add stock at the destination location. The -origen was
        // already done by the transfer_out's `delivered` event. We use
        // movement_type 'transfer' with a positive quantity_change.
        for (const item of dispatch_note.dispatch_note_items) {
          const location_id = resolveLocationId(item);
          if (!location_id) continue;

          try {
            await this.stockLevelManager.updateStock({
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id,
              quantity_change: item.dispatched_quantity,
              movement_type: 'transfer',
              reason: `Transfer-in remisión #${dispatch_note.id}`,
              user_id: userId ?? undefined,
              from_location_id: dispatch_note.from_location_id ?? undefined,
              to_location_id: location_id,
              create_movement: true,
            });
          } catch (err) {
            this.logger.error(
              `[received] Failed to transfer-in for product ${item.product_id} on dispatch note #${event.dispatch_number}: ${err.message}`,
            );
          }
        }
      } else if (subtype === 'customer_return') {
        // Customer return: restock with movement_type 'return' (positive).
        for (const item of dispatch_note.dispatch_note_items) {
          const location_id = resolveLocationId(item);
          if (!location_id) continue;

          try {
            const r = await this.stockLevelManager.updateStock({
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id,
              quantity_change: item.dispatched_quantity,
              movement_type: 'return',
              reason: `Customer return remisión #${dispatch_note.id}`,
              user_id: userId ?? undefined,
              create_movement: true,
            });
            receivedCost += Number(r.cost_snapshot?.total_cost || 0);
          } catch (err) {
            this.logger.error(
              `[received] Failed to restock return for product ${item.product_id} on dispatch note #${event.dispatch_number}: ${err.message}`,
            );
          }
        }
      } else {
        this.logger.warn(
          `[received] Dispatch note #${event.dispatch_number}: unhandled subtype '${subtype}' — no stock movement`,
        );
      }

      // Fase 4 — asiento contable de entrada SOLO para purchase_receipt
      // (DR inventario / CR proveedores) y customer_return (DR inventario /
      // CR reversa COGS). transfer_in se DIFIERE (requiere cuenta de tránsito
      // para balancear entre las dos notas separadas — gap documentado).
      if (
        (subtype === 'purchase_receipt' || subtype === 'customer_return') &&
        receivedCost > 0
      ) {
        const organization_id = await this.resolveOrgId(dispatch_note.store_id);
        if (organization_id && this.eventEmitter) {
          // Snapshot de proveedor para la línea CxP (purchase_receipt). Se
          // adjunta en el payload — PROHIBIDO resolverlo en AutoEntryService.
          let supplier:
            | { id: number; name?: string; tax_id?: string }
            | undefined;
          if (subtype === 'purchase_receipt' && dispatch_note.supplier_id) {
            try {
              const s = await this.prisma.withoutScope().suppliers.findUnique({
                where: { id: dispatch_note.supplier_id },
                select: { id: true, name: true, tax_id: true },
              });
              if (s) {
                supplier = {
                  id: s.id,
                  name: s.name ?? undefined,
                  tax_id: s.tax_id ?? undefined,
                };
              }
            } catch {
              // Snapshot best-effort: si falla, la línea CxP se postea sin
              // tercero (sin regresión — third_party es opcional).
            }
          }

          this.eventEmitter.emit('dispatch_note.accounting.received', {
            dispatch_note_id: dispatch_note.id,
            dispatch_number: dispatch_note.dispatch_number,
            organization_id,
            store_id: dispatch_note.store_id,
            subtype,
            total_cost: receivedCost,
            user_id: userId ?? undefined,
            supplier,
          });
        }
      }

      this.logger.log(
        `[received] Dispatch note #${event.dispatch_number} processed — subtype: ${subtype}`,
      );
    } catch (error) {
      this.logger.error(
        `[received] Error processing dispatch note #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── INVOICED ───────────────────────────────────────────────
  @OnEvent('dispatch_note.invoiced')
  async handleInvoiced(event: DispatchNoteEvent) {
    try {
      const dispatch_note = await this.prisma.dispatch_notes.findFirst({
        where: { id: event.dispatch_note_id },
        select: {
          id: true,
          sales_order_id: true,
          order_id: true,
          dispatch_number: true,
        },
      });

      if (!dispatch_note) {
        this.logger.warn(
          `[invoiced] Dispatch note #${event.dispatch_note_id} not found`,
        );
        return;
      }

      if (dispatch_note.sales_order_id) {
        try {
          // Check if ALL dispatch notes for this SO are now invoiced
          await this.checkAndUpdateSalesOrderStatus(
            dispatch_note.sales_order_id,
            'invoiced',
          );
        } catch (err) {
          this.logger.error(
            `[invoiced] Failed to update sales order #${dispatch_note.sales_order_id}: ${err.message}`,
          );
        }
      } else if (dispatch_note.order_id && this.orderFlowService) {
        // QUI-498 — COD order settled at invoice time (standalone remisión):
        //  (a) if the order still carries a balance, clear it idempotently via
        //      the shared helper with the standalone correlation key
        //      `dispatch_note:{id}` (route flow uses `dispatch_route_stop:{id}`);
        //  (b) reconcile the order state from its remisiones + (now-zero)
        //      balance → typically advancing it to `finished`.
        // Best-effort: both helpers already swallow their own errors, but the
        // try/catch keeps a settlement glitch from ever tumbling the listener.
        const store_id = event.store_id;
        try {
          const order = await this.prisma.orders.findFirst({
            where: { id: dispatch_note.order_id, store_id },
            select: { remaining_balance: true },
          });
          const remaining = Number(order?.remaining_balance ?? 0);
          if (remaining > 0) {
            await this.orderFlowService.applyDispatchCodPayment({
              storeId: store_id,
              dispatchNoteId: dispatch_note.id,
              amount: remaining,
              correlationKey: `dispatch_note:${dispatch_note.id}`,
            });
          }
          await this.orderFlowService.reconcileOrderFromDispatch(
            dispatch_note.order_id,
            store_id,
          );
        } catch (err) {
          this.logger.error(
            `[invoiced] Failed to settle/reconcile order #${dispatch_note.order_id}: ${err.message}`,
          );
        }
      }

      this.logger.log(
        `[invoiced] Dispatch note #${event.dispatch_number} processed`,
      );
    } catch (error) {
      this.logger.error(
        `[invoiced] Error processing dispatch note #${event.dispatch_note_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── HELPERS ────────────────────────────────────────────────

  /**
   * Checks whether ALL dispatch notes for a sales order meet the target status,
   * and if so, updates the sales order status accordingly.
   */
  private async checkAndUpdateSalesOrderStatus(
    sales_order_id: number,
    target_status: 'shipped' | 'invoiced',
  ): Promise<void> {
    const sales_order = await this.prisma.sales_orders.findFirst({
      where: { id: sales_order_id },
      include: {
        sales_order_items: true,
        dispatch_notes: {
          where: { status: { not: 'voided' } },
          include: { dispatch_note_items: true },
        },
      },
    });

    if (!sales_order) {
      this.logger.warn(
        `[checkSOStatus] Sales order #${sales_order_id} not found`,
      );
      return;
    }

    if (target_status === 'shipped') {
      // Check if all SO items have been fully dispatched (delivered)
      const delivered_notes = sales_order.dispatch_notes.filter(
        (dn) => dn.status === 'delivered' || dn.status === 'invoiced',
      );

      // Build a map of total dispatched quantities per SO item
      const dispatched_by_so_item = new Map<number, number>();
      for (const dn of delivered_notes) {
        for (const item of dn.dispatch_note_items) {
          if (item.sales_order_item_id) {
            const current =
              dispatched_by_so_item.get(item.sales_order_item_id) || 0;
            dispatched_by_so_item.set(
              item.sales_order_item_id,
              current + item.dispatched_quantity,
            );
          }
        }
      }

      // Verify all SO items are fully dispatched
      const all_shipped = sales_order.sales_order_items.every((so_item) => {
        const dispatched = dispatched_by_so_item.get(so_item.id) || 0;
        return dispatched >= so_item.quantity;
      });

      if (all_shipped && sales_order.status === 'confirmed') {
        await this.prisma.sales_orders.update({
          where: { id: sales_order_id },
          data: {
            status: 'shipped',
            updated_at: new Date(),
          },
        });

        this.logger.log(
          `[checkSOStatus] Sales order #${sales_order_id} marked as shipped`,
        );
      }
    }

    if (target_status === 'invoiced') {
      // Check if ALL non-voided dispatch notes are invoiced
      const non_voided_notes = sales_order.dispatch_notes;
      const all_invoiced =
        non_voided_notes.length > 0 &&
        non_voided_notes.every((dn) => dn.status === 'invoiced');

      if (
        all_invoiced &&
        (sales_order.status === 'shipped' || sales_order.status === 'confirmed')
      ) {
        await this.prisma.sales_orders.update({
          where: { id: sales_order_id },
          data: {
            status: 'invoiced',
            updated_at: new Date(),
          },
        });

        this.logger.log(
          `[checkSOStatus] Sales order #${sales_order_id} marked as invoiced`,
        );
      }
    }
  }

  // ─── REVERSIÓN AL ANULAR (Fase 2) ───────────────────────────

  /**
   * Reversión de stock al anular una remisión ya materializada
   * (outbound entregada / inbound recibida). Simétrica al movimiento original:
   *
   *   outbound customer_delivery : stock_out -qty  →  return   +qty (reingreso vendible)
   *   outbound transfer_out      : stock_out -qty  →  transfer +qty (reingreso al origen)
   *   inbound  purchase_receipt  : stock_in  +qty  →  stock_out -qty
   *   inbound  transfer_in       : transfer  +qty  →  transfer -qty (destino)
   *   inbound  customer_return   : return    +qty  →  stock_out -qty
   *
   * Idempotente: si ya existe un movimiento de reversa para esta remisión
   * (`notes` contiene `VOID-REV #{id}`) no hace nada.
   *
   * Precondición: sólo revierte si EXISTE el movimiento original que ESTE
   * listener creó (`Despacho remisión #{id}` para outbound, `remisión #{id}`
   * para inbound). Evita reversar recepciones delegadas a PurchaseOrdersService
   * (que llevan otra glosa) o líneas de servicio que nunca movieron stock —
   * disparar un stock_out sin entrada previa corrompería el inventario.
   *
   * Aislado: los fallos por línea se loguean, nunca re-lanzan (el estado del
   * documento ya es `voided`).
   */
  private async reverseStockOnVoid(
    dispatch_note: any,
    dispatch_number: string,
  ): Promise<void> {
    const id: number = dispatch_note.id;
    const direction: string = dispatch_note.direction;
    const subtype: string = dispatch_note.subtype;
    const userId = RequestContextService.getUserId();

    // Idempotencia: ¿ya se revirtió? Token con delimitadores `[VOID-REV#N]`
    // para evitar colisión de substring (`#1` vs `#12`) — un falso positivo
    // aquí saltaría la reversa y perdería el reingreso/salida de stock.
    const alreadyReversed = await this.prisma
      .withoutScope()
      .inventory_movements.findFirst({
        where: { notes: { contains: `[VOID-REV#${id}]` } },
        select: { id: true },
      });
    if (alreadyReversed) {
      this.logger.warn(
        `[voided] Remisión #${dispatch_number}: reversa ya aplicada (VOID-REV existe) — se omite`,
      );
      return;
    }

    // Precondición: el movimiento original debe existir (lo creó este listener).
    const originalMarker =
      direction === 'outbound'
        ? `Despacho remisión #${id}`
        : `remisión #${id}`;
    const originalMovement = await this.prisma
      .withoutScope()
      .inventory_movements.findFirst({
        where: { notes: { contains: originalMarker } },
        select: { id: true },
      });
    if (!originalMovement) {
      this.logger.warn(
        `[voided] Remisión #${dispatch_number}: sin movimiento original (${originalMarker}) — ` +
          `stock no movido por este listener (recepción delegada a PO o líneas de servicio); no se revierte stock`,
      );
      return;
    }

    const reason = `Reversa anulación [VOID-REV#${id}]`;

    // Resolutor de ubicación por dirección (mirror de handleDelivered /
    // handleReceived).
    const resolveLoc = (item: { location_id: number | null }): number | null =>
      direction === 'outbound'
        ? item.location_id ?? dispatch_note.dispatch_location_id ?? null
        : dispatch_note.to_location_id ??
          item.location_id ??
          dispatch_note.dispatch_location_id ??
          null;

    let reversedLines = 0;
    let reversedCost = 0;
    for (const item of dispatch_note.dispatch_note_items) {
      const location_id = resolveLoc(item);
      if (!location_id) continue;
      const qty = item.dispatched_quantity;
      if (!qty || qty <= 0) continue;

      // Construir el movimiento de reversa por caso.
      let params: UpdateStockParams;
      if (direction === 'outbound') {
        // Reingreso a la ubicación desde donde salió (+qty).
        if (subtype === 'transfer_out') {
          params = {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id,
            quantity_change: qty,
            movement_type: 'transfer',
            reason,
            user_id: userId ?? undefined,
            from_location_id: dispatch_note.to_location_id ?? undefined,
            to_location_id: location_id,
            create_movement: true,
          };
        } else {
          // customer_delivery → reingreso vendible.
          params = {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id,
            quantity_change: qty,
            movement_type: 'return',
            reason,
            user_id: userId ?? undefined,
            create_movement: true,
          };
        }
      } else {
        // inbound → salida que reversa la entrada (-qty).
        if (subtype === 'transfer_in') {
          params = {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id,
            quantity_change: -qty,
            movement_type: 'transfer',
            reason,
            user_id: userId ?? undefined,
            from_location_id: location_id,
            to_location_id: dispatch_note.from_location_id ?? undefined,
            create_movement: true,
          };
        } else {
          // purchase_receipt / customer_return → stock_out.
          params = {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id,
            quantity_change: -qty,
            movement_type: 'stock_out',
            reason,
            user_id: userId ?? undefined,
            create_movement: true,
          };
        }
      }

      try {
        const r = await this.stockLevelManager.updateStock(params);
        reversedCost += Number(r.cost_snapshot?.total_cost || 0);
        reversedLines++;
      } catch (err: any) {
        this.logger.error(
          `[voided] Falló reversa de stock para producto ${item.product_id} en remisión #${dispatch_number}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `[voided] Remisión #${dispatch_number}: stock revertido (${direction}/${subtype}) — ${reversedLines} línea(s)`,
    );

    // Fase 4 — reversa CONTABLE de la anulación. Sólo para los casos cuyo
    // asiento original posteó ESTE módulo (mismos gates que cogs/received):
    //  - outbound customer_delivery (STANDALONE o ligada a una orden): BUG-2 —
    //    ambas postean COGS en dispatch_note.delivered, así que anular DEBE
    //    reversarlo (dispatch_note.void) para mantener el libro balanceado.
    //  - inbound purchase_receipt / customer_return (posteó dispatch_note.received)
    // Los traslados y las remisiones ligadas a un sales_order (SO) NO postearon
    // asiento propio en este módulo → no se reversa contablemente (su
    // contabilidad la maneja su propio ciclo / no existe).
    const shouldReverseAccounting =
      (direction === 'outbound' &&
        subtype === 'customer_delivery' &&
        !dispatch_note.sales_order_id) ||
      (direction === 'inbound' &&
        (subtype === 'purchase_receipt' || subtype === 'customer_return'));

    if (shouldReverseAccounting && reversedCost > 0) {
      const organization_id = await this.resolveOrgId(dispatch_note.store_id);
      if (organization_id && this.eventEmitter) {
        let supplier:
          | { id: number; name?: string; tax_id?: string }
          | undefined;
        if (subtype === 'purchase_receipt' && dispatch_note.supplier_id) {
          try {
            const s = await this.prisma.withoutScope().suppliers.findUnique({
              where: { id: dispatch_note.supplier_id },
              select: { id: true, name: true, tax_id: true },
            });
            if (s) {
              supplier = {
                id: s.id,
                name: s.name ?? undefined,
                tax_id: s.tax_id ?? undefined,
              };
            }
          } catch {
            // best-effort (ver handleReceived)
          }
        }

        this.eventEmitter.emit('dispatch_note.accounting.void', {
          dispatch_note_id: id,
          dispatch_number,
          organization_id,
          store_id: dispatch_note.store_id,
          direction,
          subtype,
          total_cost: reversedCost,
          user_id: userId ?? undefined,
          supplier,
        });
      }
    }
  }

  /**
   * Libera el flag `inventory_committed` de los `order_items` de la orden
   * ligada, invirtiendo el claim atómico que hizo `commitDispatchDelivery` al
   * entregar. Usa un match claim-once (producto + variante) para liberar UN
   * order_item por línea de la remisión, evitando liberar de más cuando la
   * orden tiene varias líneas del mismo producto. Aislado: los fallos se
   * loguean, no re-lanzan.
   */
  private async releaseCommittedOrderItems(dispatch_note: any): Promise<void> {
    if (!dispatch_note.order_id) return;
    try {
      const order = await this.prisma.orders.findFirst({
        where: { id: dispatch_note.order_id },
        include: {
          order_items: {
            select: {
              id: true,
              product_id: true,
              product_variant_id: true,
              inventory_committed: true,
            },
          },
        },
      });
      if (!order) return;

      // Claim-once inverso: por cada línea de la remisión libera un order_item
      // committed que haga match por producto + variante.
      const available = (order.order_items ?? []).filter(
        (oi) => oi.inventory_committed,
      );
      const toRelease: number[] = [];
      for (const line of dispatch_note.dispatch_note_items) {
        const idx = available.findIndex(
          (oi) =>
            oi.product_id === line.product_id &&
            (oi.product_variant_id ?? null) ===
              (line.product_variant_id ?? null),
        );
        if (idx >= 0) {
          toRelease.push(available[idx].id);
          available.splice(idx, 1);
        }
      }
      if (toRelease.length === 0) return;

      await this.prisma.order_items.updateMany({
        where: { id: { in: toRelease }, inventory_committed: true },
        data: { inventory_committed: false, inventory_committed_at: null },
      });

      this.logger.log(
        `[voided] Remisión #${dispatch_note.dispatch_number}: ${toRelease.length} order_item(s) liberados (inventory_committed=false)`,
      );
    } catch (err: any) {
      this.logger.error(
        `[voided] Falló liberar inventory_committed para remisión #${dispatch_note.dispatch_number}: ${err.message}`,
      );
    }
  }

  // ─── SERIAL LIFECYCLE (QUI-431) ─────────────────────────────

  /**
   * Load the serial pool ids linked to a set of dispatch_note_items via the
   * polymorphic junction `sales_document_serials`
   * (document_item_type = 'dispatch_note_item'). Returns [] when no serials are
   * linked (the common case: no serialized goods on the remisión).
   */
  private async getLinkedDispatchSerialIds(
    dispatch_note_item_ids: number[],
  ): Promise<number[]> {
    if (dispatch_note_item_ids.length === 0) return [];
    const links = await this.prisma.sales_document_serials.findMany({
      where: {
        document_item_type: sales_document_item_type_enum.dispatch_note_item,
        document_item_id: { in: dispatch_note_item_ids },
      },
      select: { serial_number_id: true },
    });
    return links.map((l) => l.serial_number_id);
  }

  /**
   * deliver: transition every serial linked to this remisión reserved → sold.
   * All transitions share ONE $transaction so the serial states move
   * atomically; `transition()` no-ops when a serial is already `sold` (so a
   * re-fired delivered event is safe). Isolated from the stock flow: failures
   * are logged, never re-thrown (the stock side is already committed).
   */
  private async markDispatchSerialsSold(
    dispatch_note_item_ids: number[],
    dispatch_number: string,
  ): Promise<void> {
    if (!this.serials) return; // unit-test construction (no serial service)
    try {
      const serialIds = await this.getLinkedDispatchSerialIds(
        dispatch_note_item_ids,
      );
      if (serialIds.length === 0) return;

      await this.prisma.$transaction(async (tx) => {
        for (const serial_id of serialIds) {
          await this.serials!.transition(
            serial_id,
            serial_status_enum.sold,
            tx,
          );
        }
      });

      this.logger.log(
        `[delivered] Dispatch note #${dispatch_number}: ${serialIds.length} serial(s) marked sold`,
      );
    } catch (err: any) {
      this.logger.error(
        `[delivered] Failed to transition serials to sold for dispatch note #${dispatch_number}: ${err.message}`,
      );
    }
  }

  /**
   * void: transition every serial linked to this remisión reserved → in_stock
   * and unlink it (delete the junction row) so it rejoins the sellable pool and
   * can be re-dispatched. All in ONE $transaction. Isolated: failures logged,
   * never re-thrown.
   */
  private async revertDispatchSerialsToStock(
    dispatch_note_item_ids: number[],
    dispatch_number: string,
  ): Promise<void> {
    if (!this.serials) return; // unit-test construction (no serial service)
    try {
      const serialIds = await this.getLinkedDispatchSerialIds(
        dispatch_note_item_ids,
      );
      if (serialIds.length === 0) return;

      await this.prisma.$transaction(async (tx) => {
        for (const serial_id of serialIds) {
          await this.serials!.transition(
            serial_id,
            serial_status_enum.in_stock,
            tx,
          );
        }
        // Unlink: delete the junction rows for these dispatch lines so the
        // serial is free to be linked to a future remisión (the
        // @@unique([document_item_type, serial_number_id]) guard otherwise
        // blocks re-dispatch).
        await tx.sales_document_serials.deleteMany({
          where: {
            document_item_type:
              sales_document_item_type_enum.dispatch_note_item,
            document_item_id: { in: dispatch_note_item_ids },
          },
        });
      });

      this.logger.log(
        `[voided] Dispatch note #${dispatch_number}: ${serialIds.length} serial(s) reverted to in_stock and unlinked`,
      );
    } catch (err: any) {
      this.logger.error(
        `[voided] Failed to revert serials for dispatch note #${dispatch_number}: ${err.message}`,
      );
    }
  }
}
