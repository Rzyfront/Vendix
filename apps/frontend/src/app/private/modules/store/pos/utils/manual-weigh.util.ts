/**
 * QUI-978 — matemática pura del pesado manual multi-UoM.
 *
 * El cajero captura en CUALQUIERA de las UoMs de venta del producto; el
 * precio siempre se calcula sobre la principal y el stock se merma en la
 * unidad mínima. Sin dependencias de Angular: testeable en aislamiento.
 */

export interface ManualWeighUnit {
  code: string;
  name: string;
  /** Factor a la base de la dimensión (g=1, kg=1000, lb=500). */
  factorToBase: number;
  isPrincipal: boolean;
}

/** Máximo digitadle en la unidad de captura (regla histórica del POS). */
export const MAX_WEIGH_AMOUNT = 999;

/**
 * Parsea lo digitado: tolera coma o punto decimal y espacios. `null` cuando
 * no hay un número positivo.
 */
export function parseWeighAmount(
  raw: string | null | undefined,
): number | null {
  if (raw == null) return null;
  const normalized = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (normalized === '' || normalized === '.') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Convierte una cantidad entre factores a la base. `null` con factores malos. */
export function convertWeighAmount(
  amount: number,
  fromFactor: number,
  toFactor: number,
): number | null {
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(fromFactor) ||
    !Number.isFinite(toFactor) ||
    fromFactor <= 0 ||
    toFactor <= 0
  ) {
    return null;
  }
  const converted = (amount * fromFactor) / toFactor;
  return Number.isFinite(converted) ? converted : null;
}

/** Cantidad expresada en la UoM principal (la del precio). */
export function principalWeighAmount(
  amount: number,
  from: ManualWeighUnit,
  principal: ManualWeighUnit,
): number | null {
  return convertWeighAmount(amount, from.factorToBase, principal.factorToBase);
}

/** Total a cobrar: cantidad en principal × precio de la principal. */
export function weighTotal(
  amountInPrincipal: number,
  pricePerPrincipal: number,
): number | null {
  if (
    !Number.isFinite(amountInPrincipal) ||
    !Number.isFinite(pricePerPrincipal) ||
    amountInPrincipal < 0 ||
    pricePerPrincipal < 0
  ) {
    return null;
  }
  const total = amountInPrincipal * pricePerPrincipal;
  return Number.isFinite(total) ? total : null;
}

/** Unidades de stock (mínima) que se descuentan del inventario. */
export function stockUnitsForWeighAmount(
  amount: number,
  fromFactor: number,
  stockFactor: number,
): number | null {
  const converted = convertWeighAmount(amount, fromFactor, stockFactor);
  if (converted == null) return null;
  return Math.round(converted);
}

/** Unidad por defecto: la principal, o la primera si no hay marca. */
export function defaultWeighUnit(
  units: ManualWeighUnit[],
): ManualWeighUnit | null {
  if (units.length === 0) return null;
  return units.find((u) => u.isPrincipal) ?? units[0];
}

/** "0,3" / "300" / "2,35": hasta 3 decimales, formato es-CO. */
export function formatWeighAmount(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toLocaleString('es-CO', { maximumFractionDigits: 3 });
}
