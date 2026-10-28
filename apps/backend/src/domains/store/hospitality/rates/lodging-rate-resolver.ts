import { Prisma } from '@prisma/client';

/**
 * Hospitality Suite (H2.1, H2.2) — pure nightly price resolution, no I/O.
 *
 * A plan prices a room type with a base row (`day_of_week` null) and optional
 * weekday rows (0 = Sunday .. 6 = Saturday). Rows tied to a season (H2.2)
 * price the nights inside it. Order for one night: season + weekday > season
 * > weekday > base. When several seasons with prices cover the night, the
 * highest priority wins (ties: the newest season).
 */
export interface RateSeason {
  id: number;
  /** First and last night inside the season, `YYYY-MM-DD`. */
  from_date: string;
  to_date: string;
  priority: number;
}

export interface RatePriceRow {
  day_of_week: number | null;
  price: Prisma.Decimal.Value;
  /** H2.2: null or absent = regular price. */
  season?: RateSeason | null;
}

export interface PricedNight {
  night_date: string;
  rate_amount: Prisma.Decimal;
}

/** Weekday of a `YYYY-MM-DD` civil date: 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** A plan sells a room type only when it gives the type a regular base price. */
export function hasBasePrice(prices: readonly RatePriceRow[]): boolean {
  return prices.some((row) => row.day_of_week == null && !row.season);
}

/** The season that prices a night: covering it, highest priority, newest on ties. */
export function winningSeason<S extends RateSeason>(
  night: string,
  seasons: readonly S[],
): S | null {
  let best: S | null = null;
  for (const season of seasons) {
    if (night < season.from_date || night > season.to_date) continue;
    if (
      !best ||
      season.priority > best.priority ||
      (season.priority === best.priority && season.id > best.id)
    ) {
      best = season;
    }
  }
  return best;
}

/** Price of one night, or null when the plan does not price it. */
export function resolveNightRate(
  night: string,
  prices: readonly RatePriceRow[],
): Prisma.Decimal | null {
  const dow = dayOfWeek(night);
  const seasons = prices.flatMap((row) => (row.season ? [row.season] : []));
  const season = winningSeason(night, seasons);
  const pick = (seasonId: number | null) => {
    const rows = prices.filter((row) => (row.season?.id ?? null) === seasonId);
    return rows.find((p) => p.day_of_week === dow) ?? rows.find((p) => p.day_of_week == null);
  };
  const row = (season && pick(season.id)) ?? pick(null);
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
