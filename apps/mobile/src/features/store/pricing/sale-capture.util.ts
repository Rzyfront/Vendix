/**
 * Unidad de CAPTURA del POS móvil — QUI-648, fase 2.
 *
 * La fase 1 dejó el COBRO idéntico al web (`price-unit.util.ts`,
 * `packaging.util.ts`, `sale-unit.util.ts`). Lo que faltaba era la CAPTURA: el
 * stepper opera sobre `quantity`, que vive SIEMPRE en la unidad mínima del
 * producto, así que vender 3 metros de un cable con stock en milímetros
 * obligaba al cajero a teclear 3000.
 *
 * Este archivo es el espejo móvil de dos fuentes del web:
 *
 *  - `apps/frontend/src/app/private/modules/store/pos/services/pos-sale-unit.service.ts`
 *    → `resolveSaleUnitConfig` reproduce su método `configFor`: deriva la
 *      unidad en la que el cajero captura como
 *      `factor_to_base(unidad de stock) × price_unit_quantity` y la busca en el
 *      catálogo `units_of_measure` (metro sobre milímetro, kilo sobre gramo).
 *  - `apps/frontend/src/app/private/modules/store/pos/utils/line-units.util.ts`
 *    → `resolveSaleQuantity`, `isSaleUnitLine` y `formatSaleQuantity`, con los
 *      MISMOS nombres a propósito: la paridad se audita de un grep.
 *
 * Se copia y no se importa porque web y móvil son proyectos separados
 * (`mobile-dev` RULE 4 prohíbe el import cruzado).
 *
 * El contrato que sostiene todo esto ya lo sirve el backend en
 * `GET /api/store/products` (rama `pos_optimized=true` incluida):
 * `stock_uom_id` y `price_unit_quantity` por producto, más el catálogo global
 * de `units_of_measure` en `GET /store/uom`. Por eso la resolución acá es
 * SÍNCRONA y pura: no hace red, no hidrata, no inventa. Si falta el catálogo o
 * la unidad, el producto se comporta como por pieza — exactamente como hoy.
 *
 * ⚠️ Invariante que no se negocia: `quantity` NUNCA cambia de significado. Sigue
 * contando unidades mínimas (o paquetes, con presentación aplicada). Lo único
 * que estrena esta fase es que el cajero escribe 3 y el carrito guarda 3000, y
 * que las superficies que muestran la línea la vuelven a leer como "3 m".
 */

import { resolvePriceUnitQuantity } from './price-unit.util';

/** Fila de `units_of_measure` tal como llega de `GET /store/uom`. */
export interface UnitOfMeasureLike {
  id: number;
  code: string;
  name: string;
  dimension?: string | null;
  factor_to_base?: number | string | null;
}

/**
 * Cómo se mide y cómo se captura un producto.
 *
 * Espejo de `PosSaleUnitConfig` del web, campo por campo.
 */
export interface SaleUnitConfig {
  /** Unidad mínima en la que vive el stock. `null` = el producto va por pieza. */
  stockUnit: {
    id: number;
    code: string;
    name: string;
    dimension: string;
    factorToBase: number;
  } | null;
  /** Unidades de stock que cubre el precio publicado. `1` = precio por unidad. */
  priceUnitQuantity: number;
  /** Unidad en la que el cajero captura ("m", "kg"). `null` = piezas. */
  captureUnit: { code: string; name: string } | null;
  /** Unidades mínimas que consume UNA unidad de captura. `1` = sin conversión. */
  unitsPerCapture: number;
}

/** Producto por pieza: el comportamiento histórico, sin conversión alguna. */
export const PIECE_SALE_UNIT: SaleUnitConfig = {
  stockUnit: null,
  priceUnitQuantity: 1,
  captureUnit: null,
  unitsPerCapture: 1,
};

/** Campos del contrato de venta que el POS lee de un producto. */
export interface SaleUnitCaptureProductLike {
  stock_uom_id?: number | null;
  stock_uom?: { id?: number | null } | null;
  price_unit_quantity?: number | null;
}

/**
 * Configuración de captura de un producto, resuelta contra el catálogo de
 * unidades. Pura y síncrona: sin catálogo, sin `stock_uom_id` o sin una unidad
 * que cubra la escala, devuelve el comportamiento por pieza.
 *
 * La unidad de captura es la que cubre EXACTAMENTE la escala del precio: stock
 * en mm + precio por 1000 mm ⇒ el cajero pide metros. Si el catálogo no tiene
 * esa unidad se captura en la unidad de stock: nunca se redondea una
 * equivalencia que no existe.
 */
