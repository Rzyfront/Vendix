import {
  ModuleIndustry,
  ModuleIndustryRule,
  normalizeModuleIndustries,
} from '../../../../../shared/constants/module-industries';
import {
  ReportCategory,
  ReportCategoryId,
  ReportDefinition,
} from '../interfaces/report.interface';
import { REPORT_CATEGORIES, REPORT_DEFINITIONS } from './report-registry';

/**
 * Mapa reporte → industrias (agenda unificada F4).
 *
 * Reportes muestra solo lo que aplica a las industrias activas de la tienda.
 * Vive aquí, dentro del módulo, y no en `module-industries.ts` (compartido con
 * el backend y con la paridad byte a byte): estas reglas solo deciden qué
 * tarjetas y pestañas pinta Reportes. La autorización real sigue en backend
 * (`@IndustryModule` de cada controlador, p. ej. los reportes de hotel con
 * `hospitality_reservations`).
 *
 * Reglas (misma semántica que `MODULE_INDUSTRIES`):
 *   - Lo que no aparece aquí es transversal (`'all'`): ventas, caja, inventario
 *     general, compras, clientes, contabilidad, nómina, pagos…
 *   - Una lista = solo tiendas con alguna de esas industrias (OR: una tienda
 *     multindustria ve la unión).
 *   - La regla del reporte gana sobre la de su categoría.
 */
export const REPORT_CATEGORY_INDUSTRIES: Readonly<
  Partial<Record<ReportCategoryId, ModuleIndustryRule>>
> = {
  // Igual que `reports_dispatch` en MODULE_INDUSTRIES.
  dispatch: ['retail'],
  hospitality: ['hospitality'],
};

export const REPORT_INDUSTRIES: Readonly<Record<string, ModuleIndustryRule>> = {
  // Propinas atribuidas al mesero de la orden: solo existe en restaurante.
  'sales-tips-by-waiter': ['restaurant'],
  // Insumos consumidos por receta: las industrias con ingredientes
  // (`INDUSTRIES_SUPPORTING_INGREDIENTS`).
  'inventory-ingredient-consumption': ['restaurant', 'manufacturing'],
};

/** Regla efectiva de un reporte: la propia, si no la de su categoría, si no `'all'`. */
export function reportIndustryRule(
  report: Pick<ReportDefinition, 'id' | 'category'>,
): ModuleIndustryRule {
  return (
    REPORT_INDUSTRIES[report.id] ??
    REPORT_CATEGORY_INDUSTRIES[report.category] ??
    'all'
  );
}

function ruleAllows(
  rule: ModuleIndustryRule,
  industries: readonly ModuleIndustry[],
): boolean {
  return rule === 'all' || industries.some((industry) => rule.includes(industry));
}

/**
 * `true` si el reporte aplica a la tienda. Una tienda sin industrias se lee
 * como `['retail']`, igual que el menú (`normalizeModuleIndustries`).
 */
export function isReportVisibleForIndustries(
  report: Pick<ReportDefinition, 'id' | 'category'>,
  industries: readonly string[] | null | undefined,
): boolean {
  return ruleAllows(reportIndustryRule(report), normalizeModuleIndustries(industries));
}

/** Reportes que aplican a la tienda, en el orden del registro. */
export function reportsForIndustries(
  industries: readonly string[] | null | undefined,
  reports: readonly ReportDefinition[] = REPORT_DEFINITIONS,
): ReportDefinition[] {
  return reports.filter((report) => isReportVisibleForIndustries(report, industries));
}

/**
 * `true` si la categoría aplica a la tienda: su regla lo permite y conserva al
 * menos un reporte visible (una categoría vacía no se pinta).
 */
export function isReportCategoryVisibleForIndustries(
  categoryId: ReportCategoryId,
  industries: readonly string[] | null | undefined,
): boolean {
  const normalized = normalizeModuleIndustries(industries);
  const rule = REPORT_CATEGORY_INDUSTRIES[categoryId] ?? 'all';
  if (!ruleAllows(rule, normalized)) return false;
  const inCategory = REPORT_DEFINITIONS.filter((r) => r.category === categoryId);
  // Categorías sin definiciones en el registro (no hay hoy) se dejan pasar.
  return (
    inCategory.length === 0 ||
    inCategory.some((report) => ruleAllows(reportIndustryRule(report), normalized))
  );
}

/** Categorías que aplican a la tienda, en el orden del registro. */
export function reportCategoriesForIndustries(
  industries: readonly string[] | null | undefined,
  categories: readonly ReportCategory[] = REPORT_CATEGORIES,
): ReportCategory[] {
  return categories.filter((category) =>
    isReportCategoryVisibleForIndustries(category.id, industries),
  );
}
