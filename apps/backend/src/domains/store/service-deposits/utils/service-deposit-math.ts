import { Prisma } from '@prisma/client';

/**
 * Pure arithmetic of the consumable-deposit ledger (`service_deposits`).
 * Everything is computed in integer cents so no float drift reaches money.
 */

export type ServiceDepositKind = 'received' | 'applied' | 'refunded' | 'released';
export type ServiceDepositStatus = 'pending' | 'completed' | 'cancelled';

export interface ServiceDepositRow {
  kind: ServiceDepositKind;
  status: ServiceDepositStatus;
  amount: Prisma.Decimal | number | string;
}

export interface ServiceDepositTotals {
  received_cents: number;
  applied_cents: number;
  refunded_cents: number;
  /** Money released to the customer's free wallet credit: it leaves this deposit. */
  released_cents: number;
  /** received - applied - refunded - released, completed rows only, never below zero. */
  balance_cents: number;
}

type MoneyLike = Prisma.Decimal | number | string | null | undefined;

/** Amount to integer cents (half up), without floating point error. */
export function toCents(value: MoneyLike): number {
  if (value === null || value === undefined) return 0;
  return new Prisma.Decimal(value.toString())
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** Totals of the completed rows (a pending request is not money yet). */
export function depositBalance(rows: readonly ServiceDepositRow[]): ServiceDepositTotals {
  const sum = (kind: ServiceDepositKind) =>
    rows
      .filter((row) => row.kind === kind && row.status === 'completed')
      .reduce((total, row) => total + toCents(row.amount), 0);
  const received_cents = sum('received');
  const applied_cents = sum('applied');
  const refunded_cents = sum('refunded');
  const released_cents = sum('released');
  return {
    received_cents,
    applied_cents,
    refunded_cents,
    released_cents,
    balance_cents: Math.max(0, received_cents - applied_cents - refunded_cents - released_cents),
  };
}

/** What can be applied to an order: min(deposit balance, order remaining, wallet available). */
export function applicableCents(input: {
  balance_cents: number;
  remaining_cents: number;
  available_cents: number;
}): number {
  return Math.max(0, Math.min(input.balance_cents, input.remaining_cents, input.available_cents));
}
