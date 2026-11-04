/**
 * Unidades de STOCK que consume una línea de PESO legado (`weight > 0`).
 *
 * En ese camino `order_items.quantity` vale 1 y el peso es solo el
 * multiplicador monetario. Sin un snapshot en `stock_units_consumed`, la
 * validación, el commit de inventario (`stock_units_consumed ?? quantity`),
 * las capas de costo y las devoluciones descontaban 1 unidad por pesada.
 *
 * El servidor es la fuente de verdad: convierte el peso a la unidad de stock
 * declarada del producto (`products.stock_uom_id` → `factor_to_base`). El
 * número que mande el cliente solo se usa para verificar (se registra una
 * advertencia si no coincide) o, si el servidor no puede convertir porque la
 * unidad pesada no está en el catálogo, como valor legado.
 *
 * Reglas:
 *  - `round(peso × factor(unidad pesada) / factor(unidad de stock))`.
 *  - Nunca 0 con peso > 0: si el redondeo da 0 (stock en kg y pesada menor a
 *    0,5 kg) se descuenta 1 y se registra una advertencia. No se bloquea la
 *    venta.
 *  - Producto de peso SIN `stock_uom`: `null` ⇒ comportamiento histórico (1 por
 *    pesada). Qué unidad de stock tiene ese producto es una decisión de
 *    producto pendiente; aquí no se inventan gramos.
 */

/** Unidad del catálogo, tal como la necesita la conversión. */
export interface WeightUomFactor {
  code: string;
  dimension: string;
  factor_to_base: number | string | { toString(): string };
}

/** Línea de entrada: DTO del POS, de una orden o snapshot de `order_items`. */
export interface WeightStockUnitsLine {
  product_id?: number | null;
  weight?: number | string | { toString(): string } | null;
  weight_unit?: string | null;
  /** Valor que calculó el cliente. Solo verificación / legado. */
  stock_units_consumed?: number | string | null;
}

export type WeightStockUnitsSource =
  | 'not_weight'
  | 'no_stock_uom'
  | 'computed'
  | 'floored'
  | 'client_legacy'
  | 'unresolved';

export interface WeightStockUnitsResult {
  /** Unidades a persistir en `stock_units_consumed`; `null` = histórico. */
  units: number | null;
  source: WeightStockUnitsSource;
  /** Valor del cliente cuando no coincide con el calculado (o no es entero). */
  client_mismatch?: number | string | null;
}

/** Logger mínimo (Nest `Logger` lo cumple). */
export interface WeightStockUnitsLogger {
  warn(message: string): void;
}

function toNumber(value: unknown): number {
  if (value == null) return NaN;
  const n = Number(typeof value === 'object' ? String(value) : value);
  return Number.isFinite(n) ? n : NaN;
}

