import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  resolveStoreTimezone,
  zonedWallClockToUtc,
  localCivil,
} from '../../../common/utils/store-timezone.util';
import { RecipesService } from '../recipes/recipes.service';
import { BatchClaimPool, probeConsumableStock, resolveBatchLines } from '../recipes/batch-bom-resolver';
import {
  createBatchAwareExploders,
  expandProduction,
  type Explode,
  type FindRecipe,
  type ProductionLineInput,
} from '../kitchen-fire/addon-consumption';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { ScheduledOrdersService, kitchenPendingItemsWhere } from './scheduled-orders.service';
import { findProductionOrderForLine } from '../production/production-order-pairing.util';
import { emitProductionOrderUpdated } from '../production/production-order-events';

/** Production order of a sale line, as the agenda query selects it. */
type LinkedProductionOrder = {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  order_number: string | null;
  status: string;
};

type Tx = Prisma.TransactionClient;

export type { ConsumptionLine, ProductionLineInput } from '../kitchen-fire/addon-consumption';
export { expandProduction } from '../kitchen-fire/addon-consumption';

/**
 * Producción de pedidos programados. Al pasar a `in_production` consume en la
 * misma transacción receta base + adiciones (movimientos `consumption`) y
 * registra el costo de venta con el mismo asiento del disparo a cocina.
 * La venta no consume nada; cancelar después deja el consumo como merma.
 */
