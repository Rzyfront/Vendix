import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { OrderSequenceService } from '../manufacturing/orders/order-sequence.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { RecipesService } from '../recipes/recipes.service';
import {
  PRODUCTION_SALE_CANCELLED_EVENT,
  PRODUCTION_SALE_SYNC_EVENT,
  type ProductionSaleCancelledOutcome,
  type ProductionSaleCancelledPayload,
  type ProductionSaleSyncPayload,
} from './production-sale-sync';
import { emitProductionOrderUpdated } from './production-order-events';
import type { ProductionDisposition } from './production-disposition.util';
import { findProductionOrderForLine } from './production-order-pairing.util';
import {
  ADDON_OPTIONS_SELECT,
  RECIPE_REQUIREMENT_SELECT,
  computeComponentRequirements,
  expandAddonRequirements,
  mergeRequirements,
  plannedLinesCreate,
  replacePlannedLines,
  type ComponentRequirement,
  type RecipeForRequirements,
  type SaleLineForPlan,
} from './production-order-lines.util';

const CLOSED_SALE_STATES = ['cancelled', 'refunded'];
/** Live production lines of a sale: the ones that drive its production orders. */
const LIVE_PRODUCTION_LINES = {
  cancelled_at: null,
  fulfillment_destination: 'production',
  product_id: { not: null },
} as const;