/** Peso de la línea como número; 0 cuando no es una línea de peso. */
export function lineWeight(line: { weight?: unknown }): number {
  const weight = toNumber(line.weight);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Conversión pura peso → unidades de stock, con el piso de 1.
 *
 * El `toFixed(6)` evita que el error binario mueva el redondeo:
 * `0,9995 × 1000` da `999,4999999999999` en coma flotante y debe dar 1000.
 */
export function convertWeightToStockUnits(
  weight: number,
  weightUnitFactor: number,
  stockUnitFactor: number,
): { units: number; floored: boolean } | null {
  if (
    !Number.isFinite(weight) ||
    weight <= 0 ||
    !Number.isFinite(weightUnitFactor) ||
    weightUnitFactor <= 0 ||
    !Number.isFinite(stockUnitFactor) ||
    stockUnitFactor <= 0
  ) {
    return null;
  }
  const raw = Number(((weight * weightUnitFactor) / stockUnitFactor).toFixed(6));
  const rounded = Math.round(raw);
  if (rounded < 1) return { units: 1, floored: true };
  return { units: rounded, floored: false };
}

function clientUnits(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Resuelve una línea con los factores ya cargados. Pura: el cargador por lote
 * (`resolveWeightLinesStockUnits`) le entrega la unidad de stock del producto
 * y la unidad pesada.
 */
export function resolveWeightLineStockUnits(
  line: WeightStockUnitsLine,
  stockUom: WeightUomFactor | null | undefined,
  weightUom: WeightUomFactor | null | undefined,
): WeightStockUnitsResult {
  const weight = lineWeight(line);
  if (weight <= 0) return { units: null, source: 'not_weight' };
  if (!stockUom) return { units: null, source: 'no_stock_uom' };

  const client = line.stock_units_consumed;
  const sameDimension =
    weightUom != null &&
    String(weightUom.dimension) === String(stockUom.dimension);
  if (!sameDimension) {
    // Sin unidad pesada conocida no hay conversión del servidor: el número
    // del cliente vale como legado solo si es un entero ≥ 1.
    const legacy = clientUnits(client);
    return legacy != null
      ? { units: legacy, source: 'client_legacy' }
      : { units: null, source: 'unresolved', client_mismatch: client ?? null };
  }

  const converted = convertWeightToStockUnits(
    weight,
    toNumber(weightUom.factor_to_base),
    toNumber(stockUom.factor_to_base),
  );
  if (!converted) {
    return { units: null, source: 'unresolved', client_mismatch: client ?? null };
  }
  const result: WeightStockUnitsResult = {
    units: converted.units,
    source: converted.floored ? 'floored' : 'computed',
  };
  if (client != null && client !== '' && Number(client) !== converted.units) {
    result.client_mismatch = client;
  }
  return result;
}

/**
 * Cliente Prisma mínimo: `tx` de una transacción o el servicio con scope.
 * Los delegados de Prisma son genéricos y no se asignan a una firma concreta
 * sin reescribir sus tipos; el resultado se lee con forma explícita abajo.
 */
export interface WeightStockUnitsClient {
  products: { findMany(args: any): Promise<any[]> };
  units_of_measure: { findMany(args: any): Promise<any[]> };
}

/**
 * Por lote: dos consultas para todas las líneas de peso (productos y
 * catálogo). Devuelve un arreglo alineado por índice con `lines`; las líneas
 * que no son de peso quedan en `null`.
 */
export async function resolveWeightLinesStockUnits(
  client: WeightStockUnitsClient,
  lines: readonly WeightStockUnitsLine[],
  logger?: WeightStockUnitsLogger,
): Promise<Array<number | null>> {
  const out: Array<number | null> = lines.map(() => null);
  const weighted = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.product_id != null && lineWeight(line) > 0);
  if (weighted.length === 0) return out;

  const productIds = Array.from(
    new Set(weighted.map(({ line }) => Number(line.product_id))),
  );
  const [products, units] = await Promise.all([
    client.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        stock_uom: {
          select: { code: true, dimension: true, factor_to_base: true },
        },
      },
    }),
    // Catálogo global y pequeño: se lee completo para comparar el código sin
    // distinguir mayúsculas ("KG" del payload contra "kg").
    client.units_of_measure.findMany({
      select: { code: true, dimension: true, factor_to_base: true },
    }),
  ]);

  const stockUomByProduct = new Map<number, WeightUomFactor | null>(
    (products as Array<{ id: number; stock_uom: WeightUomFactor | null }>).map(
      (p) => [Number(p.id), p.stock_uom ?? null],
    ),
  );
  const unitByCode = new Map<string, WeightUomFactor>(
    (units as WeightUomFactor[]).map((u) => [String(u.code).toLowerCase(), u]),
  );

  for (const { line, index } of weighted) {
    const code = String(line.weight_unit ?? 'kg').trim().toLowerCase();
    const result = resolveWeightLineStockUnits(
      line,
      stockUomByProduct.get(Number(line.product_id)),
      unitByCode.get(code),
    );
    out[index] = result.units;

    const label = `producto ${line.product_id}, ${lineWeight(line)} ${code}`;
    if (result.source === 'floored') {
      logger?.warn(
        `Línea de peso (${label}) redondea a 0 unidades de stock: se descuenta 1 para no vender sin descontar.`,
      );
    }
    if (result.client_mismatch !== undefined && result.source !== 'unresolved') {
      logger?.warn(
        `Línea de peso (${label}): el cliente envió stock_units_consumed=${String(result.client_mismatch)} y el servidor calculó ${String(result.units)}; se usa el del servidor.`,
      );
    }
    if (result.source === 'unresolved' || result.source === 'client_legacy') {
      logger?.warn(
        `Línea de peso (${label}): la unidad pesada no se pudo convertir a la unidad de stock del producto; ${result.units == null ? 'se conserva el comportamiento histórico' : `se usa el valor del cliente (${result.units})`}.`,
      );
    }
  }
  return out;
}

/**
 * Unidades que mueve el inventario para una línea ya persistida: la misma
 * fórmula del commit (`order-stock-commit.service.ts`), compartida con la
 * validación de stock para que ambas pidan lo mismo.
 */
export function resolveCommittedStockUnits(line: {
  quantity: number | string;
  stock_units_consumed?: number | null;
}): number {
  return line.stock_units_consumed ?? Number(line.quantity);
}

/**
 * `stock_units_consumed` interpretado como PRESENTACIÓN (empaque) para
 * mostrar "× N unid/empaque". En una línea de peso es la pesada en unidades de
 * stock (180 g), no un empaque: devuelve `null`.
 */
export function packagingStockUnits(line: {
  weight?: unknown;
  stock_units_consumed?: number | null;
}): number | null {
  if (lineWeight(line) > 0) return null;
  return line.stock_units_consumed ?? null;
}
