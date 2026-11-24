import {
  ModuleIndustryRule,
  normalizeModuleIndustries,
} from '../../../../../shared/constants/module-industries';
import { AnalyticsCategoryId, AnalyticsView } from './analytics-registry';

/**
 * Mapa vista de analítica → industrias (agenda unificada F4), gemelo de
 * `reports/config/report-industries.ts`. Lo que no aparece es transversal.
 * Solo decide qué tarjetas y pestañas pinta Analíticas; la autorización está
 * en el backend.
 */
export const ANALYTICS_CATEGORY_INDUSTRIES: Readonly<
  Partial<Record<AnalyticsCategoryId, ModuleIndustryRule>>
> = {
  // Igual que `analytics_dispatch` en MODULE_INDUSTRIES.
  dispatch: ['retail'],
};

export const ANALYTICS_VIEW_INDUSTRIES: Readonly<Record<string, ModuleIndustryRule>> = {
  // Insumos por receta: industrias con ingredientes.
  inventory_ingredient_consumption: ['restaurant', 'manufacturing'],
};

function allows(rule: ModuleIndustryRule, industries: readonly string[] | null | undefined): boolean {
  if (rule === 'all') return true;
  return normalizeModuleIndustries(industries).some((industry) => rule.includes(industry));
}

/** `true` si la vista aplica a la tienda (una tienda sin industrias = retail). */
export function isAnalyticsViewVisibleForIndustries(
  view: Pick<AnalyticsView, 'key' | 'category'>,
  industries: readonly string[] | null | undefined,
): boolean {
  const rule =
    ANALYTICS_VIEW_INDUSTRIES[view.key] ??
    ANALYTICS_CATEGORY_INDUSTRIES[view.category] ??
    'all';
  return allows(rule, industries);
}

/** `true` si la categoría de analítica aplica a la tienda. */
export function isAnalyticsCategoryVisibleForIndustries(
  categoryId: AnalyticsCategoryId,
  industries: readonly string[] | null | undefined,
): boolean {
  return allows(ANALYTICS_CATEGORY_INDUSTRIES[categoryId] ?? 'all', industries);
}
