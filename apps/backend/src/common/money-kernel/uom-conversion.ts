/**
 * Núcleo único de conversión de unidades de medida (feature
 * `product-sale-unit-consolidation`, S10/S11).
 *
 * Puro: sin NestJS, sin Prisma, sin Angular. Lo consumen el backend (validación
 * del producto, stock de líneas de peso) y el frontend (editor de producto y
 * POS, vía `@money-kernel/uom-conversion`). Todos los factores vienen del
 * catálogo `units_of_measure.factor_to_base` (bases: g, ml, mm, unit; la libra
 * comercial colombiana son 500 g exactos).
 *
 * Reglas de redondeo, una sola por magnitud:
 *  - Inventario: entero de la unidad de inventario,
 *    `round(toFixed6(cantidad × f_unidad / f_inventario))`. El `toFixed(6)`
 *    evita que el error binario mueva el redondeo (`0,9995 × 1000`).
 *  - Dinero: `round2` half-up con `Number.EPSILON`.
 */

/** Unidad del catálogo tal como la necesita la conversión. */
export interface UomRef {
  id?: number;
  code: string;
  name?: string;
  dimension: string;
  factor_to_base: number | string | { toString(): string };
  is_base?: boolean;
  is_stock_eligible?: boolean;
}

/** Tolerancia para decidir si una razón de factores es entera. */
const INTEGER_RATIO_TOLERANCE = 1e-6;

/** Unidad base de cada dimensión medible (factor 1 en el catálogo). */
const BASE_UNIT_CODE: Readonly<Record<string, string>> = {
  mass: 'g',
  volume: 'ml',
  length: 'mm',
  count: 'unit',
};

