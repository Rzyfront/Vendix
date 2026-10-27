import { Prisma } from '@prisma/client';

/**
 * Hospitality Suite (H2.1) — pure nightly price resolution, no I/O.
 *
 * A plan prices a room type with a base row (`day_of_week` null) and optional
 * weekday rows (0 = Sunday .. 6 = Saturday). A night takes its weekday price
 * when it exists, otherwise the base price. Seasons (H2.2) slot in above the
 * weekday later without changing callers.
 */
export interface RatePriceRow {
  day_of_week: number | null;
  price: Prisma.Decimal.Value;
}

export interface PricedNight {
  night_date: string;
  rate_amount: Prisma.Decimal;
}

/** Weekday of a `YYYY-MM-DD` civil date: 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** A plan sells a room type only when it gives the type a base price. */
export function hasBasePrice(prices: readonly RatePriceRow[]): boolean {
  return prices.some((row) => row.day_of_week == null);
}

/** Price of one night, or null when the plan does not price it. */
export function resolveNightRate(
  night: string,
  prices: readonly RatePriceRow[],
): Prisma.Decimal | null {
  const dow = dayOfWeek(night);
  const row =
    prices.find((p) => p.day_of_week === dow) ??
    prices.find((p) => p.day_of_week == null);
  return row ? new Prisma.Decimal(row.price) : null;
}

/** Every night with its price, or null if any night is unpriced. */
export function resolveNightRates(
  nights: readonly string[],
  prices: readonly RatePriceRow[],
): PricedNight[] | null {
  const priced: PricedNight[] = [];
  for (const night_date of nights) {
    const rate_amount = resolveNightRate(night_date, prices);
    if (!rate_amount) return null;
    priced.push({ night_date, rate_amount });
  }
  return priced;
}

/** Sum of the nights, exact in Decimal. */
export function sumNights(nights: readonly PricedNight[]): Prisma.Decimal {
  return nights.reduce((sum, n) => sum.add(n.rate_amount), new Prisma.Decimal(0));
}
