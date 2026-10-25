import { Prisma } from '@prisma/client';

/**
 * Latest service budget version, as read by every money gate. `is_system`
 * budgets are created by the system to follow the order total: they never cap.
 */
export interface ServiceBudgetCapRow {
  amount: Prisma.Decimal | number | string;
  currency: string;
  is_system?: boolean | null;
}

/**
 * True when the latest budget version BLOCKS `total`. A missing budget blocks
 * (fail closed); a system budget (`is_system === true`) never caps; otherwise
 * the currency must match and the total must not exceed the amount.
 */
export function serviceBudgetBlocks(
  budget: ServiceBudgetCapRow | null | undefined,
  orderCurrency: string | null | undefined,
  total: Prisma.Decimal | number | string,
): boolean {
  if (!budget) return true;
  if (budget.is_system === true) return false;
  return (
    budget.currency !== orderCurrency ||
    new Prisma.Decimal(total).greaterThan(budget.amount)
  );
}

/**
 * Serializable only for service-station orders; every other order keeps the
 * default isolation level it had before the service-stations work.
 */
export function serviceOrderTxOptions(
  serviceSessionId: number | null | undefined,
): { isolationLevel: Prisma.TransactionIsolationLevel } | undefined {
  return serviceSessionId != null
    ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    : undefined;
}