export function resolveSaleUnitConfig(
  product: SaleUnitCaptureProductLike | null | undefined,
  catalog: UnitOfMeasureLike[] = [],
): SaleUnitConfig {
  if (!product) return PIECE_SALE_UNIT;

  const scale = resolvePriceUnitQuantity(product.price_unit_quantity);
  const stockUomId = Number(product.stock_uom_id ?? product.stock_uom?.id ?? 0);

  // Sin unidad de stock declarada el producto va por pieza. Es la rama que
  // recorre TODO el catálogo histórico: cero conversión, cero UI nueva.
  if (!Number.isFinite(stockUomId) || stockUomId <= 0) {
    return { ...PIECE_SALE_UNIT, priceUnitQuantity: scale };
  }

  // El catálogo aún no llegó (o falló): no se inventa una conversión, se vende
  // como siempre. El web toma exactamente la misma decisión.
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { ...PIECE_SALE_UNIT, priceUnitQuantity: scale };
  }

  const stock = catalog.find((unit) => Number(unit.id) === stockUomId);
  if (!stock) return { ...PIECE_SALE_UNIT, priceUnitQuantity: scale };

  const stockFactor = Number(stock.factor_to_base ?? 1) || 1;
  const stockUnit = {
    id: Number(stock.id),
    code: stock.code,
    name: stock.name,
    dimension: String(stock.dimension ?? ''),
    factorToBase: stockFactor,
  };

  const targetFactor = stockFactor * scale;
  const capture =
    scale > 1
      ? catalog.find(
          (unit) =>
            String(unit.dimension ?? '') === stockUnit.dimension &&
            Number(unit.factor_to_base) === targetFactor,
        )
      : stock;

  if (!capture) {
    return {
      stockUnit,
      priceUnitQuantity: scale,
      captureUnit: { code: stock.code, name: stock.name },
      unitsPerCapture: 1,
    };
  }

  return {
    stockUnit,
    priceUnitQuantity: scale,
    captureUnit: { code: capture.code, name: capture.name },
    unitsPerCapture: Math.max(
      1,
      Math.round((Number(capture.factor_to_base) || 1) / stockFactor),
    ),
  };
}

/**
 * `true` cuando el producto se captura en una unidad distinta de la mínima —
 * el único caso en el que el POS le pregunta la cantidad al cajero. Un producto
 * por pieza, o uno cuya unidad de stock YA es la de venta, se agrega de un
 * toque como siempre: preguntar ahí sería una regresión, no una mejora.
 */
export function requiresSaleQuantityCapture(config: SaleUnitConfig): boolean {
  return !!config.stockUnit && config.unitsPerCapture > 1;
}

/**
 * Cantidad capturada ("3" metros) convertida a la unidad mínima ("3000" mm).
 *
 * Redondea al entero porque el inventario es `Int` — misma decisión que el web
 * (`Math.round(amount * saleUnit.unitsPerCapture)`). Devuelve 0 cuando la
 * captura no alcanza ni una unidad mínima; el caller avisa cuál es el mínimo
 * real en vez de agregar una línea sin mercancía detrás.
 */
export function resolveStockUnitsFromCapture(
  amount: number,
  unitsPerCapture: number,
): number {
  const value = Number(amount);
  const factor = Number(unitsPerCapture);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const safeFactor = Number.isFinite(factor) && factor > 1 ? factor : 1;
  const units = Math.round(value * safeFactor);
  return units > 0 ? units : 0;
}

/**
 * Vista mínima de una línea del carrito para resolver su escala de captura.
 *
 * Los nombres de campo son camelCase porque así los declara `CartItem` del
 * móvil de punta a punta (`priceUnitQuantity`, `appliedPriceTierId`…). El web
 * usa `sale_unit_code` / `stock_units_per_sale_unit` sobre su propio modelo
 * snake_case; la correspondencia es 1 a 1:
 *
 *   saleUnitCode          ↔ sale_unit_code
 *   stockUnitsPerSaleUnit ↔ stock_units_per_sale_unit
 */
export interface SaleLineUnitsLike {
  quantity: number;
  /** Código de la unidad en la que se capturó ("m", "kg"). `null` = unidad mínima. */
  saleUnitCode?: string | null;
  /** Unidades mínimas que consume UNA unidad de captura. `null`/1 = sin conversión. */
  stockUnitsPerSaleUnit?: number | null;
}

/**
 * Cantidad en la unidad que el cajero ve ("3" de "3 m"). El cajero nunca ve la
 * unidad mínima: la conversión a milímetros o gramos es interna.
 */
export function resolveSaleQuantity(item: SaleLineUnitsLike): number {
  const quantity = Number(item.quantity ?? 0) || 0;
  const factor = Number(item.stockUnitsPerSaleUnit ?? 1) || 1;
  return factor > 1 ? quantity / factor : quantity;
}

/** `true` cuando la línea se capturó en una unidad de venta distinta a la mínima. */
export function isSaleUnitLine(item: SaleLineUnitsLike): boolean {
  return (
    !!item.saleUnitCode && Number(item.stockUnitsPerSaleUnit ?? 1) > 1
  );
}

/**
 * "3 m", "2,35 kg", "4". Hasta 3 decimales, sin ceros de relleno.
 *
 * Se formatea a mano en vez de con `toLocaleString('es-CO')` como el web: en
 * Hermes el soporte de `Intl` depende del build, y una etiqueta de cantidad que
 * cambia según el runtime es un bug difícil de ver. El separador decimal es la
 * coma, que es lo que espera el mismo cajero colombiano. Sin separador de
 * miles: una cantidad capturada rara vez pasa de tres dígitos.
 */
export function formatSaleQuantity(item: SaleLineUnitsLike): string {
  const value = resolveSaleQuantity(item);
  const rounded = Math.round(value * 1000) / 1000;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace('.', ',');
  return item.saleUnitCode ? `${text} ${item.saleUnitCode}` : text;
}

/**
 * Cuánto mueve un toque del stepper, EN UNIDADES MÍNIMAS.
 *
 * Una línea capturada en metros sube y baja de metro en metro (1000 mm por
 * toque), no de milímetro en milímetro: con el paso de 1 llegar a 3 metros
 * costaba 3000 toques. Una línea normal sigue moviéndose de a 1 — la rama por
 * pieza no se entera de que esta función existe.
 */
export function resolveQuantityStep(item: SaleLineUnitsLike): number {
  if (!isSaleUnitLine(item)) return 1;
  const factor = Number(item.stockUnitsPerSaleUnit ?? 1) || 1;
  return factor > 1 ? factor : 1;
}
