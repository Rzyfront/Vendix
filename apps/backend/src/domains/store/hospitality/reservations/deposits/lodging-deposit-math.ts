import { Prisma } from '@prisma/client';

/**
 * Hospitality Suite (H3.5) — deposit arithmetic of a reservation. Pure: the
 * service reads the ledger rows (`lodging_deposits`) and decides with these.
 */

const ZERO = new Prisma.Decimal(0);

export interface DepositRow {
  kind: 'received' | 'applied' | 'retained';
  status: 'pending' | 'completed' | 'cancelled';
  amount: Prisma.Decimal | number | string;
}

export interface DepositTotals {
  received: Prisma.Decimal;
  applied: Prisma.Decimal;
  retained: Prisma.Decimal;
  /** Still held for the reservation: received - applied - retained. */
  balance: Prisma.Decimal;
}

/** Totals of the completed rows (a pending Wompi link is not money yet). */
export function depositTotals(rows: readonly DepositRow[]): DepositTotals {
  const sum = (kind: DepositRow['kind']) =>
    rows
      .filter((row) => row.kind === kind && row.status === 'completed')
      .reduce((total, row) => total.add(new Prisma.Decimal(row.amount)), ZERO);
  const received = sum('received');
  const applied = sum('applied');
  const retained = sum('retained');
  const balance = received.sub(applied).sub(retained);
  return { received, applied, retained, balance: balance.isNegative() ? ZERO : balance };
}

export interface DepositSettlement {
  penalty: Prisma.Decimal;
  /** Kept from the deposit to cover the penalty. */
  retained: Prisma.Decimal;
  /** Penalty the deposit does not cover. */
  to_collect: Prisma.Decimal;
  /** Deposit left over after the penalty: owed back to the guest. */
  to_refund: Prisma.Decimal;
}

/**
 * Cancellation or no-show: the penalty is covered by the deposit held first.
 * "Penalidad $250.000 · retenido $225.000 · por cobrar $25.000", or "por
 * devolver" when the deposit exceeds the penalty. `available` caps what can
 * really be retained (the holder's wallet may hold less than the ledger).
 */
export function settleDeposit(
  penalty: Prisma.Decimal | null,
  held: Prisma.Decimal,
  available: Prisma.Decimal = held,
): DepositSettlement {
  const due = penalty && penalty.gt(0) ? penalty : ZERO;
  const cap = Prisma.Decimal.min(held, available);
  const retained = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(due, cap));
  return {
    penalty: due,
    retained,
    to_collect: due.sub(retained),
    to_refund: held.sub(retained),
  };
}
