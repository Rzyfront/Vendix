import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { OrderSequenceService } from '../manufacturing/orders/order-sequence.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import {
  PRODUCTION_SALE_CANCELLED_EVENT,
  PRODUCTION_SALE_SYNC_EVENT,
  type ProductionSaleCancelledPayload,
  type ProductionSaleSyncPayload,
} from './production-sale-sync';
import { suggestProductionDisposition } from './production-disposition.util';

const CLOSED_SALE_STATES = ['cancelled', 'refunded'];
/** Production states with nothing produced yet: cancelled as is with the sale. */
const OPEN_PRODUCTION_STATES = ['draft', 'in_progress', 'released'] as const;

/**
 * QUI-995 — keeps the production orders of a sale in sync with its
 * `fulfillment_destination = 'production'` lines: ONE order per product
 * (+ variant when the line sells one), `planned_qty` = sum of the line quantities, linked through
 * `production_orders.order_id`.
 *
 * Idempotent: running it twice changes nothing. While an order is `draft` it
 * follows the sale (quantity, due date, and cancellation when its lines are
 * gone); once started or completed it is never rewritten from here.
 *
 * Queries go through the unscoped client with an explicit `store_id` taken from
 * the sale itself, so it works from any request context (POS, ecommerce, jobs).
 */
