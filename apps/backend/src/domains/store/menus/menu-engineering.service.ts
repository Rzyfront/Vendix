import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { parseDateRange } from '../analytics/utils/date.util';

const COMPLETED_STATES = ['delivered', 'finished'];

export type EngineeringQuadrant =
  | 'estrella'
  | 'caballo'
  | 'puzzle'
  | 'perro';

export interface EngineeringProduct {
  product_id: number;
  product_name: string;
  sku: string | null;
  base_price: number;
  recipe_unit_cost: number;
  units_sold: number;
  revenue: number;
  profit: number;
  margin_pct: number;
  popularity_pct: number;
  quadrant: EngineeringQuadrant;
  has_recipe: boolean;
}

export interface MenuEngineeringReport {
  from: string;
  to: string;
  total_products: number;
  totals: {
    units_sold: number;
    revenue: number;
    profit: number;
  };
  thresholds: { popularity_median: number; margin_median: number };
  counts: Record<EngineeringQuadrant, number>;
  groups: Record<EngineeringQuadrant, EngineeringProduct[]>;
}

/**
 * Menu Engineering (Restaurant Suite — Fase G).
 *
 * Implements the classic Boston Consulting Group matrix for menu items:
 *  - Estrella (Star):    high popularity × high margin
 *  - Caballo (Plowhorse): high popularity × low  margin
 *  - Puzzle (Question):  low  popularity × high margin
 *  - Perro (Dog):        low  popularity × low  margin
 *
 * Popularity is computed as the share of units sold inside the store in the
 * requested window, expressed as a 0–100 percent. Margin uses
 * recipe-driven cost (Fase B) when the product has an active recipe,
 * falling back to product.cost_price when no recipe exists.
 *
 * Thresholds are medians across the set so the quadrant split stays stable
 * for sparse data sets (avoids forcing equal halves when there are < 2
 * products — we still return the products, all marked "perro" / "estrella"
 * only when both medians collapse to a single value).
 */
@Injectable()
export class MenuEngineeringService {
  constructor(private prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return storeId;
  }