/** Delivery instant a sale's production orders anchor on (shared by sync and restart). */
const saleDueDate = (sale: {
  created_at: Date | null;
  fulfillment_schedule: { scheduled_start: Date } | null;
}): Date => sale.fulfillment_schedule?.scheduled_start ?? sale.created_at ?? new Date();

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
    // S1: the planned requirement of the add-ons uses the same expansion as
    // their consumption. Without them only the base recipe is planned.
    private readonly recipes?: RecipesService,
    private readonly stockValidator?: StockValidatorService,
  ) {}

  /**
   * S1 — planned requirement per component of a sale-linked order: the base
   * recipe scaled to `qty` (`computeComponentRequirements`) plus the add-ons of
   * the sale lines it serves (`expandAddonRequirements`, the expansion
   * `consumeLinkedAddons` consumes with), summed per component.
   */
  async plannedRequirements(
    tx: Prisma.TransactionClient,
    p: { recipe: RecipeForRequirements; qty: number; items: SaleLineForPlan[] },
  ): Promise<ComponentRequirement[]> {
    const base = computeComponentRequirements(p.recipe, p.qty);
    if (!this.recipes || !this.stockValidator || !this.stockLevelManager) return base;
    try {
      const addons = await expandAddonRequirements(
        {
          recipes: this.recipes,
          stockValidator: this.stockValidator,
          stockLevelManager: this.stockLevelManager,
          client: tx,
        },
        p.items,
      );
      return mergeRequirements(base, addons);
    } catch (error) {
      // The plan is informative: an add-on that cannot be expanded must never
      // stop the sale from getting its production order. Plan the base recipe.
      this.logger.warn(
        `Add-on plan skipped (base recipe only): ${error instanceof Error ? error.message : String(error)}`,
      );
      return base;
    }
  }

  /**
   * QUI-1002 — live-sync emission AFTER the commit, from the committed rows.
   * A reload or emission failure is logged and never breaks the sync.
   */
  private async emitCommitted(
    client: ReturnType<StorePrismaService['withoutScope']>,
    ids: number[],
  ): Promise<void> {
    if (!this.eventEmitter || ids.length === 0) return;
    try {
      const rows = await client.production_orders.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          store_id: true,
          order_id: true,
          status: true,
          started_at: true,
          produced_at: true,
          estimated_minutes: true,
        },
        orderBy: { id: 'asc' },
      });
      for (const row of rows) {
        emitProductionOrderUpdated(this.eventEmitter, this.logger, row);
      }
    } catch (error) {
      this.logger.warn(
        `production_order.updated reload failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The sale was cancelled: orders with nothing produced (draft, in progress,
   * released) are cancelled. A COMPLETED order keeps its finished goods, which
   * either go back to sellable stock (`release`) or are written off (`waste`);
   * a PARTIALLY completed one gets that disposition over what it produced and
   * is cancelled. Each completed order takes ITS own choice, else the single
   * `disposition`, else `release` (reuse). Never throws: the cancellation has
   * already committed, so a failure is logged for follow-up; the outcome lists
   * the orders whose write-off failed so the caller can keep them reserved.
   */
  @OnEvent(PRODUCTION_SALE_CANCELLED_EVENT)
  async onSaleCancelled(
    payload: ProductionSaleCancelledPayload,
  ): Promise<ProductionSaleCancelledOutcome> {
    const outcome: ProductionSaleCancelledOutcome = { unadjusted: [] };
    try {
      return await this.handleSaleCancelled(payload, outcome);
    } catch (error) {
      this.logger.error(
        `Production cleanup of cancelled sale #${payload.order_id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // Whatever was registered as unadjusted stays held by the caller.
      return outcome;
    }
  }

  async handleSaleCancelled(
    payload: ProductionSaleCancelledPayload,
    outcome: ProductionSaleCancelledOutcome = { unadjusted: [] },
  ): Promise<ProductionSaleCancelledOutcome> {
    const client = this.prisma.withoutScope();
    const linked = await client.production_orders.findMany({
      where: { store_id: payload.store_id, order_id: payload.order_id },
      select: {
        id: true,
        order_number: true,
        product_id: true,
        product_variant_id: true,
        status: true,
        planned_qty: true,
        produced_qty: true,
        product: { select: { name: true } },
      },
    });
    if (linked.length === 0) return outcome;

    const dispositionOf = (production_order_id: number): ProductionDisposition =>
      payload.dispositions?.find((d) => d.production_order_id === production_order_id)
        ?.disposition ??
      payload.disposition ??
      'release';
    // A partially_completed order with no recorded output has nothing reserved.
    const reservedOf = (order: (typeof linked)[number]): number => {
      const produced =
        order.status === 'partially_completed'
          ? Number(order.produced_qty ?? 0)
          : Number(order.produced_qty ?? order.planned_qty);
      return Math.min(produced, Math.round(Number(order.planned_qty)));
    };
    const settle = (production_order_id: number) => {
      const index = outcome.unadjusted.findIndex(
        (u) => u.production_order_id === production_order_id,
      );
      if (index >= 0) outcome.unadjusted.splice(index, 1);
    };
    // S1 — pessimistic: every finished order chosen as waste counts as
    // unadjusted until its write-off commits, so a failure ANYWHERE below
    // (even before the loop) keeps its goods reserved instead of letting the
    // caller's blanket release make them sellable.
    if (this.stockLevelManager) {
      for (const order of linked) {
        if (order.status !== 'completed' && order.status !== 'partially_completed') continue;
        if (dispositionOf(order.id) !== 'waste') continue;
        const reserved = reservedOf(order);
        if (reserved <= 0) continue;
        outcome.unadjusted.push({
          production_order_id: order.id,
          order_number: order.order_number ?? null,
          product_id: order.product_id,
          product_variant_id: order.product_variant_id ?? null,
          reserved_qty: reserved,
        });
      }
    }

    // Nothing was produced yet (draft / in_progress / released): cancelled as is.
    const open = linked.filter((o) =>
      (OPEN_PRODUCTION_STATES as readonly string[]).includes(o.status as string),
    );
    if (open.length > 0) {
      await client.production_orders.updateMany({
        where: { id: { in: open.map((o) => o.id) }, status: { in: [...OPEN_PRODUCTION_STATES] } },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      await this.emitCommitted(client, open.map((o) => o.id));
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
      await this.emitCommitted(client, partial.map((o) => o.id));
    }

    const completed = linked.filter(
      (o) => o.status === 'completed' || o.status === 'partially_completed',
    );
    if (completed.length === 0 || !this.stockLevelManager) return outcome;

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
    const wasteEvents: Array<Record<string, unknown>> = [];

    for (const order of completed) {
      // The goods already left with the delivery (the commit consumed the
      // reservation and decremented on_hand): nothing is reserved anymore, so
      // releasing or writing off again would double count.
      const variant_id = order.product_variant_id ?? null;
      const productLines = lines.filter(
        (l) => l.product_id === order.product_id && (l.product_variant_id ?? null) === variant_id,
      );
      if (productLines.length > 0 && productLines.every((l) => l.inventory_committed)) {
        settle(order.id);
        continue;
      }
      const reserved = reservedOf(order);
      if (reserved <= 0) continue;
      const disposition = dispositionOf(order.id);
      try {
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
        // Committed (written off, or nothing was still reserved): settled.
        settle(order.id);
      } catch (error) {
        this.logger.error(
          `Production order #${order.id} of cancelled sale #${payload.order_id}: ${disposition} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // A failed release is harmless (the general release returns the units
        // to sellable stock). A failed write-off stays registered as
        // unadjusted (pessimistic entry above): the goods must not look
        // sellable although they were discarded.
      }
    }

    // Accounting after the stock commits (DR shrinkage / CR finished goods):
    // the finished goods entered inventory with `production.completed`, so the
    // write-off leaves it the same way an adjustment would.
    if (wasteEvents.length === 0 || !this.eventEmitter) return outcome;
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
    return outcome;
  }

  @OnEvent(PRODUCTION_SALE_SYNC_EVENT)
  async onSaleSync(payload: ProductionSaleSyncPayload): Promise<void> {
    await this.ensureForOrder(payload.order_id);
  }

  /**
   * S21 — what a cancelled production order would restart with: the state of
   * its sale and the quantity (sum of the live production lines paired with it,
   * through `findProductionOrderForLine`) and delivery instant the sync uses.
   * `null` when the sale does not exist; `qty` 0 when no live line pairs.
   */
  async planRestart(
    order_id: number,
    production_order_id: number,
  ): Promise<{
    sale_state: string;
    qty: number;
    due_date: Date;
    /** The live lines paired with the order, with their add-ons (S1 plan on restart). */
    items: SaleLineForPlan[];
  } | null> {
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
          where: LIVE_PRODUCTION_LINES,
          select: {
            id: true,
            product_id: true,
            product_variant_id: true,
            quantity: true,
            order_item_options: ADDON_OPTIONS_SELECT,
          },
        },
      },
    });
    if (!sale) return null;
    const orders = await client.production_orders.findMany({
      where: { store_id: sale.store_id, order_id: sale.id },
      select: { id: true, product_id: true, product_variant_id: true },
    });
    const items = sale.order_items.filter(
      (item) => findProductionOrderForLine(orders, item)?.id === production_order_id,
    );
    const qty = items.reduce((sum, item) => sum + Number(item.quantity), 0);
    return {
      sale_state: sale.state as string,
      qty,
      due_date: saleDueDate(sale),
      items: items as SaleLineForPlan[],
    };
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
          where: LIVE_PRODUCTION_LINES,
          select: {
            id: true,
            product_id: true,
            product_variant_id: true,
            quantity: true,
            order_item_options: ADDON_OPTIONS_SELECT,
          },
        },
      },
    });
    if (!sale || CLOSED_SALE_STATES.includes(sale.state as string)) return [];
    // A sale without live production lines only has work here when some order
    // is still linked to it (a draft whose lines are gone). Otherwise there is
    // nothing to sync: skip the recipe read and the transaction (every POS
    // payment, retail included, passes through here).
    if (sale.order_items.length === 0) {
      const linked = await client.production_orders.findFirst({
        where: { store_id: sale.store_id, order_id: sale.id },
        select: { id: true },
      });
      if (!linked) return [];
    }

    // One order per product+variant: a variant sale must credit and reserve the
    // SOLD variant, so lines of different variants never share an order.
    const keyOf = (product_id: number, variant_id: number | null) =>
      `${product_id}:${variant_id ?? ''}`;
    const planned = new Map<
      string,
      {
        product_id: number;
        variant_id: number | null;
        qty: number;
        items: SaleLineForPlan[];
      }
    >();
    for (const item of sale.order_items) {
      const variant_id = item.product_variant_id ?? null;
      const key = keyOf(item.product_id!, variant_id);
      const current = planned.get(key);
      planned.set(key, {
        product_id: item.product_id!,
        variant_id,
        qty: (current?.qty ?? 0) + Number(item.quantity),
        items: [...(current?.items ?? []), item as SaleLineForPlan],
      });
    }
    const due_date = saleDueDate(sale);

    type PlanRecipe = RecipeForRequirements & { id: number; product_variant_id: number | null };
    const recipesByProduct = new Map<number, PlanRecipe[]>();
    if (planned.size > 0) {
      const recipes = await client.recipes.findMany({
        where: {
          store_id: sale.store_id,
          product_id: { in: [...new Set([...planned.values()].map((v) => v.product_id))] },
          is_active: true,
        },
        select: {
          id: true,
          product_id: true,
          product_variant_id: true,
          waste_percent: RECIPE_REQUIREMENT_SELECT.waste_percent,
          yield_quantity: RECIPE_REQUIREMENT_SELECT.yield_quantity,
          items: RECIPE_REQUIREMENT_SELECT.items,
        },
        orderBy: { id: 'asc' },
      });
      for (const recipe of recipes) {
        const list = recipesByProduct.get(recipe.product_id) ?? [];
        // `items` is always an array for the plan (a bare mock row has none).
        list.push({ ...recipe, items: recipe.items ?? [] });
        recipesByProduct.set(recipe.product_id, list);
      }
    }
    const recipeFor = (product_id: number, variant_id: number | null): PlanRecipe | undefined => {
      const list = recipesByProduct.get(product_id) ?? [];
      // The variant's own recipe first, then the base recipe (no variant), then
      // whatever active recipe the product has.
      return (
        (variant_id != null
          ? list.find((r) => r.product_variant_id === variant_id)
          : undefined) ??
        list.find((r) => r.product_variant_id == null) ??
        list[0]
      );
    };

    try {
      const touched = new Set<number>();
      const result = await client.$transaction(async (tx) => {
        const existing = await tx.production_orders.findMany({
          where: { store_id: sale.store_id, order_id: sale.id },
          select: {
            id: true,
            product_id: true,
            product_variant_id: true,
            recipe_id: true,
            status: true,
            planned_qty: true,
            due_date: true,
          },
        });
        const byKey = new Map(
          existing.map((o) => [keyOf(o.product_id, o.product_variant_id ?? null), o]),
        );
        const result: { id: number }[] = [];

        for (const [key, { product_id, variant_id, qty, items }] of planned) {
          const current = byKey.get(key);
          if (!current) {
            const recipe = recipeFor(product_id, variant_id);
            const recipe_id = recipe?.id;
            if (!recipe || !recipe_id) {
              this.logger.warn(
                `Sale #${sale.id}: product #${product_id} has no active recipe; no production order created`,
              );
              continue;
            }
            const order_number = await this.sequences.next(tx, sale.store_id);
            const requirements = await this.plannedRequirements(tx, { recipe, qty, items });
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
                // S1: born with its planned supplies (consumed_qty = 0).
                lines: { create: plannedLinesCreate(requirements) },
              },
              select: { id: true },
            });
            result.push(created);
            touched.add(created.id);
            continue;
          }
          result.push({ id: current.id });
          // A cancelled order stays cancelled: cancelling production is not
          // cancelling the sale, and only "Volver a iniciar" (restart) brings it
          // back. It still follows the sale's current quantity and delivery so
          // that the restart starts from what the sale says today.
          if (current.status === 'cancelled') {
            if (
              Number(current.planned_qty) !== qty ||
              current.due_date?.getTime() !== due_date.getTime()
            ) {
              await tx.production_orders.updateMany({
                where: { id: current.id, status: 'cancelled' },
                data: {
                  planned_qty: new Prisma.Decimal(qty),
                  due_date,
                  updated_at: new Date(),
                },
              });
              touched.add(current.id);
            }
            continue;
          }
          if (
            current.status === 'draft' &&
            (Number(current.planned_qty) !== qty ||
              current.due_date?.getTime() !== due_date.getTime())
          ) {
            const { count } = await tx.production_orders.updateMany({
              where: { id: current.id, status: 'draft' },
              data: {
                planned_qty: new Prisma.Decimal(qty),
                due_date,
                updated_at: new Date(),
              },
            });
            // S1: a new quantity means new planned supplies (draft only, and never
            // over lines that already consumed).
            if (count === 1 && Number(current.planned_qty) !== qty) {
              // The order's own recipe, else the one a new order would pick.
              const recipe =
                recipesByProduct.get(product_id)?.find((r) => r.id === current.recipe_id) ??
                recipeFor(product_id, variant_id);
              if (recipe) {
                await replacePlannedLines(
                  tx,
                  current.id,
                  await this.plannedRequirements(tx, { recipe, qty, items }),
                );
              }
            }
            touched.add(current.id);
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
          touched.add(current.id);
        }
        return result;
      });
      await this.emitCommitted(client, [...touched]);
      return result;
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
