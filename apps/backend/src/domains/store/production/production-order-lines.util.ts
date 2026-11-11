import { Prisma } from '@prisma/client';
import {
  createBatchAwareExploders,
  expandProduction,
  type ProductionLineInput,
} from '../kitchen-fire/addon-consumption';

/**
 * Planned vs consumed supplies of a production order (`production_order_lines`).
 * Shared by the restaurant engine, the sale link and Planta so the scaling,
 * the plan and the accumulation have ONE shape.
 */

/** One required component with the quantity in its stock unit. */
export interface ComponentRequirement {
  component_product_id: number;
  quantity: number;
}

/** What the scaling needs of a recipe (a subset of `recipes` + `recipe_items`). */
export interface RecipeForRequirements {
  waste_percent?: unknown;
  yield_quantity?: unknown;
  items: Array<{
    component_product_id: number;
    quantity: any;
    waste_percent?: any;
    waste_mode?: string | null;
    waste_absolute?: any;
  }>;
}

/** Recipe columns the plan needs, for a `select` that reads the recipe alone. */
export const RECIPE_REQUIREMENT_SELECT = {
  id: true,
  waste_percent: true,
  yield_quantity: true,
  items: {
    select: {
      component_product_id: true,
      quantity: true,
      waste_percent: true,
      waste_mode: true,
      waste_absolute: true,
    },
  },
} satisfies Prisma.recipesSelect;

/** Consumption of one component during a `complete()` (stock unit). */
export interface LineConsumption {
  component_product_id: number;
  consumed_qty: number;
  cost_snapshot: { unit_cost: number; total_cost: number } | null;
}

/** Sale line with the add-ons the plan expands (same shape `consumeLinkedAddons` reads). */
export interface SaleLineForPlan {
  id: number;
  product_id: number | null;
  product_variant_id: number | null;
  quantity: unknown;
  order_item_options?: Array<{
    scope: 'per_unit' | 'per_line';
    component_type: 'ingredient' | 'recipe' | 'product';
    component_product_id: number;
    component_variant_id: number | null;
    quantity: unknown;
  }>;
}

/** The `select` of the add-ons of a sale line, as `consumeLinkedAddons` reads them. */
export const ADDON_OPTIONS_SELECT = {
  select: {
    scope: true,
    component_type: true,
    component_product_id: true,
    component_variant_id: true,
    quantity: true,
  },
} as const;

/**
 * Consumed quantity for a single `recipe_items` line, scaled to the produced
 * quantity and net of line + recipe waste. The no-overselling pre-check, the
 * real consumption and the planned lines all compute the EXACT same number.
 *
 * Recipe lines are expressed per recipe batch (`recipe.yield_quantity`), so
 * the scale factor is `producedQty / yield_quantity`. A missing/invalid/<=0
 * yield falls back to 1. Absolute waste is per batch and scales with the
 * factor. Rounding happens only once, at the very end.
 */
export function computeConsumedQty(
  item: {
    quantity: any;
    waste_percent?: any;
    waste_mode?: string | null;
    waste_absolute?: any;
  },
  recipeWastePct: number,
  producedQty: number,
  yieldQuantity?: any,
): number {
  const baseQty = Number(item.quantity);
  if (!Number.isFinite(baseQty) || baseQty <= 0) return 0;

  const yieldQty = Number(yieldQuantity);
  const safeYield = Number.isFinite(yieldQty) && yieldQty > 0 ? yieldQty : 1;
  const factor = producedQty / safeYield;

  const lineWastePct = Number(item.waste_percent || 0);
  const wasteMode = item.waste_mode ?? 'percent';
  if (wasteMode === 'absolute') {
    const wasteAbs = Number(item.waste_absolute ?? 0);
    const safeWasteAbs = Number.isFinite(wasteAbs) ? wasteAbs : 0;
    const withLine = baseQty + safeWasteAbs;
    return Math.round(withLine * factor * (1 + recipeWastePct / 100));
  }
  const multiplier = (1 + lineWastePct / 100) * (1 + recipeWastePct / 100);
  return Math.round(baseQty * factor * multiplier);
}