@Injectable()
export class ScheduledOrderProductionService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledOrderProductionService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly scheduledOrders: ScheduledOrdersService,
    private readonly recipes: RecipesService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly stockValidator: StockValidatorService,
    private readonly eventEmitter: EventEmitter2,
    private readonly kitchenFire: KitchenFireService,
  ) {}

  onModuleInit() {
    this.scheduledOrders.registerProductionStartHook((tx, schedule) => this.start(tx, schedule));
  }

  private finder(client: Tx): FindRecipe {
    return async (product_id, variant_id) => {
      const recipes = await client.recipes.findMany({
        where: { product_id, is_active: true },
        select: { id: true, product_variant_id: true },
      });
      const exact = variant_id != null ? recipes.find((r) => r.product_variant_id === variant_id) : undefined;
      return (exact ?? recipes.find((r) => r.product_variant_id == null))?.id ?? null;
    };
  }

  /**
   * QUI-990: batch-produced preparations consume their own stock first and only
   * the shortfall is exploded into ingredients. `pool` is shared by every line
   * of one `start()`, so two lines cannot take the same batch stock. Without a
   * pool (read-only consolidated list) the full, stock-independent explosion is
   * kept, as before.
   */
  private exploder(client: Tx | undefined, pool?: BatchClaimPool): Explode {
    if (!pool) {
      return (recipe_id, units) => this.recipes.explodeBom(recipe_id, { [recipe_id]: units }, client);
    }
    const explodeBatchAware = (recipe_id: number, units: number) =>
      this.recipes.explodeBom(recipe_id, { [recipe_id]: units }, client, { stopAtBatchProduced: true });
    const deps = {
      getAvailable: (product_id: number) =>
        probeConsumableStock(this.stockValidator, this.stockLevelManager, product_id, client),
      explode: explodeBatchAware,
    };
    return async (recipe_id, units) =>
      resolveBatchLines(await explodeBatchAware(recipe_id, units), 1, pool, deps);
  }

  /**
   * QUI-995: lines of a `production` product that already have a production
   * order are produced by that order (Planta), never by this schedule hook, so
   * they are excluded from `lines`; `linked` lists the orders to move along.
   */
  private async loadLines(
    client: Tx,
    store_id: number,
    order_id: number,
  ): Promise<{ lines: ProductionLineInput[]; linked: { id: number; status: string }[] }> {
    const items = await client.order_items.findMany({
      where: { order_id, cancelled_at: null, orders: { store_id } },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        quantity: true,
        inventory_consumed_at_fire: true,
        inventory_committed: true,
        addons_consumed_at: true,
        fulfillment_destination: true,
        products: { select: { product_type: true } },
        orders: {
          select: {
            production_orders: {
              where: { status: { not: 'cancelled' } },
              select: { id: true, product_id: true, product_variant_id: true, status: true },
            },
          },
        },
        order_item_options: {
          select: {
            scope: true,
            component_type: true,
            component_product_id: true,
            component_variant_id: true,
            quantity: true,
          },
        },
      },
    });
    const linkedOrders = new Map<number, { id: number; status: string }>();
    const isLinked = (item: (typeof items)[number]) => {
      if (item.fulfillment_destination !== 'production') return false;
      // One production order per product+variant: pair the line with ITS variant's order.
      const match = findProductionOrderForLine(item.orders?.production_orders ?? [], item);
      if (match) linkedOrders.set(match.id, { id: match.id, status: match.status as string });
      return !!match;
    };
    // QUI-999: the start consumes ONLY legacy lines (destination NULL). `kds`
    // lines were consumed at "Enviar a cocina", `stock` lines consume their
    // add-ons with their own commit, and `production` lines belong to a
    // production order. `isLinked` runs for every line to collect the orders.
    const lines = items
      .filter((item) => !isLinked(item) && item.fulfillment_destination == null)
      .map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      quantity: Number(item.quantity),
      product_type: item.products?.product_type ?? null,
      inventory_consumed: !!item.inventory_consumed_at_fire || !!item.inventory_committed,
      // Its own marker, not the fire flag (QUI-1000): a line fired before the
      // add-ons moved to the fire still has them pending for this start.
      addons_consumed: item.addons_consumed_at != null,
      options: item.order_item_options.map((o) => ({ ...o, quantity: Number(o.quantity) })),
    }));
    return { lines, linked: [...linkedOrders.values()] };
  }

  /**
   * "Enviar a cocina" desde la agenda (QUI-989): manda a KDS los platos
   * preparados del pedido que NO son de lote y aún no se enviaron, con el
   * mismo disparo de la venta normal (receta descontada, ticket de cocina).
   * El disparo descuenta también las adiciones de esos platos (QUI-1000) y el
   * agendamiento pasa a `in_production` en la MISMA transacción; el gancho de
   * inicio salta las adiciones ya descontadas (`addons_consumed_at`). Idempotente: el flag `inventory_consumed_at_fire` deja sin
   * candidatos al segundo intento. Solo tiendas restaurante (lo valida el
   * disparo con RESTAURANT_NOT_ENABLED).
   */
  async sendToKitchen(schedule_id: number) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const schedule = await this.prisma.order_fulfillment_schedules.findFirst({
      where: { id: schedule_id, store_id },
    });
    if (!schedule) throw new VendixHttpException(ErrorCodes.SCHED_NOT_FOUND);
    if (!['scheduled', 'in_production', 'ready'].includes(schedule.status)) {
      throw new VendixHttpException(ErrorCodes.SCHED_KITCHEN_NOT_ALLOWED);
    }

    const client = this.prisma.withoutScope() as unknown as Tx;
    const items = await client.order_items.findMany({
      where: kitchenPendingItemsWhere(schedule.order_id, store_id),
      select: { id: true },
    });
    if (!items.length) throw new VendixHttpException(ErrorCodes.SCHED_NOTHING_TO_SEND);

    // One transaction: the fire (ticket, dish recipe, add-ons) and the move to
    // `in_production` commit together. A failure in either leaves neither, so a
    // retry sees the same pending items instead of SCHED_NOTHING_TO_SEND.
    let updated: Awaited<ReturnType<ScheduledOrdersService['transitionInTx']>> | typeof schedule = schedule;
    const fired = await this.kitchenFire.fireOrderItems(
      { order_id: schedule.order_id, order_item_ids: items.map((i) => i.id) },
      {
        withinTx: async (tx, afterCommit) => {
          if (schedule.status === 'scheduled') {
            updated = await this.scheduledOrders.transitionInTx(
              tx,
              schedule.id,
              'in_production',
              afterCommit,
              'Enviado a cocina',
            );
          }
        },
      },
    );
    return { schedule: updated, fired };
  }

  /** Gancho de `ScheduledOrdersService` al pasar a `in_production`. */
  async start(tx: Tx, schedule: { id: number; store_id: number; order_id: number }) {
    const ctx = RequestContextService.getContext();
    const { lines, linked } = await this.loadLines(tx, schedule.store_id, schedule.order_id);
    // QUI-995: linked production orders start together with the schedule.
    const drafts = linked.filter((o) => o.status === 'draft').map((o) => o.id);
    let startedIds: number[] = [];
    if (drafts.length) {
      const { count } = await tx.production_orders.updateMany({
        where: { id: { in: drafts }, status: 'draft' },
        data: { status: 'in_progress', started_at: new Date(), updated_at: new Date() },
      });
      if (count > 0) startedIds = drafts;
    }
    // Live sync (QUI-1002): runs only after the commit, never breaks the start.
    const emitStarted = () => {
      if (!startedIds.length) return;
      void this.emitStartedProductionOrders(startedIds);
    };
    // Same marker as the kitchen fire: each line claims its add-ons before they
    // are deducted, so the fire and the start never both take them.
    for (const line of lines) {
      if (line.addons_consumed || line.options.length === 0) continue;
      const { count } = await tx.order_items.updateMany({
        where: { id: line.id, addons_consumed_at: null },
        data: { addons_consumed_at: new Date() },
      });
      if (count === 0) line.addons_consumed = true;
    }
    const resolvers = createBatchAwareExploders({
      recipes: this.recipes,
      stockValidator: this.stockValidator,
      stockLevelManager: this.stockLevelManager,
      client: tx,
      pool: new Map(),
    });
    const { consumption, consumed_line_ids } = await expandProduction(
      lines,
      resolvers.findRecipe,
      resolvers.explode,
      resolvers.explodeComponent,
    );
    if (!consumption.length && !consumed_line_ids.length) return startedIds.length ? emitStarted : undefined;

    const policy = await this.stockValidator.resolveInventoryPolicy(schedule.store_id, tx);
    const allowOveruse = policy.allowIngredientOveruse;
    let total_cost = 0;
    for (const line of consumption) {
      const location_id = await this.stockLevelManager.getDefaultLocationForProduct(
        line.product_id,
        line.variant_id ?? undefined,
        tx,
      );
      const result = await this.stockLevelManager.updateStock(
        {
          product_id: line.product_id,
          ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          location_id,
          quantity_change: -line.quantity,
          movement_type: 'consumption',
          reason: `Producción pedido programado (orden #${schedule.order_id})`,
          source_module: 'scheduled_order_production',
          user_id: ctx?.user_id ?? undefined,
          create_movement: true,
          validate_availability: !allowOveruse,
          allow_negative: allowOveruse,
        },
        tx,
      );
      total_cost += Number(result?.cost_snapshot?.total_cost ?? 0);
    }

    if (consumed_line_ids.length) {
      // El plato preparado ya se produjo: la entrega no lo descuenta otra vez
      // (mismo flag que el disparo a cocina) y su apartado de venta se libera.
      const lines_by_id = new Map(lines.map((l) => [l.id, l]));
      for (const id of consumed_line_ids) {
        const line = lines_by_id.get(id)!;
        await this.stockLevelManager.releaseReservationQuantity(
          'order',
          schedule.order_id,
          line.product_id!,
          line.product_variant_id,
          line.quantity,
          'cancelled',
          tx,
          { decrementOnHand: false },
        );
      }
      await tx.order_items.updateMany({
        where: { id: { in: consumed_line_ids }, inventory_consumed_at_fire: false },
        data: { inventory_consumed_at_fire: true },
      });
    }

    // El asiento se emite tras el commit (ver `ScheduledOrdersService.transition`).
    return () => {
      emitStarted();
      if (total_cost <= 0) return;
      this.eventEmitter.emit('scheduled_order.produced', {
        schedule_id: schedule.id,
        order_id: schedule.order_id,
        organization_id: ctx?.organization_id,
        store_id: schedule.store_id,
        total_cost,
        consumed_line_count: consumption.length,
        user_id: ctx?.user_id ?? undefined,
      });
    };
  }

  /** Reloads the started orders and emits `production_order.updated`; never throws. */
  private async emitStartedProductionOrders(ids: number[]): Promise<void> {
    try {
      const rows = await this.prisma.withoutScope().production_orders.findMany({
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
   * Lista de producción del día (hora de tienda): pedidos agrupados por
   * franja con sus adiciones y los insumos consolidados que falta producir.
   */
  async productionList(date: string) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const [y, m, d] = date.split('-').map(Number);
    const dayStart = zonedWallClockToUtc(y, m, d, 0, 0, 0, 0, timezone);
    const dayEnd = zonedWallClockToUtc(y, m, d + 1, 0, 0, 0, 0, timezone);

    const schedules = await this.prisma.order_fulfillment_schedules.findMany({
      where: { scheduled_start: { gte: dayStart, lt: dayEnd }, status: { not: 'cancelled' } },
      orderBy: { scheduled_start: 'asc' },
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
            customer_alias: true,
            users: { select: { first_name: true, last_name: true } },
            production_orders: {
              where: { status: { not: 'cancelled' } },
              select: { id: true, product_id: true, product_variant_id: true, order_number: true, status: true },
            },
            order_items: {
              where: { cancelled_at: null },
              select: {
                product_id: true,
                product_variant_id: true,
                fulfillment_destination: true,
                product_name: true,
                variant_attributes: true,
                quantity: true,
                notes: true,
                order_item_options: {
                  select: { group_name: true, option_name: true, quantity: true, uom: true, note: true },
                },
              },
            },
          },
        },
      },
    });

    const hhmm = (date_value: Date) => {
      const c = localCivil(date_value, timezone);
      return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
    };
    const slots = new Map<string, { start: Date; end: Date; local_start: string; local_end: string; orders: unknown[] }>();
    for (const s of schedules) {
      const key = `${s.scheduled_start.toISOString()}|${s.scheduled_end.toISOString()}`;
      if (!slots.has(key)) {
        slots.set(key, {
          start: s.scheduled_start,
          end: s.scheduled_end,
          local_start: hhmm(s.scheduled_start),
          local_end: hhmm(s.scheduled_end),
          orders: [],
        });
      }
      const customer = s.order.users;
      slots.get(key)!.orders.push({
        schedule_id: s.id,
        order_id: s.order.id,
        order_number: s.order.order_number,
        status: s.status,
        customer_name:
          (customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() : '') ||
          s.order.customer_alias?.trim() ||
          null,
        items: s.order.order_items.map((item) => {
          const linked =
            item.fulfillment_destination === 'production'
              ? findProductionOrderForLine<LinkedProductionOrder>(s.order.production_orders ?? [], item)
              : undefined;
          return {
          production_order: linked
            ? { id: linked.id, order_number: linked.order_number, status: linked.status }
            : null,
          product_name: item.product_name,
          variant_attributes: item.variant_attributes,
          quantity: Number(item.quantity),
          notes: item.notes ?? null,
          options: item.order_item_options.map((o) => ({ ...o, quantity: Number(o.quantity) })),
          };
        }),
      });
    }

    // Insumos consolidados de lo que aún no entra a producción.
    const client = this.prisma.withoutScope() as unknown as Tx;
    const pending = schedules.filter((s) => s.status === 'scheduled');
    const lines: ProductionLineInput[] = [];
    for (const s of pending) lines.push(...(await this.loadLines(client, store_id, s.order_id)).lines);
    const { consumption } = await expandProduction(lines, this.finder(client), this.exploder(client));
    const products = consumption.length
      ? await client.products.findMany({
          where: { id: { in: consumption.map((c) => c.product_id) }, store_id },
          select: { id: true, name: true, stock_unit: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const ingredients = consumption.map((c) => ({
      product_id: c.product_id,
      name: byId.get(c.product_id)?.name ?? `#${c.product_id}`,
      quantity: c.quantity,
      uom: byId.get(c.product_id)?.stock_unit ?? null,
    }));

    return { date, slots: [...slots.values()], ingredients };
  }
}
