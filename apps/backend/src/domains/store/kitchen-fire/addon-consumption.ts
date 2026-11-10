import type { Prisma } from '@prisma/client';
import type { RecipesService } from '../recipes/recipes.service';
import type { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import {
  type BatchClaimPool,
  type SellableStockValidator,
  probeConsumableStock,
  resolveBatchComponent,
  resolveBatchLines,
} from '../recipes/batch-bom-resolver';

/**
 * Add-on expansion shared by every path that consumes a sold add-on
 * (QUI-1000): the kitchen fire (POS payment, table flows, agenda "send to
 * kitchen") and the scheduled-order production start. Keeping one expansion
 * is what makes the consumption identical whichever path runs first.
 */

/** One consumption line: leaf component x quantity in its stock unit. */
export interface ConsumptionLine {
  product_id: number;
  variant_id: number | null;
  quantity: number;
}

/** Order line with what the expansion needs. */
export interface ProductionLineInput {
  id: number;
  product_id: number | null;
  product_variant_id: number | null;
  quantity: number;
  product_type: string | null;
  inventory_consumed: boolean;
  /**
   * The add-ons of this line were already consumed (`order_items.addons_consumed_at`,
   * claimed by the kitchen fire or by an earlier start). Skipped so they are
   * never deducted twice.
   */
  addons_consumed?: boolean;
  options: Array<{
    scope: 'per_unit' | 'per_line';
    component_type: 'ingredient' | 'recipe' | 'product';
    component_product_id: number;
    component_variant_id: number | null;
    quantity: number;
  }>;
}

/** Explodes a recipe (id) for N units of its product. */
export type Explode = (
  recipe_id: number,
  units: number,
) => Promise<Array<{ component_product_id: number; quantity: number }>>;
/** Active recipe of the product (exact variant or the base one). */
export type FindRecipe = (product_id: number, variant_id: number | null) => Promise<number | null>;
/**
 * Explodes the recipe of an add-on component. Lets the caller apply the batch
 * rule (the preparation's own stock first) to the component itself; defaults
 * to `explode(recipe_id, units)`.
 */
export type ExplodeComponent = (
  product_id: number,
  recipe_id: number,
  units: number,
) => Promise<Array<{ component_product_id: number; quantity: number }>>;

/**
 * Single expansion (S4): base recipe of the line (if `prepared` with a recipe
 * and not yet consumed) + add-ons (ingredient x quantity; preparation through
 * its recipe; sellable product as is). `per_unit` x line quantity, `per_line`
 * x 1. Returns the consolidated consumption and the lines whose dish ends up
 * consumed (marked so delivery does not deduct it again).
 */
export async function expandProduction(
  lines: ProductionLineInput[],
  findRecipe: FindRecipe,
  explode: Explode,
  explodeComponent?: ExplodeComponent,
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

    if (line.addons_consumed) continue;
    for (const option of line.options) {
      const units = option.quantity * (option.scope === 'per_unit' ? qty : 1);
      if (option.component_type === 'recipe') {
        const recipe_id = await findRecipe(option.component_product_id, option.component_variant_id);
        if (recipe_id) {
          const leaves = explodeComponent
            ? await explodeComponent(option.component_product_id, recipe_id, units)
            : await explode(recipe_id, units);
          for (const leaf of leaves) add(leaf.component_product_id, null, leaf.quantity);
          continue;
        }
      }
      add(option.component_product_id, option.component_variant_id, units);
    }
  }

  // Stock in whole units of the minimum unit, same as the kitchen fire.
  const consumption = [...totals.values()]
    .map((c) => ({ ...c, quantity: Math.round(c.quantity) }))
    .filter((c) => c.quantity > 0);
  return { consumption, consumed_line_ids };
}

/**
 * Resolvers for one consuming operation (one fire or one production start).
 * `pool` is shared by every line of the operation, so two lines cannot take
 * the same batch stock (QUI-990 / QUI-1000). Stock is read through the same
 * source the no-overselling guard uses.
 */
export function createBatchAwareExploders(args: {
  recipes: Pick<RecipesService, 'explodeBom'>;
  stockValidator: SellableStockValidator;
  /** Picks the location the line consumes from (caps the batch stock taken). */
  stockLevelManager: Pick<StockLevelManager, 'getDefaultLocationForProduct'>;
  client: Prisma.TransactionClient;
  pool: BatchClaimPool;
}): { findRecipe: FindRecipe; explode: Explode; explodeComponent: ExplodeComponent } {
  const { recipes, client, pool } = args;
  const deps = {
    getAvailable: (product_id: number) =>
      probeConsumableStock(args.stockValidator, args.stockLevelManager, product_id, client),
    explode: (recipe_id: number, units: number) =>
      recipes.explodeBom(recipe_id, { [recipe_id]: units }, client, { stopAtBatchProduced: true }),
  };
  const findRecipe: FindRecipe = async (product_id, variant_id) => {
    const rows = await client.recipes.findMany({
      where: { product_id, is_active: true },
      select: { id: true, product_variant_id: true },
    });
    const exact = variant_id != null ? rows.find((r) => r.product_variant_id === variant_id) : undefined;
    return (exact ?? rows.find((r) => r.product_variant_id == null))?.id ?? null;
  };
  const explode: Explode = async (recipe_id, units) =>
    resolveBatchLines(await deps.explode(recipe_id, units), 1, pool, deps);
  const explodeComponent: ExplodeComponent = async (product_id, recipe_id, units) => {
    const product = await client.products.findFirst({
      where: { id: product_id },
      select: { is_batch_produced: true },
    });
    if (product?.is_batch_produced) return resolveBatchComponent(product_id, recipe_id, units, pool, deps);
    return explode(recipe_id, units);
  };
  return { findRecipe, explode, explodeComponent };
}
