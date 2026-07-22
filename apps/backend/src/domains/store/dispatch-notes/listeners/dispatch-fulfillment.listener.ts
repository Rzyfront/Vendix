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
 *  - `dispatch_note.invoiced`
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

  // One handler for every fulfillment-changing event (identical payload shape:
  // DispatchNoteFulfillmentEvent). `invoiced` is included so an order flips to
  // 'full' the moment its remisiones get facturadas (QUI-497) — the invoiced
  // note still counts toward the rollup (status <> 'voided'), but the recompute
  // must fire so the denormalized column is fresh.
  @OnEvent('dispatch_note.confirmed')
  @OnEvent('dispatch_note.delivered')
  @OnEvent('dispatch_note.voided')
  @OnEvent('dispatch_note.invoiced')
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
   * Replicates the backfill of migration 20260716120005 and EXTENDS it with a
   * legacy fallback (QUI-497):
   *  - per order line: ordered_qty = order_items.quantity.
   *  - PRIMARY link: SUM(dispatch_note_items.dispatched_quantity) WHERE
   *    dispatch_note_items.sales_order_item_id = order_items.id AND
   *    dispatch_notes.status <> 'voided'.
   *  - FALLBACK: dispatch_note_items with `sales_order_item_id IS NULL` (legacy
   *    notes created before the linkage existed) never matched a line, so a
   *    100%-remitida legacy order stayed 'none'/'partial' forever. Their units
   *    are attributed CLAIM-ONCE by `(product_id, product_variant_id)` to the
   *    order lines of the same order: each NULL-linked unit fills at most one
   *    line's remaining need (deterministic by order_item id), so no
   *    double-counting.
   *  - per order: full_lines = dispatched >= ordered > 0; partial_lines =
   *    0 < dispatched < ordered.
   *  - CASE: 0 lines → none; all full → full; any full/partial → partial; else none.
   *
   * Raw SQL bypasses the scoped Prisma extension, so the store filter is applied
   * MANUALLY ($2) on both `orders` and `dispatch_notes` (multi-tenant safety).
   */
  async recomputeOrderFulfillment(
    order_id: number,
    store_id: number,
  ): Promise<void> {
    // (A) Order lines — ordered qty + product identity for the fallback match.
    const orderLines = await this.prisma.$queryRawUnsafe<
      Array<{
        order_item_id: number;
        product_id: number | null;
        product_variant_id: number | null;
        ordered_qty: number | string;
      }>
    >(
      `
      SELECT
        oi.id AS order_item_id,
        oi.product_id,
        oi.product_variant_id,
        oi.quantity::numeric AS ordered_qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id = $1
        AND o.store_id = $2
      ORDER BY oi.id ASC
      `,
      order_id,
      store_id,
    );

    // (B) Dispatched units on non-voided remisiones of this order. Carries the
    // linkage (may be NULL) + product identity so the fallback can attribute
    // NULL-linked units. Store filter applied manually ($2).
    const dispatchedItems = await this.prisma.$queryRawUnsafe<
      Array<{
        sales_order_item_id: number | null;
        product_id: number | null;
        product_variant_id: number | null;
        qty: number | string;
      }>
    >(
      `
      SELECT
        dni.sales_order_item_id,
        dni.product_id,
        dni.product_variant_id,
        dni.dispatched_quantity::numeric AS qty
      FROM dispatch_note_items dni
      JOIN dispatch_notes dn ON dn.id = dni.dispatch_note_id
      WHERE dn.order_id = $1
        AND dn.status <> 'voided'
        AND dn.store_id = $2
      `,
      order_id,
      store_id,
    );

    // Per-line accumulator seeded from the order lines.
    const idKey = (p: number | null, v: number | null) =>
      `${p ?? 'null'}:${v ?? 'null'}`;
    const lines = orderLines.map((l) => ({
      order_item_id: Number(l.order_item_id),
      key: idKey(l.product_id, l.product_variant_id),
      ordered_qty: Number(l.ordered_qty ?? 0),
      dispatched: 0,
    }));
    const byItemId = new Map(lines.map((l) => [l.order_item_id, l]));

    // PRIMARY: linked units go straight to their line. NULL-linked units are
    // pooled per (product_id, product_variant_id) for the claim-once fallback.
    const nullPool = new Map<string, number>();
    for (const it of dispatchedItems) {
      const qty = Number(it.qty ?? 0);
      if (qty <= 0) continue;
      if (it.sales_order_item_id != null) {
        const line = byItemId.get(Number(it.sales_order_item_id));
        if (line) line.dispatched += qty;
        // A link pointing outside this order (shouldn't happen) is ignored.
      } else {
        const k = idKey(it.product_id, it.product_variant_id);
        nullPool.set(k, (nullPool.get(k) ?? 0) + qty);
      }
    }

    // FALLBACK: distribute each NULL-linked pool across matching lines,
    // claim-once, filling remaining need first (deterministic by order_item id).
    for (const [key, poolQtyRaw] of nullPool) {
      let remaining = poolQtyRaw;
      if (remaining <= 0) continue;
      const matching = lines.filter((l) => l.key === key);
      for (const line of matching) {
        if (remaining <= 0) break;
        const need = line.ordered_qty - line.dispatched;
        if (need <= 0) continue;
        const take = Math.min(need, remaining);
        line.dispatched += take;
        remaining -= take;
      }
    }

    const totalLines = lines.length;
    let fullLines = 0;
    let partialLines = 0;
    for (const l of lines) {
      if (l.ordered_qty > 0 && l.dispatched >= l.ordered_qty) fullLines++;
      else if (l.dispatched > 0 && l.dispatched < l.ordered_qty) partialLines++;
    }

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
