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
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { ScheduledOrdersService } from './scheduled-orders.service';

type Tx = Prisma.TransactionClient;

/** Una línea de consumo: componente hoja × cantidad en su unidad de stock. */
export interface ConsumptionLine {
  product_id: number;
  variant_id: number | null;
  quantity: number;
}

/** Línea de orden con lo que la expansión necesita. */
export interface ProductionLineInput {
  id: number;
  product_id: number | null;
  product_variant_id: number | null;
  quantity: number;
  product_type: string | null;
  inventory_consumed: boolean;
  options: Array<{
    scope: 'per_unit' | 'per_line';
    component_type: 'ingredient' | 'recipe' | 'product';
    component_product_id: number;
    component_variant_id: number | null;
    quantity: number;
  }>;
}

/** Explota una receta (id) para N unidades de su producto. */
type Explode = (recipe_id: number, units: number) => Promise<Array<{ component_product_id: number; quantity: number }>>;
/** Receta activa del producto (variante exacta o la base). */
type FindRecipe = (product_id: number, variant_id: number | null) => Promise<number | null>;

/**
 * Expansión única (S4): receta base de la línea (si es `prepared` con receta
 * y aún no se consumió) + adiciones (insumo × cantidad; preparación vía su
 * receta; producto vendible tal cual). `per_unit` × cantidad de la línea,
 * `per_line` × 1. Devuelve el consumo consolidado y las líneas cuyo plato
 * queda consumido (se marcan para que la entrega no lo descuente otra vez).
 */
export async function expandProduction(
  lines: ProductionLineInput[],
  findRecipe: FindRecipe,
  explode: Explode,
): Promise<{ consumption: ConsumptionLine[]; consumed_line_ids: number[] }> {
  const totals = new Map<string, ConsumptionLine>();
  const add = (product_id: number, variant_id: number | null, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const key = `${product_id}:${variant_id ?? 'base'}`;
    const current = totals.get(key);
    if (current) current.quantity += quantity;
    else totals.set(key, { product_id, variant_id, quantity });
  };
  const consumed_line_ids: number[] = [];

  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) continue;

    if (line.product_id && line.product_type === 'prepared' && !line.inventory_consumed) {
      const recipe_id = await findRecipe(line.product_id, line.product_variant_id);
      if (recipe_id) {
        for (const leaf of await explode(recipe_id, qty)) add(leaf.component_product_id, null, leaf.quantity);
        consumed_line_ids.push(line.id);
      }
    }

    for (const option of line.options) {
      const units = option.quantity * (option.scope === 'per_unit' ? qty : 1);
      if (option.component_type === 'recipe') {
        const recipe_id = await findRecipe(option.component_product_id, option.component_variant_id);
        if (recipe_id) {
          for (const leaf of await explode(recipe_id, units)) add(leaf.component_product_id, null, leaf.quantity);
          continue;
        }
      }
      add(option.component_product_id, option.component_variant_id, units);
    }
  }

  // Stock en unidades enteras de la unidad mínima, igual que el disparo a cocina.
  const consumption = [...totals.values()]
    .map((c) => ({ ...c, quantity: Math.round(c.quantity) }))
    .filter((c) => c.quantity > 0);
  return { consumption, consumed_line_ids };
}

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

  private exploder(client?: Tx): Explode {
    return (recipe_id, units) => this.recipes.explodeBom(recipe_id, { [recipe_id]: units }, client);
  }

  private async loadLines(client: Tx, store_id: number, order_id: number): Promise<ProductionLineInput[]> {
    const items = await client.order_items.findMany({
      where: { order_id, cancelled_at: null, orders: { store_id } },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        quantity: true,
        inventory_consumed_at_fire: true,
        inventory_committed: true,
        products: { select: { product_type: true } },
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
    return items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      quantity: Number(item.quantity),
      product_type: item.products?.product_type ?? null,
      inventory_consumed: !!item.inventory_consumed_at_fire || !!item.inventory_committed,
      options: item.order_item_options.map((o) => ({ ...o, quantity: Number(o.quantity) })),
    }));
  }

  /** Gancho de `ScheduledOrdersService` al pasar a `in_production`. */
  async start(tx: Tx, schedule: { id: number; store_id: number; order_id: number }) {
    const ctx = RequestContextService.getContext();
    const lines = await this.loadLines(tx, schedule.store_id, schedule.order_id);
    const { consumption, consumed_line_ids } = await expandProduction(
      lines,
      this.finder(tx),
      this.exploder(tx),
    );
    if (!consumption.length && !consumed_line_ids.length) return;

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
            users: { select: { first_name: true, last_name: true } },
            order_items: {
              where: { cancelled_at: null },
              select: {
                product_name: true,
                variant_attributes: true,
                quantity: true,
                order_item_options: {
                  select: { group_name: true, option_name: true, quantity: true, uom: true },
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
        customer_name: customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() : null,
        items: s.order.order_items.map((item) => ({
          product_name: item.product_name,
          variant_attributes: item.variant_attributes,
          quantity: Number(item.quantity),
          options: item.order_item_options.map((o) => ({ ...o, quantity: Number(o.quantity) })),
        })),
      });
    }

    // Insumos consolidados de lo que aún no entra a producción.
    const client = this.prisma.withoutScope() as unknown as Tx;
    const pending = schedules.filter((s) => s.status === 'scheduled');
    const lines: ProductionLineInput[] = [];
    for (const s of pending) lines.push(...(await this.loadLines(client, store_id, s.order_id)));
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
