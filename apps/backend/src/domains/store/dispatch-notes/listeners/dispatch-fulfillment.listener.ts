import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { dispatch_fulfillment_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/**
 * Uniform payload emitted by every dispatch-note lifecycle event that can
 * change how much of an order has been remitted:
 *  - `dispatch_note.confirmed`
 *  - `dispatch_note.delivered`
 *  - `dispatch_note.voided`
 *
 * (Same shape used by DispatchNoteEventsListener / route-flow / createFromOrder.)
 */
interface DispatchNoteFulfillmentEvent {
  dispatch_note_id: number;
  dispatch_number: string;
  store_id: number;
  sales_order_id?: number | null;
  order_id?: number | null;
}

/**
 * Bug C — keeps `orders.dispatch_fulfillment` in sync.
 *
 * The column was WRITE-ONCE: only migration 20260716120005 backfilled it and no
 * runtime code recomputed it. After the first remisión the value went stale, so
 * a 100%-remitida order kept showing up as despachable
 * (orders.service.ts findAll(dispatchable) and stores.service.ts dispatchWhere
 * both filter on `dispatch_fulfillment != 'full'`).
 *
 * This listener recomputes the rollup on every fulfillment-changing event.
 * The DEFAULT 'draft' path of createFromOrder does NOT emit an event but its
 * (non-voided) draft note already counts toward the rollup, so DispatchNotesService
 * calls {@link recomputeOrderFulfillment} inline after that flow too.
 */
@Injectable()
export class DispatchFulfillmentListener {
  private readonly logger = new Logger(DispatchFulfillmentListener.name);

  constructor(private readonly prisma: StorePrismaService) {}

  // One handler for all three fulfillment-changing events (identical payload).
  @OnEvent('dispatch_note.confirmed')
  @OnEvent('dispatch_note.delivered')
  @OnEvent('dispatch_note.voided')
  async handleFulfillmentChange(
    event: DispatchNoteFulfillmentEvent,
  ): Promise<void> {
    // Only order-linked remisiones move an order's fulfillment. Standalone /
    // sales-order-only notes have no `orders` row to update.
    if (!event.order_id) return;

    // Isolated: a recompute failure must never break the emitter chain (stock
    // deduction, accounting, notifications all ride the same events).
    try {
      await this.recomputeOrderFulfillment(event.order_id, event.store_id);
    } catch (error: any) {
      this.logger.error(
        `[fulfillment] Failed to recompute dispatch_fulfillment for order #${event.order_id}: ${error?.message}`,
        error?.stack,
      );
    }
  }

  /**
   * Recompute `orders.dispatch_fulfillment` from the current non-voided
   * dispatch_note_items rollup. Public + reusable so DispatchNotesService can
   * call it inline for the 'draft' createFromOrder path (which emits no event).
   *
   * Replicates the backfill of migration 20260716120005 exactly:
   *  - per order line: dispatched_qty = SUM(dispatch_note_items.dispatched_quantity)
   *    WHERE dispatch_note_items.sales_order_item_id = order_items.id AND
   *    dispatch_notes.status <> 'voided'; ordered_qty = order_items.quantity.
   *  - per order: full_lines = lines fully covered (dispatched >= ordered > 0),
   *    partial_lines = lines partly covered (0 < dispatched < ordered).
   *  - CASE: 0 lines → none; all full → full; any full/partial → partial; else none.
   *
   * Raw SQL bypasses the scoped Prisma extension, so the store filter is applied
   * MANUALLY ($2) on both `orders` and `dispatch_notes` (multi-tenant safety).
   */
  async recomputeOrderFulfillment(
    order_id: number,
    store_id: number,
  ): Promise<void> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        full_lines: bigint | number;
        partial_lines: bigint | number;
        total_lines: bigint | number;
      }>
    >(
      `
      WITH line_rollup AS (
        SELECT
          oi.id AS order_item_id,
          oi.quantity::numeric AS ordered_qty,
          COALESCE((
            SELECT SUM(dni.dispatched_quantity)
            FROM dispatch_note_items dni
            JOIN dispatch_notes dn ON dn.id = dni.dispatch_note_id
            WHERE dni.sales_order_item_id = oi.id
              AND dn.status <> 'voided'
              AND dn.store_id = $2
          ), 0)::numeric AS dispatched_qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.order_id = $1
          AND o.store_id = $2
      )
      SELECT
        COUNT(*) FILTER (WHERE dispatched_qty >= ordered_qty AND ordered_qty > 0) AS full_lines,
        COUNT(*) FILTER (WHERE dispatched_qty > 0 AND dispatched_qty < ordered_qty) AS partial_lines,
        COUNT(*) AS total_lines
      FROM line_rollup
      `,
      order_id,
      store_id,
    );

    const row = rows?.[0];
    const totalLines = Number(row?.total_lines ?? 0);
    const fullLines = Number(row?.full_lines ?? 0);
    const partialLines = Number(row?.partial_lines ?? 0);

    let fulfillment: dispatch_fulfillment_enum;
    if (totalLines === 0) {
      fulfillment = dispatch_fulfillment_enum.none;
    } else if (fullLines === totalLines) {
      fulfillment = dispatch_fulfillment_enum.full;
    } else if (fullLines > 0 || partialLines > 0) {
      fulfillment = dispatch_fulfillment_enum.partial;
    } else {
      fulfillment = dispatch_fulfillment_enum.none;
    }

    // Scope-safe write: updateMany with an explicit tenant filter (never
    // update-by-WhereUnique in a scoped service — vendix-prisma-scopes).
    await this.prisma.orders.updateMany({
      where: { id: order_id, store_id },
      data: { dispatch_fulfillment: fulfillment },
    });

    this.logger.log(
      `[fulfillment] Order #${order_id} → dispatch_fulfillment='${fulfillment}' ` +
        `(full=${fullLines}, partial=${partialLines}, total=${totalLines})`,
    );
  }
}
