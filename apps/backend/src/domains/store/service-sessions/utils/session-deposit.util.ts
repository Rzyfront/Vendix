import { Prisma } from '@prisma/client';
import type { ShippingTaxService } from '../../shipping/services/shipping-tax.service';
import { centsToAmount, toCents } from '../../service-deposits/utils/service-deposit-math';
import { lockOrderLifecycle } from '../../orders/order-flow/order-lifecycle-lock.util';
import {
  RESERVATION_FEE_LINE_KIND,
  RESERVATION_FEE_LINE_NAME,
} from '../../reservations/reservation-deposits.service';
import { buildSessionTaxedLine, NON_CONSUMPTION_LINE_KINDS } from './session-order-lines.util';

export type SessionLeftoverPolicy = 'refund_or_credit' | 'minimum_spend';

/** "$1.250.000" / "$35.000,50": no ICU dependency, so the text is the same on every host. */
export function formatMoneyEs(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = abs % 100;
  return `${cents < 0 ? '-' : ''}$${whole}${rest ? `,${rest.toString().padStart(2, '0')}` : ''}`;
}

/** Gross (what the customer pays) of one order line, in cents. */
export function lineGrossCents(line: { final_unit_price: unknown; quantity: unknown }): number {
  return toCents(line.final_unit_price as Prisma.Decimal.Value) * Number(line.quantity ?? 1);
}

export interface SettlementInput {
  /** Rental + products, taxes included, without the reservation fee. */
  consumption_cents: number;
  /** Already paid on the order by any method. */
  paid_cents: number;
  received_cents: number;
  /**
   * What is compared against the minimum spend (question 6): consumption WITHOUT the rental and
   * extension lines. Defaults to `consumption_cents` (legacy and accounts without rental lines).
   */
  minimum_basis_cents?: number;
  /** Deposit ledger balance still held for this session. */
  balance_cents: number;
  leftover_policy: SessionLeftoverPolicy | null;
}

export interface SettlementPlan {
  /** "Gastos de reserva" line (minimum_spend only): received - consumption, never below zero. */
  fee_cents: number;
  /** What the invoice totals: consumption + fee. */
  invoice_cents: number;
  remaining_cents: number;
  /** Deposit that goes to the order: min(balance, remaining). */
  apply_cents: number;
  /** The cashier still collects this through the normal payment flow. */
  to_collect_cents: number;
  /** Deposit left after applying: refunded or kept as customer credit. */
  leftover_cents: number;
}

/** Pure settlement arithmetic, shared by the preview and the settle transaction. */
export function planSettlement(input: SettlementInput): SettlementPlan {
  const fee_cents =
    input.leftover_policy === 'minimum_spend'
      ? Math.max(0, input.received_cents - (input.minimum_basis_cents ?? input.consumption_cents))
      : 0;
  const invoice_cents = input.consumption_cents + fee_cents;
  const remaining_cents = Math.max(0, invoice_cents - input.paid_cents);
  const apply_cents = Math.max(0, Math.min(input.balance_cents, remaining_cents));
  return {
    fee_cents,
    invoice_cents,
    remaining_cents,
    apply_cents,
    to_collect_cents: remaining_cents - apply_cents,
    leftover_cents: Math.max(0, input.balance_cents - apply_cents),
  };
}

/**
 * Upserts the "Gastos de reserva" line of the session order (A7): no product,
 * `item_type 'service'`, qty 1, tax-inclusive with the station's category (a
 * null category means no tax), so its gross is exactly `feeCents`. A zero fee
 * removes the line. The caller recomputes the order totals. Returns whether
 * the line changed.
 */
