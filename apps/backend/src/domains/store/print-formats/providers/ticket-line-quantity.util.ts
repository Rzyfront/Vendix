/**
 * QUI-978 — texto de la columna "Cant." del tiquete para una línea de orden.
 *
 * Una venta pesada se guarda en la unidad mínima de stock (`quantity` = 300
 * con stock en gramos); sin unidad el papel decía "300" y el cliente no sabía
 * si eran gramos, kilos o libras. Orden de preferencia:
 *
 * 1. Snapshot de la unidad ELEGIDA al vender (`sale_unit_code_snapshot` +
 *    `sale_quantity_snapshot`): "0,5 lb" si el cajero pesó en libras.
 * 2. Peso legado de balanza (`weight` + `weight_unit`).
 * 3. UoM de stock del producto, solo para líneas sin snapshot (órdenes
 *    anteriores al fix) que no sean de paquete: ahí `quantity` cuenta stock.
 *    Nunca para UoMs de conteo (`unit`, `par`, `doc`…): "2" ya dice todo y
 *    el código crudo ("2 unit") ensuciaría el tiquete.
 *
 * `undefined` = la línea se imprime como siempre (solo el número).
 *
 * DUPLICADA a propósito en el frontend
 * (`apps/frontend/src/app/private/modules/store/orders/utils/order-line-quantity.util.ts`):
 * cambiar la cascada aquí obliga a cambiarla allá, o el detalle de la orden
 * y el papel dirán cosas distintas. No vive en `libs/shared-types` porque
 * cada lado formatea con su locale y recibe tipos distintos (Prisma Decimal
 * `unknown` aquí, `number | string` allá); unificarla pide su propio cambio
 * con tests en ambos (PR #1062 ronda 3, H7).
 */
export interface TicketLineQuantitySource {
  quantity?: unknown;
  sale_unit_code_snapshot?: string | null;
  sale_quantity_snapshot?: unknown;
  weight?: unknown;
  weight_unit?: string | null;
  stock_units_consumed?: unknown;
  products?: {
    stock_uom?: { code?: string | null; dimension?: string | null } | null;
  } | null;
}

function formatAmount(value: number): string {
  return value.toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatTicketLineQuantity(
  item: TicketLineQuantitySource,
): string | undefined {
  const saleUnit = item.sale_unit_code_snapshot?.trim();
  const saleQuantity = toFiniteNumber(item.sale_quantity_snapshot);
  if (saleUnit && saleQuantity !== null) {
    return `${formatAmount(saleQuantity)} ${saleUnit}`;
  }

  const weight = toFiniteNumber(item.weight);
  if (weight !== null && weight > 0) {
    return `${formatAmount(weight)} ${item.weight_unit?.trim() || 'kg'}`;
  }

  const stockUom = item.products?.stock_uom;
  const stockUnit =
    stockUom?.dimension === 'count' ? undefined : stockUom?.code?.trim();
  const quantity = toFiniteNumber(item.quantity);
  const isPackageLine = (toFiniteNumber(item.stock_units_consumed) ?? 0) > 0;
  if (stockUnit && quantity !== null && !isPackageLine) {
    return `${formatAmount(quantity)} ${stockUnit}`;
  }

  return undefined;
}
