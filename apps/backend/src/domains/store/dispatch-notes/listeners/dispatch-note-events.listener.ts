import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  serial_status_enum,
  sales_document_item_type_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { OrderStockCommitService } from '../../inventory/shared/services/order-stock-commit.service';
import { InventorySerialNumbersService } from '../../inventory/serial-numbers/inventory-serial-numbers.service';

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
  ) {}

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

      // Only reserve stock for standalone dispatch notes (no sales order and
      // no order). When linked to a sales order OR an order, stock was already
      // reserved during that order's confirmation — reserving again here would
      // double-count the reservation.
      if (!dispatch_note.sales_order_id && !dispatch_note.order_id) {
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
      // de la orden / sales order cuando todas sus líneas quedaron despachadas.
      // CONSERVADO: checkAndUpdateSalesOrderStatus / checkAndUpdateOrderStatus.
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
      } else if (dispatch_note.order_id) {
        try {
          await this.checkAndUpdateOrderStatus(
            dispatch_note.order_id,
            'shipped',
          );
        } catch (err) {
          this.logger.error(
            `[delivered] Failed to update order #${dispatch_note.order_id}: ${err.message}`,
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

      // Only release reservations if the dispatch was confirmed but NOT delivered.
      // Per the state machine: delivered -> voided is NOT a valid transition,
      // but we add a safety check.
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
        // Safety: delivered dispatch notes should not be voidable per state machine.
        // If this somehow runs, log a critical warning.
        this.logger.warn(
          `[voided] CRITICAL: Dispatch note #${event.dispatch_number} was voided after delivery. ` +
            `Stock was already deducted and will NOT be automatically reversed. Manual intervention required.`,
        );
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

  // ─── INVOICED ───────────────────────────────────────────────
  @OnEvent('dispatch_note.invoiced')
  async handleInvoiced(event: DispatchNoteEvent) {
    try {
      const dispatch_note = await this.prisma.dispatch_notes.findFirst({
        where: { id: event.dispatch_note_id },
        select: {
          id: true,
          sales_order_id: true,
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

  /**
   * Order ⇄ dispatch-note bridge. Mirrors {@link checkAndUpdateSalesOrderStatus}
   * for the `orders` table. When every non-voided dispatch note linked to the
   * order has been delivered, advances the order `processing -> shipped`.
   *
   * It writes `orders.state` directly (instead of calling OrderFlowService) so
   * it stays idempotent and never re-fires order-flow side effects (shipping
   * validations, `order.shipped` auto-fulfillment, etc.). The guard
   * `state === 'processing'` makes late/duplicate events a no-op, and the
   * `processing -> shipped` transition is valid in the order state machine.
   */
  private async checkAndUpdateOrderStatus(
    order_id: number,
    target_status: 'shipped',
  ): Promise<void> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      include: {
        dispatch_notes: {
          where: { status: { not: 'voided' } },
          select: { id: true, status: true },
        },
      },
    });

    if (!order) {
      this.logger.warn(`[checkOrderStatus] Order #${order_id} not found`);
      return;
    }

    if (target_status === 'shipped') {
      const dispatch_notes = order.dispatch_notes;
      const all_dispatched =
        dispatch_notes.length > 0 &&
        dispatch_notes.every(
          (dn) => dn.status === 'delivered' || dn.status === 'invoiced',
        );

      if (all_dispatched && order.state === 'processing') {
        await this.prisma.orders.update({
          where: { id: order_id },
          data: {
            state: 'shipped',
            updated_at: new Date(),
          },
        });

        this.logger.log(
          `[checkOrderStatus] Order #${order_id} marked as shipped`,
        );
      }
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