export async function syncReservationFeeLine(
  tx: Prisma.TransactionClient,
  args: { storeId: number; sessionId: number; orderId: number; taxCategoryId: number | null; feeCents: number; now: Date },
  taxes: Pick<ShippingTaxService, 'taxRowsForCategory'>,
): Promise<boolean> {
  const { storeId, sessionId, orderId, taxCategoryId, feeCents, now } = args;
  const existing = await tx.order_items.findFirst({
    where: { order_id: orderId, service_session_id: sessionId, service_line_kind: RESERVATION_FEE_LINE_KIND, cancelled_at: null },
    select: { id: true, final_unit_price: true, quantity: true },
  });
  if (feeCents <= 0) {
    if (!existing) return false;
    await tx.order_items.delete({ where: { id: existing.id } });
    return true;
  }
  if (existing && lineGrossCents(existing) === feeCents) return false;
  const rows = await taxes.taxRowsForCategory(tx, {
    tax_category_id: taxCategoryId,
    tax_is_inclusive: true,
    store_id: storeId,
  });
  const line = buildSessionTaxedLine(centsToAmount(feeCents), 1, rows);
  if (existing) {
    await tx.order_item_taxes.deleteMany({ where: { order_item_id: existing.id } });
    await tx.order_items.update({ where: { id: existing.id }, data: { quantity: 1, updated_at: now, ...line } });
    return true;
  }
  await tx.order_items.create({
    data: {
      order_id: orderId,
      service_session_id: sessionId,
      product_id: null,
      product_name: RESERVATION_FEE_LINE_NAME,
      quantity: 1,
      item_type: 'service',
      service_line_kind: RESERVATION_FEE_LINE_KIND,
      updated_at: now,
      ...line,
    },
  });
  return true;
}

/** Gross cents of the live "Gastos de reserva" line of the order (0 when there is none). */
export async function reservationFeeGrossCents(
  tx: Prisma.TransactionClient,
  orderId: number,
  sessionId: number,
): Promise<number> {
  const line = await tx.order_items.findFirst({
    where: { order_id: orderId, service_session_id: sessionId, service_line_kind: RESERVATION_FEE_LINE_KIND, cancelled_at: null },
    select: { final_unit_price: true, quantity: true },
  });
  return line ? lineGrossCents(line) : 0;
}

/**
 * Gross cents of the live rental and extension lines of the order (0 when there are none).
 * They are billed but are not consumption: the minimum spend ignores them.
 */
export async function nonConsumptionGrossCents(tx: Prisma.TransactionClient, orderId: number): Promise<number> {
  const lines = await tx.order_items.findMany({
    where: { order_id: orderId, service_line_kind: { in: NON_CONSUMPTION_LINE_KINDS }, cancelled_at: null },
    select: { final_unit_price: true, quantity: true, service_line_kind: true, cancelled_at: true },
  });
  return lines
    .filter((line) => !line.cancelled_at && NON_CONSUMPTION_LINE_KINDS.includes(line.service_line_kind ?? ''))
    .reduce((sum, line) => sum + lineGrossCents(line), 0);
}

/**
 * Writes a non-system `service_budgets` version so every money gate that reads
 * the latest budget (`serviceBudgetBlocks`) caps the order at the deposit
 * received. `raiseOnly` (settle, A10) never lowers a higher cap. The order
 * lock serialises the `(session_id, version)` sequence. `onlyIfCapped` only
 * raises a cap that already exists. Returns whether a
 * version was written.
 */
export async function writeDepositBudget(
  tx: Prisma.TransactionClient,
  args: { storeId: number; sessionId: number; orderId: number; amountCents: number; currency: string; raiseOnly?: boolean; onlyIfCapped?: boolean },
): Promise<boolean> {
  const { storeId, sessionId, orderId, amountCents, currency, raiseOnly, onlyIfCapped } = args;
  await lockOrderLifecycle(tx, orderId, storeId);
  const current = await tx.service_budgets.findFirst({
    where: { store_id: storeId, session_id: sessionId },
    orderBy: { version: 'desc' },
    select: { amount: true, currency: true, version: true, is_system: true },
  });
  // `onlyIfCapped`: raise an existing deposit cap, never create one (a session without cap stays without it).
  if (onlyIfCapped && (!current || current.is_system)) return false;
  if (current && !current.is_system && current.currency === currency) {
    const currentCents = toCents(current.amount);
    if (currentCents === amountCents || (raiseOnly && currentCents >= amountCents)) return false;
  }
  await tx.service_budgets.create({
    data: {
      store_id: storeId,
      session_id: sessionId,
      version: (current?.version ?? 0) + 1,
      amount: new Prisma.Decimal(centsToAmount(amountCents)),
      currency,
      approved_at: null,
      is_system: false,
    },
  });
  return true;
}