@Injectable()
export class ProductionSaleLinkService {
  private readonly logger = new Logger(ProductionSaleLinkService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly sequences: OrderSequenceService,
    private readonly stockLevelManager?: StockLevelManager,
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * The sale was cancelled: draft/in-progress orders are cancelled; a COMPLETED
   * order keeps its finished goods, which either go back to sellable stock
   * (`release`) or are written off (`waste`). Never throws: the cancellation
   * has already committed, so a failure is logged for follow-up.
   */
  @OnEvent(PRODUCTION_SALE_CANCELLED_EVENT)
  async onSaleCancelled(payload: ProductionSaleCancelledPayload): Promise<void> {
    try {
      await this.handleSaleCancelled(payload);
    } catch (error) {
      this.logger.error(
        `Production cleanup of cancelled sale #${payload.order_id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async handleSaleCancelled(payload: ProductionSaleCancelledPayload): Promise<void> {
    const client = this.prisma.withoutScope();
    const linked = await client.production_orders.findMany({
      where: { store_id: payload.store_id, order_id: payload.order_id },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        status: true,
        planned_qty: true,
        produced_qty: true,
        product: { select: { name: true } },
      },
    });
    if (linked.length === 0) return;

    // Nothing was produced yet (draft / in_progress / released): cancelled as is.
    const open = linked.filter((o) =>
      (OPEN_PRODUCTION_STATES as readonly string[]).includes(o.status as string),
    );
    if (open.length > 0) {
      await client.production_orders.updateMany({
        where: { id: { in: open.map((o) => o.id) }, status: { in: [...OPEN_PRODUCTION_STATES] } },
        data: { status: 'cancelled', updated_at: new Date() },
      });
    }

    // partially_completed: what WAS produced is credited and reserved like a
    // completed order (same disposition below, over `produced_qty`), and the
    // quantity still to produce is cancelled with the order itself.
    const partial = linked.filter((o) => o.status === 'partially_completed');
    if (partial.length > 0) {
      await client.production_orders.updateMany({
        where: { id: { in: partial.map((o) => o.id) }, status: 'partially_completed' },
        data: { status: 'cancelled', updated_at: new Date() },
      });
    }

    const completed = linked.filter(
      (o) => o.status === 'completed' || o.status === 'partially_completed',
    );
    if (completed.length === 0 || !this.stockLevelManager) return;

    const lines = await client.order_items.findMany({
      where: {
        order_id: payload.order_id,
        fulfillment_destination: 'production',
        product_id: { in: completed.map((o) => o.product_id) },
      },
      select: {
        product_id: true,
        product_variant_id: true,
        notes: true,
        inventory_committed: true,
        order_item_options: { select: { id: true }, take: 1 },
      },
    });
    const disposition = payload.disposition ?? suggestProductionDisposition(lines);
    const wasteEvents: Array<Record<string, unknown>> = [];

    for (const order of completed) {
      // The goods already left with the delivery (the commit consumed the
      // reservation and decremented on_hand): nothing is reserved anymore, so
      // releasing or writing off again would double count.
      const variant_id = order.product_variant_id ?? null;
      const productLines = lines.filter(
        (l) => l.product_id === order.product_id && (l.product_variant_id ?? null) === variant_id,
      );
      if (productLines.length > 0 && productLines.every((l) => l.inventory_committed)) continue;
      // A partially_completed order with no recorded output has nothing to release.
      const produced =
        order.status === 'partially_completed'
          ? Number(order.produced_qty ?? 0)
          : Number(order.produced_qty ?? order.planned_qty);
      const reserved = Math.min(produced, Math.round(Number(order.planned_qty)));
      if (reserved <= 0) continue;
      await client.$transaction(async (tx) => {
        // Only what is STILL reserved can be released or written off: a line
        // delivered on its own already consumed its share of the reservation.
        const quantity = await this.stockLevelManager!.releaseReservationQuantity(
          'order',
          payload.order_id,
          order.product_id,
          variant_id,
          reserved,
          disposition === 'waste' ? 'consumed' : 'cancelled',
          tx,
          { decrementOnHand: false },
        );
        if (disposition !== 'waste' || !(quantity > 0)) return;
        const location_id = await this.stockLevelManager!.getDefaultLocationForProduct(
          order.product_id,
          variant_id ?? undefined,
          tx,
        );
        const result = await this.stockLevelManager!.updateStock(
          {
            product_id: order.product_id,
            ...(variant_id != null ? { variant_id } : {}),
            location_id,
            quantity_change: -quantity,
            movement_type: 'damage',
            reason: `Merma de producción #${order.id} por cancelación de la orden #${payload.order_id}${
              payload.reason ? `: ${payload.reason}` : ''
            }`,
            source_module: 'production_sale_cancelled',
            create_movement: true,
            validate_availability: false,
            allow_negative: true,
          },
          tx,
        );
        wasteEvents.push({
          production_order_id: order.id,
          order_id: payload.order_id,
          store_id: payload.store_id,
          product_name: order.product?.name ?? `#${order.product_id}`,
          quantity,
          total_cost: Number(result?.cost_snapshot?.total_cost ?? 0),
        });
      });
    }

    // Accounting after the stock commits (DR shrinkage / CR finished goods):
    // the finished goods entered inventory with `production.completed`, so the
    // write-off leaves it the same way an adjustment would.
    if (wasteEvents.length === 0 || !this.eventEmitter) return;
    const store = await client.stores.findUnique({
      where: { id: payload.store_id },
      select: { organization_id: true },
    });
    for (const event of wasteEvents) {
      this.eventEmitter.emit('production.sale_waste', {
        ...event,
        organization_id: store?.organization_id,
      });
    }
  }

  @OnEvent(PRODUCTION_SALE_SYNC_EVENT)
  async onSaleSync(payload: ProductionSaleSyncPayload): Promise<void> {
    await this.ensureForOrder(payload.order_id);
  }

  async ensureForOrder(order_id: number, attempt = 0): Promise<{ id: number }[]> {
    const client = this.prisma.withoutScope();
    const sale = await client.orders.findFirst({
      where: { id: order_id },
      select: {
        id: true,
        store_id: true,
        state: true,
        created_at: true,
        fulfillment_schedule: { select: { scheduled_start: true } },
        order_items: {
          where: {
            cancelled_at: null,
            fulfillment_destination: 'production',
            product_id: { not: null },
          },
          select: { id: true, product_id: true, product_variant_id: true, quantity: true },
        },
      },
    });
    if (!sale || CLOSED_SALE_STATES.includes(sale.state as string)) return [];

    // One order per product+variant: a variant sale must credit and reserve the
    // SOLD variant, so lines of different variants never share an order.
    const keyOf = (product_id: number, variant_id: number | null) =>
      `${product_id}:${variant_id ?? ''}`;
    const planned = new Map<
      string,
      { product_id: number; variant_id: number | null; qty: number }
    >();
    for (const item of sale.order_items) {
      const variant_id = item.product_variant_id ?? null;
      const key = keyOf(item.product_id!, variant_id);
      const current = planned.get(key);
      planned.set(key, {
        product_id: item.product_id!,
        variant_id,
        qty: (current?.qty ?? 0) + Number(item.quantity),
      });
    }
    const due_date = sale.fulfillment_schedule?.scheduled_start ?? sale.created_at ?? new Date();

    const recipesByProduct = new Map<
      number,
      Array<{ id: number; product_variant_id: number | null }>
    >();
    if (planned.size > 0) {
      const recipes = await client.recipes.findMany({
        where: {
          store_id: sale.store_id,
          product_id: { in: [...new Set([...planned.values()].map((v) => v.product_id))] },
          is_active: true,
        },
        select: { id: true, product_id: true, product_variant_id: true },
        orderBy: { id: 'asc' },
      });
      for (const recipe of recipes) {
        const list = recipesByProduct.get(recipe.product_id) ?? [];
        list.push({ id: recipe.id, product_variant_id: recipe.product_variant_id });
        recipesByProduct.set(recipe.product_id, list);
      }
    }
    const recipeFor = (product_id: number, variant_id: number | null): number | undefined => {
      const list = recipesByProduct.get(product_id) ?? [];
      // The variant's own recipe first, then the base recipe (no variant), then
      // whatever active recipe the product has.
      return (
        (variant_id != null
          ? list.find((r) => r.product_variant_id === variant_id)
          : undefined) ??
        list.find((r) => r.product_variant_id == null) ??
        list[0]
      )?.id;
    };

    try {
      return await client.$transaction(async (tx) => {
        const existing = await tx.production_orders.findMany({
          where: { store_id: sale.store_id, order_id: sale.id },
          select: {
            id: true,
            product_id: true,
            product_variant_id: true,
            status: true,
            planned_qty: true,
            due_date: true,
          },
        });
        const byKey = new Map(
          existing.map((o) => [keyOf(o.product_id, o.product_variant_id ?? null), o]),
        );
        const result: { id: number }[] = [];

        for (const [key, { product_id, variant_id, qty }] of planned) {
          const current = byKey.get(key);
          if (!current) {
            const recipe_id = recipeFor(product_id, variant_id);
            if (!recipe_id) {
              this.logger.warn(
                `Sale #${sale.id}: product #${product_id} has no active recipe; no production order created`,
              );
              continue;
            }
            const order_number = await this.sequences.next(tx, sale.store_id);
            const created = await tx.production_orders.create({
              data: {
                store_id: sale.store_id,
                product_id,
                product_variant_id: variant_id,
                recipe_id,
                order_id: sale.id,
                planned_qty: new Prisma.Decimal(qty),
                status: 'draft',
                source: 'order',
                priority: 'normal',
                order_number,
                due_date,
              },
              select: { id: true },
            });
            result.push(created);
            continue;
          }
          result.push({ id: current.id });
          // The line came back after its order was cancelled (removed and
          // re-added, or cancelled from Planta): the unique (order_id,
          // product_id, product_variant_id) forbids a new row, so the cancelled
          // one returns to draft.
          if (current.status === 'cancelled') {
            await tx.production_orders.updateMany({
              where: { id: current.id, status: 'cancelled' },
              data: {
                status: 'draft',
                planned_qty: new Prisma.Decimal(qty),
                due_date,
                started_at: null,
                updated_at: new Date(),
              },
            });
            continue;
          }
          if (
            current.status === 'draft' &&
            (Number(current.planned_qty) !== qty ||
              current.due_date?.getTime() !== due_date.getTime())
          ) {
            await tx.production_orders.updateMany({
              where: { id: current.id, status: 'draft' },
              data: {
                planned_qty: new Prisma.Decimal(qty),
                due_date,
                updated_at: new Date(),
              },
            });
          }
        }

        // A draft whose lines are gone follows the sale and is cancelled.
        for (const current of existing) {
          if (
            planned.has(keyOf(current.product_id, current.product_variant_id ?? null)) ||
            current.status !== 'draft'
          )
            continue;
          await tx.production_orders.updateMany({
            where: { id: current.id, status: 'draft' },
            data: { status: 'cancelled', updated_at: new Date() },
          });
        }
        return result;
      });
    } catch (error) {
      // Two concurrent ensures can race on the (order_id, product_id, product_variant_id) unique:
      // the loser re-reads and finds the winner's row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < 1
      ) {
        return this.ensureForOrder(order_id, attempt + 1);
      }
      throw error;
    }
  }
}
