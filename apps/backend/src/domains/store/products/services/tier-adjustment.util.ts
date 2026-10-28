/**
 * Regla general de una tarifa: cómo ajusta el precio cuando el producto no
 * tiene un precio propio para ella (`product_price_tier_overrides`).
 *
 * MIRROR: este archivo existe byte a byte en
 *   apps/frontend/src/app/shared/services/pricing/tier-adjustment.util.ts
 * y `tier-adjustment.util.spec.ts` (backend) falla si divergen. No le agregues
 * imports: tiene que compilar igual en Nest y en Angular.
 *
 * El precio que entra (`unitBase`) está en la convención de IVA del producto
 * (incluido o adicional); el IVA se recalcula después sobre el resultado.
 */

export type TierAdjustmentType =
  | 'percent_discount'
  | 'percent_surcharge'
  | 'fixed_amount_discount'
  | 'fixed_amount_surcharge'
  | 'fixed_price';

export type TierAmountScope = 'per_unit' | 'per_package';

export const TIER_ADJUSTMENT_TYPES: readonly TierAdjustmentType[] = [
  'percent_discount',
  'percent_surcharge',
  'fixed_amount_discount',
  'fixed_amount_surcharge',
  'fixed_price',
];

export const TIER_AMOUNT_SCOPES: readonly TierAmountScope[] = [
  'per_unit',
  'per_package',
];

/** Campos de `price_tiers` que definen la regla. Decimal llega como string. */
export interface TierAdjustmentRule {
  adjustment_type?: string | null;
  adjustment_value?: number | string | { toString(): string } | null;
  discount_percentage?: number | string | { toString(): string } | null;
  amount_scope?: string | null;
}

export interface ResolvedTierAdjustment {
  type: TierAdjustmentType;
  value: number;
  scope: TierAmountScope;
}

function toNumber(value: TierAdjustmentRule['adjustment_value']): number {
  if (value == null) return 0;
  const n = Number(typeof value === 'object' ? value.toString() : value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normaliza la regla. `percent_discount` lee `discount_percentage` (la columna
 * histórica); el resto lee `adjustment_value`. Un tipo desconocido cae a la
 * regla histórica en vez de inventar un precio.
 */
export function resolveTierAdjustment(
  rule: TierAdjustmentRule,
): ResolvedTierAdjustment {
  const type = TIER_ADJUSTMENT_TYPES.includes(
    rule.adjustment_type as TierAdjustmentType,
  )
    ? (rule.adjustment_type as TierAdjustmentType)
    : 'percent_discount';
  const scope = TIER_AMOUNT_SCOPES.includes(rule.amount_scope as TierAmountScope)
    ? (rule.amount_scope as TierAmountScope)
    : 'per_unit';
  const value =
    type === 'percent_discount'
      ? toNumber(rule.discount_percentage)
      : toNumber(rule.adjustment_value);
  return { type, value, scope };
}

/**
 * Precio del PAQUETE completo (`packSize` unidades; 1 sin presentación).
 *
 * - Porcentajes: sobre `unitBase * packSize`; no dependen del alcance.
 * - Montos fijos `per_unit`: ajustan la unidad y luego multiplican.
 * - Montos fijos `per_package`: se aplican una vez al paquete.
 * - Ningún resultado es negativo.
 */
export function applyTierAdjustment(
  unitBase: number,
  packSize: number,
  rule: TierAdjustmentRule,
): number {
  const { type, value, scope } = resolveTierAdjustment(rule);
  const packageBase = unitBase * packSize;
  const amount = Math.max(0, value);
  const perPackage = scope === 'per_package';

  switch (type) {
    case 'percent_discount':
      return packageBase * (1 - Math.max(0, Math.min(100, value)) / 100);
    case 'percent_surcharge':
      return packageBase * (1 + amount / 100);
    case 'fixed_amount_discount':
      return perPackage
        ? Math.max(0, packageBase - amount)
        : Math.max(0, unitBase - amount) * packSize;
    case 'fixed_amount_surcharge':
      return perPackage ? packageBase + amount : (unitBase + amount) * packSize;
    case 'fixed_price':
      return perPackage ? amount : amount * packSize;
  }
}

export type TierAdjustmentError =
  | 'unknown_type'
  | 'value_required'
  | 'value_out_of_range';

/** Tope del recargo porcentual: más de 1000 % es casi seguro un error de tipeo. */
export const TIER_MAX_SURCHARGE_PERCENT = 1000;

/**
 * Valida la regla antes de guardarla. `percent_discount` lee
 * `discount_percentage` (validado por su DTO); los tipos nuevos exigen un
 * `adjustment_value` mayor que 0. `null` = válida.
 */
export function validateTierAdjustment(
  rule: TierAdjustmentRule,
): TierAdjustmentError | null {
  const type = rule.adjustment_type ?? 'percent_discount';
  if (!TIER_ADJUSTMENT_TYPES.includes(type as TierAdjustmentType)) {
    return 'unknown_type';
  }
  if (type === 'percent_discount') return null;

  const value = toNumber(rule.adjustment_value);
  if (rule.adjustment_value == null || value <= 0) return 'value_required';
  if (type === 'percent_surcharge' && value > TIER_MAX_SURCHARGE_PERCENT) {
    return 'value_out_of_range';
  }
  return null;
}

/** Texto corto de la regla, para la razón del precio y las etiquetas. */
export function describeTierAdjustment(rule: TierAdjustmentRule): string {
  const { type, value, scope } = resolveTierAdjustment(rule);
  const per = scope === 'per_package' ? 'per package' : 'per unit';
  switch (type) {
    case 'percent_discount':
      return `${Math.max(0, Math.min(100, value))}% off`;
    case 'percent_surcharge':
      return `+${value}%`;
    case 'fixed_amount_discount':
      return `-${value} ${per}`;
    case 'fixed_amount_surcharge':
      return `+${value} ${per}`;
    case 'fixed_price':
      return `fixed ${value} ${per}`;
  }
}
