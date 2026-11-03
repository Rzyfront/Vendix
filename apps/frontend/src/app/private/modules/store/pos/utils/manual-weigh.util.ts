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

/**
 * Tope de captura: 999 de la UoM PRINCIPAL del producto, sea cual sea
 * (PR #1062 ronda 5, H4). Con principal kg son 999 kg; con principal g son
 * 999 g; con principal lb, 999 lb. Se compara en unidad mínima, no contra el
 * número tipeado: con principal kg, 1.500 g son 1,5 kg y pasan.
 */
export const MAX_WEIGH_AMOUNT = 999;

/**
 * PR #1062 ronda 6 (R1) — el tope de 999 es una regla de PESO: solo aplica a
 * la dimensión masa. Metros, litros y demás medidas no tenían tope antes del
 * PR y no lo tienen ahora (1.200 m de cable se venden). `null` = sin tope.
 */
export function weighMaxFor(
  dimension: string | null | undefined,
): number | null {
  return dimension === 'mass' ? MAX_WEIGH_AMOUNT : null;
}

/**
 * PR #1062 ronda 4 (punto 3) — `true` si lo digitado en `from` supera el tope
 * expresado en la principal. Ambos lados se llevan a la unidad mínima
 * (`amount × factor`) para no depender del chip elegido.
 */
export function exceedsWeighMax(
  amount: number,
  from: ManualWeighUnit,
  principal: ManualWeighUnit,
  max: number = MAX_WEIGH_AMOUNT,
): boolean {
  const minimal = amount * from.factorToBase;
  const cap = max * principal.factorToBase;
  return minimal - cap > cap * 1e-9;
}

/**
 * PR #1062 ronda 5 (H3) — el alta pasa por la captura medida cuando la unidad
 * de venta difiere de la de stock (`unitsPerCapture > 1`) O cuando el producto
 * declara más de una UoM de venta: con stock g y principal g (escala 1) las
 * otras (lb, kg) solo se ofrecen en ese modal; sin él el toque agregaba 1 g.
 */
export function capturesInSaleUnit(
  hasStockUnit: boolean,
  unitsPerCapture: number,
  declaredSaleUnits: number,
): boolean {
  if (!hasStockUnit) return false;
  return unitsPerCapture > 1 || declaredSaleUnits > 1;
}

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

/** Unidad del catálogo con el factor a la base de su dimensión. */
export interface CatalogWeighUnit {
  code: string;
  dimension: string;
  factorToBase: number;
}

/**
 * PR #1062 error 2 — la báscula emite en SU unidad configurada
 * (`pos.scale.default_weight_unit`), no en la principal del producto. Con
 * principal en lb (500 g) y báscula en kg, 0,5 kg leídos como 0,5 lb se
 * cobraban como 250 g. Convierte la lectura a `targetCode` con el catálogo;
 * misma unidad, códigos desconocidos o dimensiones distintas devuelven la
 * lectura sin tocar (no se inventa una equivalencia).
 */
export function scaleReadingToUnit(
  reading: number,
  scaleUnitCode: string | null | undefined,
  targetCode: string | null | undefined,
  catalog: CatalogWeighUnit[],
): number {
  const from = String(scaleUnitCode ?? '').trim().toLowerCase();
  const to = String(targetCode ?? '').trim().toLowerCase();
  if (!from || !to || from === to) return reading;
  const fromUnit = catalog.find((u) => u.code.toLowerCase() === from);
  const toUnit = catalog.find((u) => u.code.toLowerCase() === to);
  if (!fromUnit || !toUnit || fromUnit.dimension !== toUnit.dimension) {
    return reading;
  }
  return (
    convertWeighAmount(reading, fromUnit.factorToBase, toUnit.factorToBase) ??
    reading
  );
}
