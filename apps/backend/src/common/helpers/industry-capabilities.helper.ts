import type { industry_enum } from '@prisma/client';

/**
 * List of `industry_enum` values that support the `is_ingredient` product
 * capacity. Mirrors the frontend `INDUSTRIES_SUPPORTING_INGREDIENTS` constant
 * in `apps/frontend/src/app/shared/constants/industry-modules.constant.ts`.
 * Add new entries here when a new industry opts into the ingredient
 * capacity; downstream services and DTOs will pick it up automatically.
 */
export const INDUSTRIES_SUPPORTING_INGREDIENTS: industry_enum[] = [
  'restaurant',
];

/**
 * Backend capability resolver: returns true when at least one of the given
 * store industries supports the `is_ingredient` capacity.
 *
 * OR semantics: a multi-industry store (e.g. hotel = service + restaurant)
 * is considered to support ingredients if ANY of its industries does.
 *
 * Used by:
 * - `products.service.ts` to gate the `is_ingredient` field on write
 *   (Fase 1: hidden when not supported).
 * - `purchase-orders.service.ts` to validate `order_type === 'ingredient'`
 *   (Fase 2).
 *
 * Safe to call with `null`/`undefined`/empty arrays; returns `false` then.
 */
export function storeIndustriesSupportIngredients(
  industries: industry_enum[] | string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) =>
    (INDUSTRIES_SUPPORTING_INGREDIENTS as readonly string[]).includes(
      industry as string,
    ),
  );
}
