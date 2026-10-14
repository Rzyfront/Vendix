import { Prisma } from '@prisma/client';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVATION_START_MAX_DAYS_BACK = 31;

const DECIMAL_ZERO = new Prisma.Decimal(0);

/** Mirrors `SubscriptionBillingService.billingCycleMs` (private there). */
export function billingCycleMs(cycle: string): number {
  switch (cycle) {
    case 'quarterly':
      return 90 * DAY_MS;
    case 'semiannual':
      return 180 * DAY_MS;
    case 'annual':
      return 365 * DAY_MS;
    case 'lifetime':
      return 100 * 365 * DAY_MS;
    case 'monthly':
    default:
      return 30 * DAY_MS;
  }
}

/** Today's date-only string (YYYY-MM-DD) in America/Bogota. */
export function todayInBogota(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseDateOnly(value: string): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === value ? d : null;
}

export function isActivationStartInRange(
  startsAt: string,
  now: Date = new Date(),
): boolean {
  const start = parseDateOnly(startsAt);
  const today = parseDateOnly(todayInBogota(now));
  if (!start || !today) return false;
  const min = today.getTime() - ACTIVATION_START_MAX_DAYS_BACK * DAY_MS;
  return start.getTime() >= min && start.getTime() <= today.getTime();
}

export function computeActivationWindow(
  cycle: string,
  startsAt?: string | null,
  now: Date = new Date(),
): { periodStart: Date; periodEnd: Date } {
  let periodStart = now;
  if (startsAt) {
    const anchored = new Date(`${startsAt}T12:00:00Z`);
    if (!Number.isNaN(anchored.getTime())) {
      periodStart = anchored.getTime() > now.getTime() ? now : anchored;
    }
  }
  const periodEnd = new Date(periodStart.getTime() + billingCycleMs(cycle));
  return { periodStart, periodEnd };
}

/** Mirrors `SubscriptionBillingService.extractPendingCredit` (private there). */
export function extractPendingCredit(metadata: unknown): Prisma.Decimal {
  if (!metadata || typeof metadata !== 'object') return DECIMAL_ZERO;
  const raw = (metadata as Record<string, unknown>)['pending_credit'];
  if (typeof raw === 'string' || typeof raw === 'number') {
    try {
      const d = new Prisma.Decimal(raw);
      return d.greaterThan(DECIMAL_ZERO) ? d : DECIMAL_ZERO;
    } catch {
      return DECIMAL_ZERO;
    }
  }
  return DECIMAL_ZERO;
}

export interface ActivationQuote {
  is_free: boolean;
  effective_price: string;
  pending_credit_applied: string;
  invoice_total: string;
  amount_received: string;
  excess_to_credit: string;
  shortfall: string;
}

const round2 = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(2, 6 /* ROUND_HALF_EVEN */);

export function computeActivationQuote(input: {
  pricing: {
    effective_price: Prisma.Decimal;
    margin_amount: Prisma.Decimal;
  };
  subscriptionMetadata?: unknown;
  amount?: string | null;
}): ActivationQuote {
  const { effective_price, margin_amount } = input.pricing;
  const zero = DECIMAL_ZERO.toFixed(2);

  if (
    effective_price.lessThanOrEqualTo(DECIMAL_ZERO) &&
    margin_amount.lessThanOrEqualTo(DECIMAL_ZERO)
  ) {
    return {
      is_free: true,
      effective_price: zero,
      pending_credit_applied: zero,
      invoice_total: zero,
      amount_received: zero,
      excess_to_credit: zero,
      shortfall: zero,
    };
  }

  const pending = extractPendingCredit(input.subscriptionMetadata);
  const applied = Prisma.Decimal.min(pending, effective_price);
  const total = round2(effective_price.minus(applied));
  const received =
    input.amount != null ? round2(new Prisma.Decimal(input.amount)) : total;
  const excess = Prisma.Decimal.max(received.minus(total), DECIMAL_ZERO);
  const shortfall = Prisma.Decimal.max(total.minus(received), DECIMAL_ZERO);

  return {
    is_free: false,
    effective_price: round2(effective_price).toFixed(2),
    pending_credit_applied: round2(applied).toFixed(2),
    invoice_total: total.toFixed(2),
    amount_received: received.toFixed(2),
    excess_to_credit: excess.toFixed(2),
    shortfall: shortfall.toFixed(2),
  };
}
