import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { FullTaxRow } from '../../orders/utils/catalog-line-pricing.util';
import { resolveLineUnits, roundMoney2 } from '../../taxes/utils/final-price.util';
import { resolveLineTotals } from '../../taxes/utils/tax-inclusive-math.util';
import type { SellableStockAllocator } from '../../inventory/shared/services/sellable-stock-allocator.service';
import type { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import type { StockValidatorService } from '../../inventory/shared/services/stock-validator.service';
import type { ShippingTaxService } from '../../shipping/services/shipping-tax.service';
import { priceToCents, quoteBlocks, RateWindow } from '../../../../common/utils/rate-window.util';

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

/**
 * Prefijo estable de la línea de alquiler. Es lo que identifica la línea ya cobrada:
 * NO se compara contra el nombre completo porque la estación se puede renombrar entre
 * "Registrar pago" y el cierre, y el nombre de la línea es un snapshot del momento.
 */
export const RENTAL_LINE_PREFIX = 'Alquiler ';

/** Bloques de alquiler consumidos: ceil(minutos transcurridos / minutos del bloque), mínimo 1. */
export function rentalBlocksConsumed(openedAt: Date, now: Date, blockMinutes: number): number {
  const elapsedMinutes = Math.max(0, (now.getTime() - openedAt.getTime()) / 60_000);
  return Math.max(1, Math.ceil(elapsedMinutes / blockMinutes));
}

/** Bloques de alquiler previstos (modo `planned`): ceil(minutos planeados / minutos del bloque), mínimo 1. */
export function rentalBlocksPlanned(plannedMinutes: number, blockMinutes: number): number {
  return Math.max(1, Math.ceil(Math.max(0, plannedMinutes) / blockMinutes));
}

/** `order_items.service_line_kind` of the rental charge (station block rate, rental product line or a paid booking line). */
export const RENTAL_LINE_KIND = 'rental';
/** `order_items.service_line_kind` of the charge for time added by an admin extension (S10). */
export const EXTENSION_LINE_KIND = 'extension';
/** Lines that are NOT consumption: they never count towards the minimum spend (question 6). */
export const NON_CONSUMPTION_LINE_KINDS = [RENTAL_LINE_KIND, EXTENSION_LINE_KIND];

/** Copy of the station rental rate taken when the session opened (S18). `null` = legacy session. */
export interface SessionRentalSnapshot {
  billing_mode: 'elapsed' | 'planned';
  charge_timing: 'at_start' | 'at_end';
  block_minutes: number | null;
  block_price: number | null;
  windows: RateWindow[];
}

/** Columns of `service_sessions` that hold the snapshot (all optional so legacy rows type-check). */
export interface SessionRentalColumns {
  rental_billing_mode?: string | null;
  rental_charge_timing?: string | null;
  rental_block_minutes?: number | null;
  rental_block_price?: Prisma.Decimal | number | string | null;
  rate_windows_snapshot?: unknown;
}

/** Rebuilds the snapshot from the session columns. A NULL billing mode is a legacy session: returns null. */
export function readSessionRentalSnapshot(session: SessionRentalColumns): SessionRentalSnapshot | null {
  if (!session.rental_billing_mode) return null;
  const raw = Array.isArray(session.rate_windows_snapshot) ? (session.rate_windows_snapshot as RateWindow[]) : [];
  return {
    billing_mode: session.rental_billing_mode === 'planned' ? 'planned' : 'elapsed',
    charge_timing: session.rental_charge_timing === 'at_start' ? 'at_start' : 'at_end',
    block_minutes: session.rental_block_minutes ?? null,
    block_price: session.rental_block_price == null ? null : Number(session.rental_block_price),
    windows: raw,
  };
}

/** Whether the snapshot carries a time rate (block and price both set). */
export function snapshotHasTimeRate(snapshot: SessionRentalSnapshot | null): snapshot is SessionRentalSnapshot & { block_minutes: number; block_price: number } {
  return !!snapshot && (snapshot.block_minutes ?? 0) > 0 && (snapshot.block_price ?? 0) > 0;
}

/**
 * Prices `blocks` consecutive blocks starting at `startAt` over the snapshot windows (kernel
 * `quoteBlocks`). Uniform blocks stay `quantity = blocks` at the block price; blocks priced
 * differently by a window collapse into one unit of the exact total (cents).
 * `tz` is only needed when the snapshot has windows.
 */
export function priceRentalBlocks(
  snapshot: SessionRentalSnapshot & { block_minutes: number; block_price: number },
  startAt: Date,
  blocks: number,
  tz: string | null,
): { quantity: number; unitPrice: number; totalCents: number } {
  const windows = snapshot.windows ?? [];
  if (windows.length === 0 || !tz) {
    const cents = priceToCents(snapshot.block_price);
    return { quantity: blocks, unitPrice: cents / 100, totalCents: cents * blocks };
  }
  const quote = quoteBlocks({ startAt, blockMinutes: snapshot.block_minutes, blocks, windows, basePrice: snapshot.block_price, tz });
  const first = quote.perBlock[0]?.cents ?? 0;
  if (quote.perBlock.every((b) => b.cents === first)) {
    return { quantity: blocks, unitPrice: first / 100, totalCents: quote.cents };
  }
  return { quantity: 1, unitPrice: quote.cents / 100, totalCents: quote.cents };
}

/**
 * Línea "Alquiler <estación>" de la cuenta SVC cuando la estación tiene tarifa por bloque.
 * Sin tarifa (NULL o cero) no hace nada. Hay una sola línea por sesión: si ya existe, se
 * recalcula con los bloques consumidos hasta `now` y el precio de bloque vigente, salvo que
 * la cuenta ya tenga un pago registrado (lo cobrado no se reescribe) o la línea esté
 * anulada. Sin producto ni inventario. El impuesto es el configurado en la estación
 * (`rental_tax_category_id` + `rental_tax_is_inclusive`), resuelto con la misma regla que
 * la tarifa de envío y reaplicado en cada recálculo; sin configuración la línea sale sin
 * impuesto. El llamador garantiza la orden en borrador. Devuelve si creó o cambió la
 * línea; el llamador recalcula los totales.
 */
export async function ensureSessionRentalLine(
  tx: Prisma.TransactionClient,
  args: {
    storeId: number;
    sessionId: number;
    orderId: number;
    stationId: number;
    openedAt: Date;
    now: Date;
    /** Rate copied when the session opened. Absent or null = legacy session: elapsed time at the live station rate. */
    snapshot?: SessionRentalSnapshot | null;
    /** Minutes of the allocation without paid extensions (billing mode `planned`). */
    plannedMinutes?: number | null;
    /** Store timezone, required only when the snapshot has windows. */
    tz?: string | null;
  },
  taxes: Pick<ShippingTaxService, 'taxRowsForCategory'>,
): Promise<boolean> {
  const { storeId, sessionId, orderId, stationId, openedAt, now, snapshot = null, plannedMinutes = null, tz = null } = args;
  const station = await tx.service_stations.findFirst({
    where: { id: stationId, store_id: storeId },
    select: {
      name: true,
      rental_block_minutes: true,
      rental_block_price: true,
      rental_tax_category_id: true,
      rental_tax_is_inclusive: true,
    },
  });
  // A snapshot freezes the rate: a later change of the station never reprices a session already open.
  const blockMinutes = snapshot ? snapshot.block_minutes ?? 0 : station?.rental_block_minutes ?? 0;
  const blockPrice = snapshot ? snapshot.block_price ?? 0 : Number(station?.rental_block_price ?? 0);
  if (!station || blockMinutes <= 0 || !(blockPrice > 0)) return false;
  // Double-charge guard: a rental already on the order (booking paid online, rental product line)
  // is THE rental. The own "Alquiler <estación>" line is excluded so it can still be recalculated.
  const foreignRental = await tx.order_items.findFirst({
    where: {
      order_id: orderId,
      service_line_kind: RENTAL_LINE_KIND,
      cancelled_at: null,
      NOT: { AND: [{ product_id: null }, { product_name: { startsWith: RENTAL_LINE_PREFIX } }] },
    },
    select: { id: true, service_line_kind: true },
  });
  if (foreignRental?.service_line_kind === RENTAL_LINE_KIND) return false;
  const productName = `${RENTAL_LINE_PREFIX}${station.name}`;
  const existing = await tx.order_items.findFirst({
    where: {
      order_id: orderId,
      service_session_id: sessionId,
      product_id: null,
      product_name: { startsWith: RENTAL_LINE_PREFIX },
    },
    select: {
      id: true,
      quantity: true,
      unit_price: true,
      tax_rate: true,
      tax_amount_item: true,
      final_unit_price: true,
      cancelled_at: true,
    },
  });
  if (existing) {
    if (existing.cancelled_at) return false;
    const order = await tx.orders.findUnique({ where: { id: orderId }, select: { total_paid: true } });
    if (Number(order?.total_paid ?? 0) > 0) return false;
  }
  let quantity: number;
  let publishedUnit = blockPrice;
  if (snapshot) {
    let blocks: number;
    if (snapshot.billing_mode === 'planned') {
      // Planned: the allocation decides, never the clock. Passing the end without extending adds nothing.
      if (plannedMinutes == null) return false;
      blocks = rentalBlocksPlanned(plannedMinutes, blockMinutes);
    } else {
      blocks = rentalBlocksConsumed(openedAt, now, blockMinutes);
    }
    const priced = priceRentalBlocks({ ...snapshot, block_minutes: blockMinutes, block_price: blockPrice }, openedAt, blocks, tz);
    quantity = priced.quantity;
    publishedUnit = priced.unitPrice;
  } else {
    quantity = rentalBlocksConsumed(openedAt, now, blockMinutes);
  }
  const taxRows = await taxes.taxRowsForCategory(tx, {
    tax_category_id: station.rental_tax_category_id ?? null,
    tax_is_inclusive: station.rental_tax_is_inclusive ?? true,
    store_id: storeId,
  });
  const line = buildSessionTaxedLine(publishedUnit, quantity, taxRows);
  if (existing) {
    const unchanged =
      existing.quantity === quantity &&
      line.unit_price.equals(existing.unit_price ?? 0) &&
      line.tax_rate.equals(existing.tax_rate ?? 0) &&
      line.tax_amount_item.equals(existing.tax_amount_item ?? 0) &&
      line.final_unit_price.equals(existing.final_unit_price ?? 0);
    if (unchanged) return false;
    // El nombre es un snapshot: se conserva aunque la estación se haya renombrado.
    await tx.order_item_taxes.deleteMany({ where: { order_item_id: existing.id } });
    await tx.order_items.update({
      where: { id: existing.id },
      data: { quantity, updated_at: now, ...line },
    });
    return true;
  }
  await tx.order_items.create({
    data: {
      order_id: orderId,
      service_session_id: sessionId,
      product_id: null,
      product_name: productName,
      quantity,
      item_type: 'service',
      ...(snapshot ? { service_line_kind: RENTAL_LINE_KIND } : {}),
      updated_at: now,
      ...line,
    },
  });
  return true;
}

/** Spanish unit label of the station block (singular for exactly one). */
export function rentalUnitLabel(unit: string | null | undefined, amount: number): string {
  const one = amount === 1;
  if (unit === 'day') return one ? 'día' : 'días';
  if (unit === 'hour') return one ? 'hora' : 'horas';
  return one ? 'minuto' : 'minutos';
}

const UNIT_MINUTES: Record<string, number> = { minute: 1, hour: 60, day: 1440 };

/**
 * Charge for time added by an admin extension (S10): one `Extensión · <n> <unidad>` line,
 * `service_line_kind 'extension'`, no product, qty 1, priced block by block from the OLD end
 * over the snapshot windows, with the station tax. The caller guarantees a draft order, the
 * `planned` mode and a time rate, runs it inside the allocation transaction and recalculates
 * the totals. Returns the charged minutes, or null when nothing was charged.
 */
export async function addSessionExtensionLine(
  tx: Prisma.TransactionClient,
  args: {
    storeId: number;
    sessionId: number;
    orderId: number;
    stationId: number;
    snapshot: SessionRentalSnapshot & { block_minutes: number; block_price: number };
    oldEnd: Date;
    newEnd: Date;
    tz: string | null;
    now: Date;
  },
  taxes: Pick<ShippingTaxService, 'taxRowsForCategory'>,
): Promise<{ extra_minutes: number; blocks: number; total_cents: number } | null> {
  const { storeId, sessionId, orderId, stationId, snapshot, oldEnd, newEnd, tz, now } = args;
  const extraMinutes = (newEnd.getTime() - oldEnd.getTime()) / 60_000;
  if (!(extraMinutes > 0)) return null;
  const blocks = Math.max(1, Math.ceil(extraMinutes / snapshot.block_minutes));
  const station = await tx.service_stations.findFirst({
    where: { id: stationId, store_id: storeId },
    select: { rental_block_unit: true, rental_tax_category_id: true, rental_tax_is_inclusive: true },
  });
  const priced = priceRentalBlocks(snapshot, oldEnd, blocks, tz);
  const unit = station?.rental_block_unit ?? 'minute';
  const amount = Math.round(((blocks * snapshot.block_minutes) / (UNIT_MINUTES[unit] ?? 1)) * 100) / 100;
  const amountText = String(amount).replace('.', ',');
  const taxRows = await taxes.taxRowsForCategory(tx, {
    tax_category_id: station?.rental_tax_category_id ?? null,
    tax_is_inclusive: station?.rental_tax_is_inclusive ?? true,
    store_id: storeId,
  });
  await tx.order_items.create({
    data: {
      order_id: orderId,
      service_session_id: sessionId,
      product_id: null,
      product_name: `Extensión · ${amountText} ${rentalUnitLabel(unit, amount)}`,
      quantity: 1,
      item_type: 'service',
      service_line_kind: EXTENSION_LINE_KIND,
      updated_at: now,
      ...buildSessionTaxedLine(priced.totalCents / 100, 1, taxRows),
    },
  });
  return { extra_minutes: extraMinutes, blocks, total_cents: priced.totalCents };
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
    { orderId },
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
      allocation.restricted_location_ids?.[0] ??
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
