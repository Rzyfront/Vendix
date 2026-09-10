/**
 * Impuestos (tax_categories) — tipos del dominio fiscal de la tienda.
 *
 * Espejo de `price-tiers/interfaces/price-tier.interface.ts` adaptado al
 * contrato real del backend (`apps/backend/src/domains/store/taxes/`).
 *
 * HALLAZGOS DE VERIFICACIÓN contra el backend (v1, no asumir lo contrario):
 *  - `TaxCategoryQueryDto` NO tiene `is_active`: solo `page`, `limit`,
 *    `search` (+ `status`, `type`, `is_inclusive`, `is_compound`,
 *    `include_inactive`, que `findAll` ignora hoy). El servicio frontend solo
 *    envía `page/limit/search`.
 *  - `tax_type_enum` = iva|inc|ica|withholding|reteiva|reteica. NO existe
 *    `exento`: "exento" en Vendix es IVA con tasa 0 (ver `DEFAULT_TAXES` en
 *    `default-taxes-form.component.ts`: `{ name: 'IVA Exento', percentage: 0 }`).
 *    Filas sin `tax_type` se tratan como `iva` (skill `vendix-tax-typing`).
 *  - `tax_categories` NO tiene columna de estado ni de tasa: la tasa vive en
 *    `tax_rates` (fracción: 0.19 = 19%), `is_compound`/`priority` también.
 *    `is_inclusive` existe en AMBAS tablas; el cálculo usa asignación ?? tasa.
 *  - `CreateTaxCategoryDto` NO acepta tasas anidadas: recibe `rate` plano
 *    (porcentaje 0–100) y el servicio crea UNA `tax_rate` (`rate/100`).
 *    `PATCH :id` solo toca `tax_categories` (NO toca `tax_rates`, y campos
 *    como `rate`/`type`/`is_compound`/`sort_order` romperían el update de
 *    Prisma porque no son columnas de la categoría). v1 = tasa única por
 *    categoría; el modal edita la primera tasa solo en creación.
 */

/** Clasificación fiscal. Espeja `TaxFiscalType` del backend y `tax_type_enum`. */
export type TaxFiscalType =
  | 'iva'
  | 'inc'
  | 'ica'
  | 'withholding'
  | 'reteiva'
  | 'reteica';

/** Método de cálculo exigido por `CreateTaxCategoryDto.type` (sin default). */
export type TaxCalcType = 'percentage' | 'fixed';

/** Fila de `tax_rates` tal como la devuelve `GET /store/taxes` (include). */
export interface TaxRate {
  id: number;
  tax_category_id: number;
  store_id?: number | null;
  name: string;
  /** Fracción (0.19 = 19%). La UI siempre muestra porcentaje (×100). */
  rate: number | string;
  is_compound?: boolean | null;
  priority?: number | null;
  is_inclusive?: boolean | null;
}

/** Fila de `tax_categories` con sus tasas (`include: { tax_rates: true }`). */
export interface TaxCategory {
  id: number;
  store_id?: number | null;
  organization_id?: number | null;
  name: string;
  description?: string | null;
  /** `null`/ausente = IVA (convención `vendix-tax-typing`). */
  tax_type?: TaxFiscalType | null;
  is_inclusive?: boolean | null;
  tax_rates?: TaxRate[];
  /**
   * v1: el backend NO tiene columna de estado en `tax_categories`
   * (`TaxCategoryQueryDto.status` existe pero `findAll` lo ignora y `update`
   * lo rechazaría). Se declara opcional para cuando el backend lo agregue;
   * `taxIsActive()` defaultea a `true`.
   */
  is_active?: boolean;
}

export interface CreateTaxCategoryDto {
  name: string;
  description?: string;
  /** Requerido por el backend (sin default). v1 siempre `percentage`. */
  type: TaxCalcType;
  tax_type?: TaxFiscalType;
  /** Porcentaje en UI (19 = 19%). El backend lo guarda como fracción (/100). */
  rate: number;
  is_inclusive?: boolean;
  is_compound?: boolean;
  sort_order?: number;
}

/**
 * Campos seguros para `PATCH /store/taxes/:id`: solo columnas reales de
 * `tax_categories`. `rate`, `type`, `is_compound` y `sort_order` se excluyen
 * a propósito (viven en `tax_rates` o no son columnas; enviarlos rompería el
 * update de Prisma en el backend).
 */
export interface UpdateTaxCategoryDto {
  name?: string;
  description?: string;
  tax_type?: TaxFiscalType;
  is_inclusive?: boolean;
}

/** Query soportada de verdad por `findAll` (page/limit/search). */
export interface TaxCategoryQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export const TAX_FISCAL_TYPE_LABELS: Record<TaxFiscalType, string> = {
  iva: 'IVA',
  inc: 'INC (Impoconsumo)',
  ica: 'ICA',
  withholding: 'Retención',
  reteiva: 'ReteIVA',
  reteica: 'ReteICA',
};

export const TAX_FISCAL_TYPE_OPTIONS: { value: TaxFiscalType; label: string }[] =
  (Object.keys(TAX_FISCAL_TYPE_LABELS) as TaxFiscalType[]).map((value) => ({
    value,
    label: TAX_FISCAL_TYPE_LABELS[value],
  }));

/** Etiqueta fiscal con fallback a IVA cuando la fila viene sin tipo. */
export function taxFiscalLabel(taxType: TaxFiscalType | string | null | undefined): string {
  if (taxType && taxType in TAX_FISCAL_TYPE_LABELS) {
    return TAX_FISCAL_TYPE_LABELS[taxType as TaxFiscalType];
  }
  return TAX_FISCAL_TYPE_LABELS.iva;
}

/** Primera tasa de la categoría (v1: tasa única por categoría). */
export function taxFirstRate(category: TaxCategory): TaxRate | undefined {
  return category.tax_rates?.[0];
}

/** Tasa en porcentaje UI (19 = 19%) o `null` si no hay tasas. */
export function taxRatePercent(category: TaxCategory): number | null {
  const first = taxFirstRate(category);
  if (!first) return null;
  const fraction = Number(first.rate);
  if (!Number.isFinite(fraction)) return null;
  return Math.round(fraction * 10000) / 100;
}

/** `true` = precio ya trae el impuesto dentro. Gana la tasa, luego categoría. */
export function taxIsInclusive(category: TaxCategory): boolean {
  return (
    taxFirstRate(category)?.is_inclusive ?? category.is_inclusive ?? false
  );
}

/** v1: sin columna de estado en backend, toda categoría lee como activa. */
export function taxIsActive(category: TaxCategory): boolean {
  return category.is_active !== false;
}

/** "Exento" = tasa 0 (no existe `tax_type` exento en el backend). */
export function taxIsExempt(category: TaxCategory): boolean {
  return taxRatePercent(category) === 0;
}