/** Required quantity per component to produce `qty` units (waste and yield applied). */
export function computeComponentRequirements(
  recipe: RecipeForRequirements,
  qty: number,
): ComponentRequirement[] {
  const recipeWastePct = Number(recipe.waste_percent || 0);
  return recipe.items.map((item) => ({
    component_product_id: item.component_product_id,
    quantity: computeConsumedQty(item, recipeWastePct, qty, recipe.yield_quantity),
  }));
}

/** Sums requirements of the same component, keeping first-seen order. */
export function mergeRequirements(...parts: ComponentRequirement[][]): ComponentRequirement[] {
  const merged = new Map<number, ComponentRequirement>();
  for (const part of parts) {
    for (const r of part) {
      const current = merged.get(r.component_product_id);
      if (current) current.quantity += r.quantity;
      else merged.set(r.component_product_id, { ...r });
    }
  }
  return [...merged.values()];
}

/** Dependencies the add-on expansion needs (the same ones `consumeLinkedAddons` uses). */
export interface AddonExpansionDeps {
  recipes: Parameters<typeof createBatchAwareExploders>[0]['recipes'];
  stockValidator: Parameters<typeof createBatchAwareExploders>[0]['stockValidator'];
  stockLevelManager: Parameters<typeof createBatchAwareExploders>[0]['stockLevelManager'];
  client: Prisma.TransactionClient;
}

/**
 * Planned requirement of the add-ons of the sale lines an order serves, through
 * the SAME expansion `consumeLinkedAddons` consumes with (`expandProduction`
 * over batch-aware exploders), so plan and consumption have the same shape.
 * The base recipe is the order's own plan: only the add-ons are expanded here.
 */
export async function expandAddonRequirements(
  deps: AddonExpansionDeps,
  items: SaleLineForPlan[],
): Promise<ComponentRequirement[]> {
  const inputs: ProductionLineInput[] = [];
  for (const item of items) {
    const options = item.order_item_options ?? [];
    if (options.length === 0) continue;
    inputs.push({
      id: item.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id,
      quantity: Number(item.quantity),
      product_type: null,
      inventory_consumed: true,
      addons_consumed: false,
      options: options.map((o) => ({ ...o, quantity: Number(o.quantity) })),
    });
  }
  if (inputs.length === 0) return [];
  const resolvers = createBatchAwareExploders({ ...deps, pool: new Map() });
  const { consumption } = await expandProduction(
    inputs,
    resolvers.findRecipe,
    resolvers.explode,
    resolvers.explodeComponent,
  );
  return mergeRequirements(
    consumption.map((c) => ({ component_product_id: c.product_id, quantity: c.quantity })),
  );
}

/** `production_order_lines` rows for a plan (consumed_qty defaults to 0). */
export function plannedLineRows(order_id: number, requirements: ComponentRequirement[]) {
  return requirements.map((r, index) => ({
    order_id,
    component_product_id: r.component_product_id,
    planned_qty: new Prisma.Decimal(r.quantity),
    sort_order: index,
  }));
}

/** Nested `lines.create` of a new order: the same rows without the order id. */
export function plannedLinesCreate(requirements: ComponentRequirement[]) {
  return requirements.map((r, index) => ({
    component_product_id: r.component_product_id,
    planned_qty: new Prisma.Decimal(r.quantity),
    sort_order: index,
  }));
}

/**
 * Replaces the planned lines of ONE order (`WHERE order_id`), like Planta does
 * when its planned quantity changes. Only while nothing was consumed: a line
 * with consumption is real data and is never rebuilt. Returns whether it ran.
 */
