import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { FullTaxRow } from '../../orders/utils/catalog-line-pricing.util';
import { resolveLineUnits, roundMoney2 } from '../../taxes/utils/final-price.util';
import { resolveLineTotals } from '../../taxes/utils/tax-inclusive-math.util';
import type { SellableStockAllocator } from '../../inventory/shared/services/sellable-stock-allocator.service';
import type { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import type { StockValidatorService } from '../../inventory/shared/services/stock-validator.service';

/**
 * Columnas de precio/impuesto de una línea de la cuenta SVC, igual que `addItems` de la
 * mesa: el precio publicado se despeja una vez con las tasas del producto (incluidas →
 * se extrae la base; sumadas → se agregan encima) y se persiste la BASE. `tax_amount_item`
 * es por unidad; `order_item_taxes` lleva el total de línea por tasa.
 */
export function buildSessionTaxedLine(publishedUnitPrice: number, quantity: number, rows: FullTaxRow[]) {
  const lineUnits = resolveLineUnits({ quantity, price_unit_quantity: null });
  const resolved = resolveLineTotals(publishedUnitPrice, rows);
  return {
    unit_price: new Prisma.Decimal(roundMoney2(resolved.base)),
    total_price: new Prisma.Decimal(roundMoney2(resolved.base * lineUnits)),
    tax_rate: new Prisma.Decimal(Math.round((resolved.total_rate + Number.EPSILON) * 100000) / 100000),
    tax_amount_item: new Prisma.Decimal(roundMoney2(resolved.total_tax_amount)),
    final_unit_price: new Prisma.Decimal(roundMoney2(resolved.total)),
    ...(rows.length > 0
      ? {
          order_item_taxes: {
            create: rows.map((row, index) => ({
              tax_rate_id: row.tax_rate_id,
              tax_name: row.name,
              tax_rate: Math.round((row.rate + Number.EPSILON) * 100000) / 100000,
              tax_amount: roundMoney2(resolved.taxes[index].amount * lineUnits),
              tax_type: row.tax_type,
              is_compound: false,
              is_inclusive: row.is_inclusive,
            })),
          },
        }
      : {}),
  };
}

export interface SessionOrderTotals {
  subtotal: number;
  tax: number;
  grandTotal: number;
  remaining: number;
}

/**
 * Totales de la cuenta SVC con el mismo criterio que la cuenta de mesa:
 * subtotal = suma de bases, IVA = suma de `order_item_taxes` (o `tax_amount_item`
 * por unidad si la línea no tiene desglose), total = subtotal + IVA - descuento
 * (misma convención que `orders.service`: `subtotal + tax - discount`).
 */
export async function computeSessionOrderTotals(
  tx: Prisma.TransactionClient,
  orderId: number,
): Promise<SessionOrderTotals> {
  const [items, order] = await Promise.all([
    tx.order_items.findMany({
      where: { order_id: orderId, cancelled_at: null },
      select: {
        total_price: true,
        tax_amount_item: true,
        quantity: true,
        weight: true,
        price_unit_quantity: true,
        order_item_taxes: { select: { tax_amount: true } },
      },
    }),
    tx.orders.findUnique({ where: { id: orderId }, select: { total_paid: true, discount_amount: true } }),
  ]);
  const subtotal = roundMoney2(items.reduce((acc, it) => acc + Number(it.total_price), 0));
  const tax = roundMoney2(
    items.reduce((acc, it) => {
      if (it.order_item_taxes.length > 0) {
        return acc + it.order_item_taxes.reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
      }
      const units = resolveLineUnits({
        quantity: it.quantity,
        weight: it.weight,
        price_unit_quantity: it.price_unit_quantity,
      });
      return acc + Number(it.tax_amount_item ?? 0) * units;
    }, 0),
  );
  const discount = roundMoney2(Math.max(0, Number(order?.discount_amount ?? 0)));
  const grandTotal = roundMoney2(Math.max(0, subtotal + tax - discount));
  const remaining = roundMoney2(Math.max(0, grandTotal - Number(order?.total_paid ?? 0)));
  return { subtotal, tax, grandTotal, remaining };
}

/** Recalcula y persiste los totales de la orden; devuelve a qué tienda/sesión pertenece. */
export async function writeSessionOrderTotals(
  tx: Prisma.TransactionClient,
  orderId: number,
  now: Date,
): Promise<SessionOrderTotals & { store_id: number | null; service_session_id: number | null }> {
  const totals = await computeSessionOrderTotals(tx, orderId);
  const updatedOrder = await tx.orders.update({
    where: { id: orderId },
    data: {
      subtotal_amount: totals.subtotal,
      tax_amount: totals.tax,
      grand_total: totals.grandTotal,
      remaining_balance: totals.remaining,
      updated_at: now,
    },
    select: { store_id: true, service_session_id: true },
  });
  return { ...totals, store_id: updatedOrder?.store_id ?? null, service_session_id: updatedOrder?.service_session_id ?? null };
}

/** Bloques de alquiler consumidos: ceil(minutos transcurridos / minutos del bloque), mínimo 1. */
export function rentalBlocksConsumed(openedAt: Date, now: Date, blockMinutes: number): number {
  const elapsedMinutes = Math.max(0, (now.getTime() - openedAt.getTime()) / 60_000);
  return Math.max(1, Math.ceil(elapsedMinutes / blockMinutes));
}

/**
 * Línea "Alquiler <estación>" de la cuenta SVC cuando la estación tiene tarifa por bloque.
 * Sin tarifa (NULL o cero) no hace nada. Se cobra una sola vez: si la sesión ya tiene la
 * línea de alquiler de esa estación, no se duplica. Sin producto, sin inventario y sin
 * impuesto (no hay tasa de catálogo que aplicar). Devuelve si creó la línea; el llamador
 * recalcula los totales.
 */
export async function ensureSessionRentalLine(
  tx: Prisma.TransactionClient,
  args: { storeId: number; sessionId: number; orderId: number; stationId: number; openedAt: Date; now: Date },
): Promise<boolean> {
  const { storeId, sessionId, orderId, stationId, openedAt, now } = args;
  const station = await tx.service_stations.findFirst({
    where: { id: stationId, store_id: storeId },
    select: { name: true, rental_block_minutes: true, rental_block_price: true },
  });
  const blockMinutes = station?.rental_block_minutes ?? 0;
  const blockPrice = Number(station?.rental_block_price ?? 0);
  if (!station || blockMinutes <= 0 || !(blockPrice > 0)) return false;
  const productName = `Alquiler ${station.name}`;
  const existing = await tx.order_items.findFirst({
    where: { order_id: orderId, service_session_id: sessionId, product_id: null, product_name: productName },
    select: { id: true },
  });
  if (existing) return false;
  const quantity = rentalBlocksConsumed(openedAt, now, blockMinutes);
  await tx.order_items.create({
    data: {
      order_id: orderId,
      service_session_id: sessionId,
      product_id: null,
      product_name: productName,
      quantity,
      item_type: 'service',
      updated_at: now,
      ...buildSessionTaxedLine(blockPrice, quantity, []),
    },
  });
  return true;
}

export interface SessionStockDeps {
  stockValidator: StockValidatorService;
  sellableStockAllocator: SellableStockAllocator;
  stockLevelManager: StockLevelManager;
}

/**
 * Reserva de stock de una línea de la cuenta, por el mismo camino que mesas y POS:
 * ubicaciones vendibles + StockLevelManager, cuyo claim es atómico (dos cargas sobre
 * la última unidad no pasan las dos). Liberar la línea libera exactamente su reserva.
 */
export async function reserveSessionLineStock(
  deps: SessionStockDeps,
  tx: Prisma.TransactionClient,
  args: {
    storeId: number;
    productId: number;
    variantId: number | null;
    lineName: string;
    quantity: number;
    orderId: number;
    actorUserId: number | null;
  },
): Promise<void> {
  const { storeId, productId, variantId, lineName, quantity, orderId, actorUserId } = args;
  const { allowOversell } = await deps.stockValidator.resolveInventoryPolicy(storeId, tx);
  const allocation = await deps.sellableStockAllocator.allocateForLine(
    storeId,
    productId,
    variantId ?? undefined,
    quantity,
    [],
    tx,
  );
  let slices = allocation.slices;
  if (allocation.shortfall > 0) {
    if (!allowOversell) {
      throw new VendixHttpException(
        ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
        `Stock insuficiente para ${lineName}`,
        {
          items: [
            {
              product_id: productId,
              product_variant_id: variantId,
              product_name: lineName,
              kind: 'product',
              requested: quantity,
              available: allocation.available,
            },
          ],
        },
      );
    }
    const fallbackLocationId =
      allocation.slices[0]?.location_id ??
      (await deps.stockLevelManager.getDefaultLocationForProduct(productId, variantId ?? undefined, tx));
    slices = deps.sellableStockAllocator.absorbShortfall(allocation, fallbackLocationId);
  }
  for (const slice of slices) {
    await deps.stockLevelManager.reserveStock(
      productId,
      variantId ?? undefined,
      slice.location_id,
      slice.quantity,
      'order',
      orderId,
      actorUserId ?? undefined,
      !allowOversell,
      tx,
      undefined,
      false,
      undefined,
      allowOversell,
    );
  }
}
