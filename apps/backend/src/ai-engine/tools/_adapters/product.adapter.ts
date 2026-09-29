import { DEFAULT_TOOL_VERSION } from '../interfaces/tool.interface';

/**
 * Adaptador de presentación del contrato `products` (T6, paso 15).
 *
 * Mudado desde `domains/products.tools.ts`: los mappers que convierten filas
 * del servicio dueño en el vocabulario que Vexi narra (`taxBreakdown`,
 * `effectiveTracking`, `variantLabel`) viven aquí, versionados, en vez de
 * inline en la factory.
 *
 * Reglas del adaptador:
 *
 * - `PRODUCT_ADAPTER_VERSION` implementa la versión del contrato de las tools
 *   (`version: '1'`): si el contrato sube de versión, el adaptador sube con
 *   él en la misma PR.
 * - Degradación honesta: si falta una columna esperada, el campo sale `null`
 *   (nunca un cero o un texto inventado) y el llamante decide si proseguir.
 *   `taxBreakdown` con `rate` ausente o no numérico devuelve `rate_pct: null`:
 *   afirmar "0%" sin dato sería inventar un impuesto.
 * - Migración que renombre columnas usadas por estos mappers actualiza
 *   adaptador + contrato + spec en la misma PR (ver specs `*.adapter.spec.ts`).
 */

export const PRODUCT_ADAPTER_VERSION: string = DEFAULT_TOOL_VERSION;

/** Número finito o `null`: `null`/`undefined`/basura colapsan a `null`. */
function toRateNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Impuestos de un producto a `{name, rate_pct}`. `rate_pct: null` cuando el
 * `rate` falta o no es numérico; `name: null` cuando falta el nombre. Nunca
 * inventa un 0% ni un nombre.
 */
export function taxBreakdown(
  assignments: any[] | undefined | null,
): Array<{ name: string | null; rate_pct: number | null }> {
  const rows: Array<{ name: string | null; rate_pct: number | null }> = [];
  for (const assignment of assignments ?? []) {
    for (const tax of assignment?.tax_categories?.tax_rates ?? []) {
      const rate = toRateNumber(tax?.rate);
      rows.push({
        name: tax?.name ?? null,
        rate_pct: rate === null ? null : round2(rate * 100),
      });
    }
  }
  return rows;
}

/**
 * Effective inventory tracking for a product/variant pair.
 * `track_inventory_override` is authoritative when set; `null` inherits.
 * See `vendix-product-variants`: this is the ONLY input that decides whether
 * stock is meaningful for a variant. A variant is never hidden or downgraded
 * just because its stock is 0.
 */
export function effectiveTracking(product: any, variant?: any): boolean {
  const override = variant?.track_inventory_override;
  return override === null || override === undefined
    ? product.track_inventory === true
    : override === true;
}

export function parseAttributes(
  attributes: unknown,
): Record<string, string> | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const entries = Object.entries(attributes as Record<string, unknown>).map(
    ([key, value]) => [key, String(value)] as const,
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

/** Human label for a variant when it has no explicit name (falls back to its attributes, then its SKU). */
export function variantLabel(variant: any): string {
  if (variant.name) return String(variant.name);
  const attributes = parseAttributes(variant.attributes);
  if (attributes) {
    return Object.entries(attributes)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }
  return String(variant.sku ?? `variante ${variant.id}`);
}
