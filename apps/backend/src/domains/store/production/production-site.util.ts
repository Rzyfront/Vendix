import type { Prisma } from '@prisma/client';
import {
  storeIsManufacturing,
  storeIsRestaurant,
} from '../../../common/helpers/industry-capabilities.helper';

/**
 * Where a producible product is made, and which screen owns its production
 * orders: `kitchen` = Producción (restaurant), `plant` = Planta (manufacturing).
 */
export type ProductionSite = 'kitchen' | 'plant';

export const PRODUCTION_SITES: readonly ProductionSite[] = ['kitchen', 'plant'];

export function isProductionSite(value: unknown): value is ProductionSite {
  return typeof value === 'string' && (PRODUCTION_SITES as readonly string[]).includes(value);
}

type Industries = readonly string[] | string[] | null | undefined;

/**
 * A store with BOTH restaurant and manufacturing must say, per producible
 * product, where it is made (the industry cannot decide it).
 */
export function productionSiteRequired(industries: Industries): boolean {
  const list = (industries ?? []) as string[];
  return storeIsRestaurant(list) && storeIsManufacturing(list);
}

export interface ResolvedProductionSite {
  site: ProductionSite;
  /**
   * True when the store needs the product to declare it (restaurant AND
   * manufacturing) and it does not: the sale is not broken, the conservative
   * fallback is the kitchen and the product shows "Elige dónde se produce".
   */
  missing: boolean;
}

/**
 * The product's own site wins. Without it the store industry decides:
 * manufacturing only → plant; restaurant only (or anything else) → kitchen;
 * both → kitchen as fallback, flagged as `missing`.
 */
export function resolveProductionSite(params: {
  industries: Industries;
  productSite?: string | null;
}): ResolvedProductionSite {
  if (isProductionSite(params.productSite)) {
    return { site: params.productSite, missing: false };
  }
  const list = (params.industries ?? []) as string[];
  const restaurant = storeIsRestaurant(list);
  const manufacturing = storeIsManufacturing(list);
  if (manufacturing && !restaurant) return { site: 'plant', missing: false };
  return { site: 'kitchen', missing: restaurant && manufacturing };
}

/**
 * Orders a screen owns. Rows written before `production_site` existed (NULL)
 * keep the screen they had: Planta = manual orders with a consecutive
 * (`order_number`, source not `order`); Producción = everything else
 * (restaurant manual orders have no consecutive; legacy sale-born orders were
 * restaurant sales). The two predicates are complementary: no order is in both.
 */
export function productionSiteWhere(site: ProductionSite): Prisma.production_ordersWhereInput {
  if (site === 'plant') {
    return {
      OR: [
        { production_site: 'plant' },
        {
          production_site: null,
          order_number: { not: null },
          OR: [{ source: null }, { source: { not: 'order' } }],
        },
      ],
    };
  }
  return {
    OR: [
      { production_site: 'kitchen' },
      { production_site: null, order_number: null },
      { production_site: null, source: 'order' },
    ],
  };
}