export async function replacePlannedLines(
  tx: Prisma.TransactionClient,
  order_id: number,
  requirements: ComponentRequirement[],
): Promise<boolean> {
  const consumed = await tx.production_order_lines.count({
    where: { order_id, consumed_qty: { gt: 0 } },
  });
  if (consumed > 0) return false;
  await tx.production_order_lines.deleteMany({ where: { order_id } });
  if (requirements.length > 0) {
    await tx.production_order_lines.createMany({ data: plannedLineRows(order_id, requirements) });
  }
  return true;
}

/** Folds the consumptions of the same component (recipe item + add-on) into one entry. */
function mergeConsumptions(consumptions: LineConsumption[]): LineConsumption[] {
  const groups = new Map<number, LineConsumption[]>();
  for (const c of consumptions) {
    const list = groups.get(c.component_product_id) ?? [];
    list.push(c);
    groups.set(c.component_product_id, list);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const total = group.reduce((sum, c) => sum + Number(c.cost_snapshot?.total_cost ?? 0), 0);
    const qty = group.reduce((sum, c) => sum + c.consumed_qty, 0);
    return {
      component_product_id: group[0].component_product_id,
      consumed_qty: qty,
      cost_snapshot: {
        unit_cost: qty > 0 ? total / qty : 0,
        total_cost: total,
      },
    };
  });
}

/**
 * Accumulates consumption and cost per line (planned vs consumed) inside the
 * `complete()` transaction. An order with no lines (created before lines
 * existed) first gets its planned lines from `plannedFallback`. A consumed
 * component with no line gets one (planned = consumed).
 */
export async function persistConsumptionLines(
  tx: Prisma.TransactionClient,
  order_id: number,
  consumptions: LineConsumption[],
  plannedFallback: ComponentRequirement[],
): Promise<void> {
  let lines = await tx.production_order_lines.findMany({ where: { order_id } });
  if (lines.length === 0 && plannedFallback.length > 0) {
    await tx.production_order_lines.createMany({
      data: plannedLineRows(order_id, plannedFallback),
    });
    lines = await tx.production_order_lines.findMany({ where: { order_id } });
  }
  const byComponent = new Map(lines.map((l) => [l.component_product_id, l]));

  for (const c of mergeConsumptions(consumptions)) {
    const total = Number(c.cost_snapshot?.total_cost ?? 0);
    const existing = byComponent.get(c.component_product_id);
    const entry = {
      quantity: c.consumed_qty,
      unit_cost: Number(c.cost_snapshot?.unit_cost ?? 0),
      total_cost: total,
      at: new Date().toISOString(),
    };
    if (!existing) {
      await tx.production_order_lines.create({
        data: {
          order_id,
          component_product_id: c.component_product_id,
          planned_qty: new Prisma.Decimal(c.consumed_qty),
          consumed_qty: new Prisma.Decimal(c.consumed_qty),
          unit_cost: new Prisma.Decimal(
            (c.consumed_qty > 0 ? total / c.consumed_qty : 0).toFixed(4),
          ),
          total_cost: new Prisma.Decimal(total.toFixed(4)),
          cost_snapshot: { entries: [entry] },
        },
      });
      continue;
    }
    const consumed = Number(existing.consumed_qty) + c.consumed_qty;
    const totalCost = Number(existing.total_cost ?? 0) + total;
    const previous: Prisma.InputJsonValue[] =
      (existing.cost_snapshot as { entries?: Prisma.InputJsonValue[] } | null)?.entries ?? [];
    await tx.production_order_lines.update({
      where: { id: existing.id },
      data: {
        consumed_qty: new Prisma.Decimal(consumed),
        total_cost: new Prisma.Decimal(totalCost.toFixed(4)),
        unit_cost: new Prisma.Decimal((consumed > 0 ? totalCost / consumed : 0).toFixed(4)),
        cost_snapshot: { entries: [...previous, entry] },
        updated_at: new Date(),
      },
    });
  }
}