  async report(query: { from?: string; to?: string }): Promise<MenuEngineeringReport> {
    const storeId = this.requireStoreId();
    const { startDate, endDate } = parseDateRange({
      date_from: query.from,
      date_to: query.to,
    } as any);

    // 1) Pull sales aggregates for completed orders in the window.
    const sales = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        product_id: { not: null },
        orders: {
          store_id: storeId,
          state: { in: COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      _sum: { quantity: true, total_price: true },
    });

    const productIds = sales
      .map((r) => r.product_id)
      .filter((id): id is number => id !== null);

    if (productIds.length === 0) {
      return this.emptyReport(startDate, endDate);
    }

    // 2) Pull product basics + their (active) recipe.
    const products = (await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        cost_price: true,
        recipe: {
          where: { is_active: true },
          select: {
            id: true,
            yield_quantity: true,
            waste_percent: true,
            items: {
              select: {
                quantity: true,
                waste_percent: true,
                component_product: {
                  select: { cost_price: true },
                },
              },
            },
          },
        },
      },
    })) as Array<{
      id: number;
      name: string;
      sku: string | null;
      base_price: any;
      cost_price: any;
      recipe: {
        id: number;
        yield_quantity: any;
        waste_percent: any;
        items: Array<{
          quantity: any;
          waste_percent: any;
          component_product: { cost_price: any } | null;
        }>;
      } | null;
    }>;

    const productMap = new Map(products.map((p) => [p.id, p]));

    // 3) Build base rows.
    const rows: EngineeringProduct[] = sales
      .map((r) => {
        const pid = r.product_id as number;
        const product = productMap.get(pid);
        const units = Number(r._sum.quantity || 0);
        const revenue = Number(r._sum.total_price || 0);
        const recipeUnitCost = this.computeRecipeUnitCost(product?.recipe);
        const hasRecipe = !!product?.recipe;
        const costPerUnit =
          recipeUnitCost ?? Number(product?.cost_price ?? 0);
        const profit = revenue - costPerUnit * units;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        return {
          product_id: pid,
          product_name: product?.name ?? 'Desconocido',
          sku: product?.sku ?? null,
          base_price: Number(product?.base_price ?? 0),
          recipe_unit_cost: Number(costPerUnit.toFixed(4)),
          units_sold: units,
          revenue,
          profit: Number(profit.toFixed(2)),
          margin_pct: Number(margin.toFixed(2)),
          popularity_pct: 0, // filled after totalUnits computed
          quadrant: 'perro',
          has_recipe: hasRecipe,
        };
      })
      .filter((r) => r.units_sold > 0);

    const totalUnits = rows.reduce((s, r) => s + r.units_sold, 0);
    for (const r of rows) {
      r.popularity_pct = totalUnits > 0
        ? Number(((r.units_sold / totalUnits) * 100).toFixed(2))
        : 0;
    }

    // 4) Compute medians and classify.
    const popularityMed = this.median(rows.map((r) => r.popularity_pct));
    const marginMed = this.median(rows.map((r) => r.margin_pct));
    for (const r of rows) {
      r.quadrant = this.classify(r.popularity_pct, r.margin_pct, popularityMed, marginMed);
    }

    const groups: Record<EngineeringQuadrant, EngineeringProduct[]> = {
      estrella: [],
      caballo: [],
      puzzle: [],
      perro: [],
    };
    for (const r of rows) groups[r.quadrant].push(r);

    // Sort each group by revenue desc for the analytics UI.
    for (const k of Object.keys(groups) as EngineeringQuadrant[]) {
      groups[k].sort((a, b) => b.revenue - a.revenue);
    }

    return {
      from: startDate.toISOString(),
      to: endDate.toISOString(),
      total_products: rows.length,
      totals: {
        units_sold: totalUnits,
        revenue: Number(rows.reduce((s, r) => s + r.revenue, 0).toFixed(2)),
        profit: Number(rows.reduce((s, r) => s + r.profit, 0).toFixed(2)),
      },
      thresholds: { popularity_median: popularityMed, margin_median: marginMed },
      counts: {
        estrella: groups.estrella.length,
        caballo: groups.caballo.length,
        puzzle: groups.puzzle.length,
        perro: groups.perro.length,
      },
      groups,
    };
  }

  // ----------------------------------------------------------------- helpers

  private computeRecipeUnitCost(
    recipe:
      | {
          yield_quantity: any;
          waste_percent: any;
          items: Array<{
            quantity: any;
            waste_percent: any;
            component_product: { cost_price: any } | null;
          }>;
        }
      | null
      | undefined,
  ): number | null {
    if (!recipe || !recipe.items || recipe.items.length === 0) return null;
    const yieldQty = Number(recipe.yield_quantity);
    if (yieldQty <= 0) return null;
    const recipeWaste = Number(recipe.waste_percent ?? 0);
    const effectiveYield = yieldQty * (1 - recipeWaste / 100);
    if (effectiveYield <= 0) return null;
    let totalCost = 0;
    for (const item of recipe.items) {
      const qty = Number(item.quantity);
      const waste = Number(item.waste_percent ?? 0);
      const unitCost = Number(item.component_product?.cost_price ?? 0);
      const effective = qty * (1 + waste / 100) * unitCost;
      totalCost += effective;
    }
    return totalCost / effectiveYield;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
    }
    return Number(sorted[mid].toFixed(2));
  }

  private classify(
    popularity: number,
    margin: number,
    popMed: number,
    marginMed: number,
  ): EngineeringQuadrant {
    const highPop = popularity >= popMed;
    const highMargin = margin >= marginMed;
    if (highPop && highMargin) return 'estrella';
    if (highPop && !highMargin) return 'caballo';
    if (!highPop && highMargin) return 'puzzle';
    return 'perro';
  }

  private emptyReport(startDate: Date, endDate: Date): MenuEngineeringReport {
    return {
      from: startDate.toISOString(),
      to: endDate.toISOString(),
      total_products: 0,
      totals: { units_sold: 0, revenue: 0, profit: 0 },
      thresholds: { popularity_median: 0, margin_median: 0 },
      counts: { estrella: 0, caballo: 0, puzzle: 0, perro: 0 },
      groups: { estrella: [], caballo: [], puzzle: [], perro: [] },
    };
  }
}
