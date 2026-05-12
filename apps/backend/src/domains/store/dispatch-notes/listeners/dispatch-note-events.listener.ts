import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';

interface DispatchNoteEvent {
  dispatch_note_id: number;
  dispatch_number: string;
  store_id: number;
  sales_order_id?: number | null;
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

      // Only reserve stock for standalone dispatch notes (no sales order).
      // When linked to a sales order, stock was already reserved during SO confirmation.
      if (!dispatch_note.sales_order_id) {
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

      // 1. Deduct stock for each item
      for (const item of dispatch_note.dispatch_note_items) {
        const location_id =
          item.location_id || dispatch_note.dispatch_location_id;

        if (!location_id) continue;

        try {
          await this.stockLevelManager.updateStock({
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id,
            quantity_change: -item.dispatched_quantity,
            movement_type: 'stock_out',
            reason: `Despacho remisión #${event.dispatch_number}`,
            create_movement: true,
            validate_availability: false, // Already confirmed/reserved
          });
        } catch (err) {
          this.logger.error(
            `[delivered] Failed to deduct stock for product ${item.product_id} on dispatch note #${event.dispatch_number}: ${err.message}`,
          );
        }
      }

      // 2. Handle sales order integration
      if (dispatch_note.sales_order_id) {
        try {
          // Release stock reservations made by the sales order
          await this.stockLevelManager.releaseReservationsByReference(
            'order',
            dispatch_note.sales_order_id,
            'consumed',
          );

          // Check if all items of the SO have been fully dispatched
          await this.checkAndUpdateSalesOrderStatus(
            dispatch_note.sales_order_id,
            'shipped',
          );
        } catch (err) {
          this.logger.error(
            `[delivered] Failed to update sales order #${dispatch_note.sales_order_id}: ${err.message}`,
          );
        }
      } else {
        // Standalone dispatch: release reservations we made on confirm
        try {
          await this.stockLevelManager.releaseReservationsByReference(
            'order',
            dispatch_note.id,
            'consumed',
          );
        } catch (err) {
          this.logger.error(
            `[delivered] Failed to release standalone reservations for dispatch note #${event.dispatch_number}: ${err.message}`,
          );
        }
      }

      this.logger.log(
        `[delivered] Dispatch note #${event.dispatch_number} processed — stock deducted`,
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
        if (!dispatch_note.sales_order_id) {
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
        // If linked to SO, we do NOT release SO reservations — they belong to the SO lifecycle
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
}
