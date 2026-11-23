/**
 * QUI-1017 — ¿Se puede RECIBIR esta línea? Espejo de
 * `resolvePurchaseUomFactor` (backend, `purchase-uom-factor.util.ts`), que es
 * la autoridad: `receive()` responde 400 con el mismo mensaje.
 *
 * Un producto con stock en masa/volumen (g, kg, ml, l) sin unidad de compra se
 * recibía 1:1: 10 kg entraban como 10 g y el costo del kilo quedaba como costo
 * del gramo. En el POP, «Crear + Recibir» se deshabilita hasta corregirlo.
 *
 * Diferencia deliberada con el backend: en el caso envase → contenido
 * (`count` → masa/volumen) el factor de un producto EXISTENTE vive en el
 * producto y el carrito no lo trae, así que aquí solo se bloquea la línea
 * nueva (prebulk) sin contenido declarado. Bloquear sin poder verlo dejaría al
 * operador atascado; el backend sigue siendo la red final.
 */

export interface ReceiptUomRef {
  id?: number | string;
  code: string;
  dimension: string;
  factor_to_base: string | number;
}

export interface ReceiptUomBlockInput {
  productName?: string | null;
  stockUom: ReceiptUomRef | null | undefined;
  purchaseUom: ReceiptUomRef | null | undefined;
  /** Contenido por envase capturado en la línea (caso count → masa/volumen). */
  contentPerPackage?: number | null;
  /** `true` cuando el factor manual podría vivir en el producto ya guardado. */
  persistedProduct?: boolean;
}

const CONTINUOUS = new Set(['mass', 'volume']);

function factorOf(unit: ReceiptUomRef): number {
  const n = Number(unit.factor_to_base);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

export function receiptUomBlockMessage(input: ReceiptUomBlockInput): string | null {
  const stock = input.stockUom;
  if (!stock || !CONTINUOUS.has(String(stock.dimension))) return null;
  const name = input.productName?.trim() || 'sin nombre';
  const purchase = input.purchaseUom;

  if (!purchase) {
    return `El producto "${name}" se maneja en ${stock.code} y no tiene unidad de compra. Elige la unidad de compra del producto (por ejemplo kg o ${stock.code}) antes de recibir la mercancía.`;
  }

  if (String(purchase.dimension) === String(stock.dimension)) {
    const factor = Math.round(factorOf(purchase) / factorOf(stock));
    if (Number.isFinite(factor) && factor >= 1) return null;
    return `El producto "${name}" se compra en ${purchase.code} y se guarda en ${stock.code}: la unidad de compra es menor que la de stock y no se puede convertir. Cambia la unidad de compra del producto antes de recibir la mercancía.`;
  }

  if (String(purchase.dimension) === 'count') {
    const content = Number(input.contentPerPackage);
    if ((Number.isFinite(content) && content >= 1) || input.persistedProduct) {
      return null;
    }
    return `El producto "${name}" se compra por ${purchase.code} y se guarda en ${stock.code}, pero no tiene definido cuántos ${stock.code} trae cada ${purchase.code}. Configura el factor de conversión del producto antes de recibir la mercancía.`;
  }

  return `El producto "${name}" se compra en ${purchase.code} y se guarda en ${stock.code}: esas unidades no se pueden convertir entre sí. Elige una unidad de compra compatible antes de recibir la mercancía.`;
}

/** Línea del carrito POP con lo que la regla necesita. */
export interface ReceiptUomCartLine {
  product?: {
    id?: number | null;
    name?: string | null;
    stock_uom_id?: number | null;
    purchase_uom_id?: number | null;
  } | null;
  stock_uom_id?: number | null;
  purchase_uom_id?: number | null;
  is_prebulk?: boolean;
  contentPerPackage?: number;
  prebulk_data?: { name?: string | null; contentPerPackage?: number } | null;
}

/**
 * Mensajes únicos de las líneas del carrito que no se pueden recibir. Sin
 * catálogo cargado no bloquea (el backend sigue validando).
 */
export function cartReceiptUomBlocks(
  items: ReadonlyArray<ReceiptUomCartLine> | null | undefined,
  catalog: ReadonlyArray<ReceiptUomRef> | null | undefined,
): string[] {
  if (!items?.length || !catalog?.length) return [];
  const byId = new Map(catalog.map((u) => [Number(u.id), u]));
  const find = (id: number | null | undefined) =>
    id != null && Number(id) > 0 ? byId.get(Number(id)) : undefined;

  const messages = new Set<string>();
  for (const item of items) {
    const message = receiptUomBlockMessage({
      productName: item.product?.name ?? item.prebulk_data?.name,
      stockUom: find(item.stock_uom_id ?? item.product?.stock_uom_id),
      purchaseUom: find(item.purchase_uom_id ?? item.product?.purchase_uom_id),
      contentPerPackage:
        item.prebulk_data?.contentPerPackage ?? item.contentPerPackage,
      persistedProduct: !item.is_prebulk && Number(item.product?.id ?? 0) > 0,
    });
    if (message) messages.add(message);
  }
  return Array.from(messages);
}