function factorOf(unit: UomRef): number {
  const raw = unit.factor_to_base;
  const n = Number(typeof raw === 'object' && raw !== null ? String(raw) : raw);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function sameUnit(a: UomRef, b: UomRef): boolean {
  if (a.id != null && b.id != null) return Number(a.id) === Number(b.id);
  return a.code === b.code;
}

/** Dimensiones que se venden en fracciones (0,245 kg, 1,5 m). */
export function isMeasurableDimension(dimension: string | null | undefined): boolean {
  return dimension != null && dimension !== 'count';
}

/** Código de la unidad base de una dimensión (`g`, `ml`, `mm`, `unit`). */
export function baseUnitCodeFor(dimension: string | null | undefined): string | null {
  return dimension ? (BASE_UNIT_CODE[dimension] ?? null) : null;
}

/** `true` si la unidad es la base de su dimensión (factor 1). */
export function isBaseUnit(unit: UomRef): boolean {
  return Math.abs(factorOf(unit) - 1) <= INTEGER_RATIO_TOLERANCE;
}

/**
 * Cuántas `to` caben en una `from` (`f_from / f_to`). `null` si son de
 * dimensiones distintas o algún factor es inválido.
 */
export function uomRatio(from: UomRef, to: UomRef): number | null {
  if (String(from.dimension) !== String(to.dimension)) return null;
  const f = factorOf(from);
  const t = factorOf(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
  return f / t;
}

/**
 * Razón ENTERA ≥ 1 de `unit` sobre `stock` (cuántas unidades de inventario hay
 * en una `unit`), o `null` si no es exacta, es menor que 1 o cambia de
 * dimensión. Es la escala de precio cuando `unit` es la principal.
 */
export function integerRatio(unit: UomRef, stock: UomRef): number | null {
  const ratio = uomRatio(unit, stock);
  return ratio == null ? null : asIntegerRatio(ratio);
}

/**
 * Una razón ya calculada (unidades de stock por unidad de venta) como entero
 * ≥ 1, o `null` si no lo es. Para quien ya tiene el factor relativo (POS).
 */
export function asIntegerRatio(ratio: number): number | null {
  if (!Number.isFinite(ratio)) return null;
  const n = Math.round(ratio);
  return n >= 1 && Math.abs(ratio - n) <= INTEGER_RATIO_TOLERANCE ? n : null;
}

/** Convierte una cantidad entre unidades de la misma dimensión, sin redondear a entero. */
export function convertAmount(
  amount: number,
  from: UomRef,
  to: UomRef,
): number | null {
  const f = factorOf(from);
  const t = factorOf(to);
  if (
    String(from.dimension) !== String(to.dimension) ||
    !Number.isFinite(amount) ||
    !Number.isFinite(f) ||
    !Number.isFinite(t)
  ) {
    return null;
  }
  return Number(((amount * f) / t).toFixed(9));
}

/**
 * Unidades ENTERAS de inventario que consume `amount` expresada en `unit`.
 * Puede dar 0 (cantidad menor a media unidad de inventario): decidir qué hacer
 * con ese 0 es del llamador. `null` si no hay conversión posible.
 */
export function toStockUnits(
  amount: number,
  unit: UomRef,
  stock: UomRef,
): number | null {
  const f = factorOf(unit);
  const s = factorOf(stock);
  if (
    String(unit.dimension) !== String(stock.dimension) ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(f) ||
    !Number.isFinite(s)
  ) {
    return null;
  }
  return Math.round(Number(((amount * f) / s).toFixed(6)));
}

/** Variante por factores sueltos (líneas de peso del backend). Misma fórmula. */
export function toStockUnitsByFactor(
  amount: number,
  unitFactor: number,
  stockFactor: number,
): number | null {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(unitFactor) ||
    unitFactor <= 0 ||
    !Number.isFinite(stockFactor) ||
    stockFactor <= 0
  ) {
    return null;
  }
  return Math.round(Number(((amount * unitFactor) / stockFactor).toFixed(6)));
}

/**
 * Menor cantidad de `unit` que equivale a 1 unidad de inventario
 * (`f_stock / f_unit`): por debajo de la mitad de eso la venta descontaría 0.
 */
export function minSellableAmount(unit: UomRef, stock: UomRef): number | null {
  const ratio = uomRatio(stock, unit);
  return ratio == null ? null : Number(ratio.toFixed(9));
}

/** Redondeo de dinero único del núcleo: 2 decimales, half-up. */
export function roundUomMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Lo que se cobra por `amount` de `unit` cuando el precio está expresado por
 * unidad principal: `precio × cantidad × f_unit / f_principal`, redondeado una
 * sola vez. `null` si las unidades no se convierten.
 */
export function chargeForAmount(
  pricePerPrincipal: number,
  amount: number,
  unit: UomRef,
  principal: UomRef,
): number | null {
  const inPrincipal = convertAmount(amount, unit, principal);
  if (inPrincipal == null || !Number.isFinite(pricePerPrincipal)) return null;
  return roundUomMoney(pricePerPrincipal * inPrincipal);
}

/** `pricing_type` que corresponde a una principal: masa ⇒ `weight`, el resto ⇒ `unit`. */
export function pricingTypeFor(
  principal: Pick<UomRef, 'dimension'> | null | undefined,
): 'unit' | 'weight' {
  return principal?.dimension === 'mass' ? 'weight' : 'unit';
}

export type UomViolationCode =
  | 'STOCK_REQUIRED'
  | 'DUPLICATE_SALE_UNIT'
  | 'DIMENSION_MISMATCH'
  | 'SMALLER_THAN_STOCK'
  | 'NOT_INTEGER_MULTIPLE'
  | 'MEASURED_STOCK_NOT_BASE'
  | 'PRICING_TYPE_MISMATCH'
  | 'PURCHASE_DIMENSION_MISMATCH'
  | 'PURCHASE_SMALLER_THAN_STOCK';

export interface UomViolation {
  code: UomViolationCode;
  /** Mensaje en lenguaje claro, listo para mostrar al dueño de la tienda. */
  message: string;
  uom_code?: string;
}

export interface ProductUomConfig {
  /** Unidad en la que se cuenta el inventario. */
  stock: UomRef | null;
  /** Unidad principal de venta: el precio se expresa en ella. */
  principal: UomRef | null;
  /** Otras unidades en las que también se vende (sin la principal). */
  additional?: readonly UomRef[];
  /** Unidad en que se compra al proveedor. */
  purchase?: UomRef | null;
  /** Factor manual de envase (compra por conteo → stock masa/volumen). */
  purchase_manual_factor?: number | null;
  /** Se valida contra la principal solo si viene. */
  pricing_type?: 'unit' | 'weight' | string | null;
}

function label(unit: UomRef): string {
  return unit.name ? `${unit.name} (${unit.code})` : unit.code;
}

/**
 * Reglas de compatibilidad de las unidades de un producto (S5, S10). Las usa el
 * editor para avisar antes de guardar y el backend para rechazar. Lista vacía =
 * combinación válida. Sin unidades de venta no hay nada que validar (producto
 * por pieza o legado de peso, S6).
 */
export function validateProductUoms(config: ProductUomConfig): UomViolation[] {
  const violations: UomViolation[] = [];
  const saleUnits: UomRef[] = [
    ...(config.principal ? [config.principal] : []),
    ...(config.additional ?? []),
  ];
  const stock = config.stock;

  if (saleUnits.length > 0) {
    if (!stock) {
      violations.push({
        code: 'STOCK_REQUIRED',
        message:
          'Para declarar unidades de venta el producto debe tener unidad de stock',
      });
      return violations;
    }

    const seen: UomRef[] = [];
    for (const unit of saleUnits) {
      if (seen.some((other) => sameUnit(other, unit))) {
        violations.push({
          code: 'DUPLICATE_SALE_UNIT',
          message: 'Las unidades de venta no pueden repetirse',
          uom_code: unit.code,
        });
        continue;
      }
      seen.push(unit);

      if (String(unit.dimension) !== String(stock.dimension)) {
        violations.push({
          code: 'DIMENSION_MISMATCH',
          message: `La unidad de venta (${unit.code}) debe pertenecer a la misma dimensión que la de stock (${stock.code}) para poder convertirse`,
          uom_code: unit.code,
        });
        continue;
      }
      if (factorOf(unit) < factorOf(stock)) {
        violations.push({
          code: 'SMALLER_THAN_STOCK',
          message: `La unidad de venta (${unit.code}) no puede ser menor que la de stock (${stock.code}): el stock se cuenta en enteros de ${stock.code}`,
          uom_code: unit.code,
        });
        continue;
      }
      if (integerRatio(unit, stock) == null) {
        const isPrincipal =
          config.principal != null && sameUnit(config.principal, unit);
        violations.push({
          code: 'NOT_INTEGER_MULTIPLE',
          message: isPrincipal
            ? `La unidad principal (${unit.code}) debe equivaler a un número entero de ${stock.code}: el precio se expresa en ella`
            : `La unidad de venta (${unit.code}) debe equivaler a un número entero de ${stock.code}: el stock se cuenta en enteros de ${stock.code}`,
          uom_code: unit.code,
        });
      }
    }

    const principal = config.principal;
    if (
      principal &&
      String(principal.dimension) === String(stock.dimension) &&
      isMeasurableDimension(principal.dimension) &&
      !isBaseUnit(stock)
    ) {
      const base = baseUnitCodeFor(principal.dimension) ?? 'su unidad mínima';
      violations.push({
        code: 'MEASURED_STOCK_NOT_BASE',
        message: `Se vende por ${principal.code} en fracciones (por ejemplo 0,245 ${principal.code}), así que el stock debe contarse en ${base}; contado en ${stock.code} una venta pequeña descontaría 0`,
        uom_code: stock.code,
      });
    }

    if (
      principal &&
      config.pricing_type != null &&
      config.pricing_type !== pricingTypeFor(principal)
    ) {
      violations.push({
        code: 'PRICING_TYPE_MISMATCH',
        message:
          pricingTypeFor(principal) === 'weight'
            ? `La unidad principal ${label(principal)} es de peso: el producto debe venderse por peso.`
            : `La unidad principal ${label(principal)} no es de peso: el producto no puede venderse por peso.`,
        uom_code: principal.code,
      });
    }
  }

  const purchase = config.purchase;
  if (purchase && stock) {
    const packaging =
      purchase.dimension === 'count' &&
      (stock.dimension === 'mass' || stock.dimension === 'volume') &&
      config.purchase_manual_factor != null &&
      Number.isInteger(config.purchase_manual_factor) &&
      config.purchase_manual_factor >= 1;
    if (!packaging) {
      const ratio = uomRatio(purchase, stock);
      if (ratio == null) {
        violations.push({
          code: 'PURCHASE_DIMENSION_MISMATCH',
          message: `Las unidades de stock (${stock.code}) y compra (${purchase.code}) deben pertenecer a la misma dimensión para poder convertirse`,
          uom_code: purchase.code,
        });
      } else if (Math.round(ratio) < 1) {
        violations.push({
          code: 'PURCHASE_SMALLER_THAN_STOCK',
          message: `La unidad de compra (${purchase.code}) no puede ser menor que la de stock (${stock.code})`,
          uom_code: purchase.code,
        });
      }
    }
  }

  return violations;
}
