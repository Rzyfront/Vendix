import type { Prisma } from '@prisma/client';
import type { BomExplosionLine } from './recipes.service';
import type { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import type { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';

/**
 * QUI-990 — turns the leaves of `explodeBom(..., { stopAtBatchProduced: true })`
 * into consumable lines. A leaf marked `batch_recipe_id` is a batch-produced
 * preparation: the sale takes what exists of its own stock first and
 * "produces" only the shortfall, exploding the preparation's recipe into
 * ingredients that are consumed at the same point (inline, as part of the
 * order). The explosion itself stays stock-independent, so per-recipe caches
 * remain valid; this resolver is the only place that reads stock.
 */

/** Quantity already promised to earlier lines of the same fire/start. */
export type BatchClaimPool = Map<number, number>;

/** A line ready to consume. `quantity` is ABSOLUTE (not per unit), unrounded. */
export interface ResolvedBomLine {
  component_product_id: number;
  quantity: number;
}

export interface BatchResolverDeps {
  /** Sellable stock of a product (same read the no-overselling guard uses). */
  getAvailable(productId: number): Promise<number>;
  /** `explodeBom(recipeId, { [recipeId]: units }, tx, { stopAtBatchProduced: true })`. */
  explode(recipeId: number, units: number): Promise<BomExplosionLine[]>;
}

const MAX_BATCH_DEPTH = 32;

export function hasBatchLines(
  lines: ReadonlyArray<Pick<BomExplosionLine, 'batch_recipe_id'>>,
): boolean {
  return lines.some((l) => l.batch_recipe_id != null);
}

/**
 * @param lines       Per-unit leaves (as returned by the explosion).
 * @param multiplier  Units of the root product being consumed.
 * @param pool        Claims shared across every line of one operation.
 */
export async function resolveBatchLines(
  lines: ReadonlyArray<BomExplosionLine>,
  multiplier: number,
  pool: BatchClaimPool,
  deps: BatchResolverDeps,
  depth = 0,
): Promise<ResolvedBomLine[]> {
  const out: ResolvedBomLine[] = [];
  for (const line of lines) {
    const needed = line.quantity * multiplier;
    if (line.batch_recipe_id == null || depth >= MAX_BATCH_DEPTH) {
      out.push({ component_product_id: line.component_product_id, quantity: needed });
      continue;
    }
    if (!(needed > 0)) continue;

    const productId = line.component_product_id;
    const claimed = pool.get(productId) ?? 0;
    const available = Math.max(0, (await deps.getAvailable(productId)) - claimed);
    const fromStock = Math.min(available, needed);
    if (fromStock > 0) {
      pool.set(productId, claimed + fromStock);
      out.push({ component_product_id: productId, quantity: fromStock });
    }
    const shortfall = needed - fromStock;
    if (shortfall > 0) {
      // The sale generates the missing production: explode the preparation's
      // recipe for the shortfall; nested batch products apply the same rule.
      const sub = await deps.explode(line.batch_recipe_id, shortfall);
      out.push(...(await resolveBatchLines(sub, 1, pool, deps, depth + 1)));
    }
  }
  return out;
}

/** The slice of `StockValidatorService` the stock probes read. */
export type SellableStockValidator = Pick<StockValidatorService, 'findInsufficientLines'>;

/**
 * Stock a batch leaf can really take. The sale consumes from ONE location, the
 * one `getDefaultLocationForProduct` picks (the sellable location with the most
 * available), so the store-wide sellable total is capped at that location's
 * available. Without a location to consume from there is no stock to take.
 */
export async function probeConsumableStock(
  validator: SellableStockValidator,
  locator: Pick<StockLevelManager, 'getDefaultLocationForProduct'>,
  productId: number,
  tx?: Prisma.TransactionClient,
): Promise<number> {
  const total = await probeSellableStock(validator, productId, tx);
  if (!(total > 0)) return 0;
  let locationId: number;
  try {
    locationId = await locator.getDefaultLocationForProduct(productId, undefined, tx);
  } catch {
    return 0;
  }
  return Math.min(total, await probeSellableStock(validator, productId, tx, locationId));
}

/**
 * Sellable stock of a product read through `StockValidatorService` (the guard's
 * own source): asking for an impossible quantity returns the real `available`.
 * An untracked product reports nothing, i.e. no stock of its own: the caller
 * falls back to exploding the recipe, as before QUI-990. With `locationId`,
 * only that location counts.
 */
export async function probeSellableStock(
  validator: SellableStockValidator,
  productId: number,
  tx?: Prisma.TransactionClient,
  locationId?: number,
): Promise<number> {
  const [row] = await validator.findInsufficientLines(
    [{ product_id: productId, quantity: Number.MAX_SAFE_INTEGER }],
    { tx, kind: 'ingredient', locationId },
  );
  return row ? Number(row.available) : 0;
}

/**
 * QUI-1000 — an add-on whose component is a batch-produced preparation takes
 * its own sellable stock first and explodes only the shortfall, the same rule
 * `resolveBatchLines` applies to the leaves of a recipe. Returns ABSOLUTE
 * quantities for `units` of the preparation: the stock part (the preparation
 * itself) plus the exploded ingredients of the shortfall.
 */
export async function resolveBatchComponent(
  productId: number,
  recipeId: number,
  units: number,
  pool: BatchClaimPool,
  deps: BatchResolverDeps,
): Promise<ResolvedBomLine[]> {
  const leaf: BomExplosionLine = {
    component_product_id: productId,
    quantity: 1,
    depth: 1,
    path_recipe_ids: [],
    batch_recipe_id: recipeId,
  };
  return resolveBatchLines([leaf], units, pool, deps);
}
