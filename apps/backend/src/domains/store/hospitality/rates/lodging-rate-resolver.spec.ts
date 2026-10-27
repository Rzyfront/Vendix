import { Prisma } from '@prisma/client';
import {
  dayOfWeek,
  hasBasePrice,
  resolveNightRate,
  resolveNightRates,
  RatePriceRow,
  sumNights,
  winningSeason,
} from './lodging-rate-resolver';

/** "Con desayuno" Doble: $250.000 every night, Friday and Saturday $320.000. */
const DOUBLE = [
  { day_of_week: null, price: '250000.00' },
  { day_of_week: 5, price: '320000.00' },
  { day_of_week: 6, price: 320000 },
];

describe('LodgingRateResolver (H2.1)', () => {
  it('reads the weekday of a civil date without timezone shifts', () => {
    expect(dayOfWeek('2026-11-12')).toBe(4); // Thursday
    expect(dayOfWeek('2026-11-15')).toBe(0); // Sunday
    expect(dayOfWeek('2026-11-14')).toBe(6); // Saturday
  });

  it('a weekday price wins over the base price', () => {
    expect(resolveNightRate('2026-11-13', DOUBLE)!.toFixed(2)).toBe('320000.00');
    expect(resolveNightRate('2026-11-14', DOUBLE)!.toFixed(2)).toBe('320000.00');
    expect(resolveNightRate('2026-11-12', DOUBLE)!.toFixed(2)).toBe('250000.00');
    expect(resolveNightRate('2026-11-15', DOUBLE)!.toFixed(2)).toBe('250000.00');
  });

  it('Thursday to Saturday: "jue $250.000 · vie $320.000 = $570.000"', () => {
    const nights = resolveNightRates(['2026-11-12', '2026-11-13'], DOUBLE)!;
    expect(nights.map((n) => [n.night_date, n.rate_amount.toFixed(2)])).toEqual([
      ['2026-11-12', '250000.00'],
      ['2026-11-13', '320000.00'],
    ]);
    expect(sumNights(nights).toFixed(2)).toBe('570000.00');
  });

  it('sums cents exactly in Decimal', () => {
    const nights = resolveNightRates(
      ['2026-11-12', '2026-11-13', '2026-11-16'],
      [{ day_of_week: null, price: '0.10' }, { day_of_week: 5, price: '0.20' }],
    )!;
    expect(sumNights(nights).equals(new Prisma.Decimal('0.40'))).toBe(true);
  });

  it('without a base price a plan does not price the type', () => {
    const fridayOnly = [{ day_of_week: 5, price: 320000 }];
    expect(hasBasePrice(fridayOnly)).toBe(false);
    expect(hasBasePrice(DOUBLE)).toBe(true);
    expect(resolveNightRates(['2026-11-12', '2026-11-13'], fridayOnly)).toBeNull();
    expect(resolveNightRates(['2026-11-12'], [])).toBeNull();
  });
});

describe('LodgingRateResolver seasons (H2.2)', () => {
  /** "Alta" 15-dic → 15-ene (last night). */
  const HIGH = { id: 1, from_date: '2026-12-15', to_date: '2027-01-15', priority: 0 };
  /** "Fin de año" 30-dic → 1-ene, overlapping "Alta" with a higher priority. */
  const NEW_YEAR = { id: 2, from_date: '2026-12-30', to_date: '2027-01-01', priority: 10 };
  const DOUBLE_SEASONS: RatePriceRow[] = [
    { day_of_week: null, price: '250000.00' },
    { day_of_week: null, price: '400000.00', season: HIGH },
    { day_of_week: null, price: '600000.00', season: NEW_YEAR },
  ];
  const rates = (nights: string[], prices: RatePriceRow[] = DOUBLE_SEASONS) =>
    resolveNightRates(nights, prices)!.map((n) => [n.night_date, n.rate_amount.toFixed(2)]);

  it('14-dic at the regular price and 15-dic at the season price', () => {
    expect(rates(['2026-12-14', '2026-12-15'])).toEqual([
      ['2026-12-14', '250000.00'],
      ['2026-12-15', '400000.00'],
    ]);
    expect(sumNights(resolveNightRates(['2026-12-14', '2026-12-15'], DOUBLE_SEASONS)!).toFixed(2)).toBe(
      '650000.00',
    );
  });

  it('to_date is the last night inside the season', () => {
    expect(rates(['2027-01-15', '2027-01-16'])).toEqual([
      ['2027-01-15', '400000.00'],
      ['2027-01-16', '250000.00'],
    ]);
  });

  it('overlapping seasons resolve by priority, the lower one around them', () => {
    expect(rates(['2026-12-29', '2026-12-30', '2027-01-01', '2027-01-02'])).toEqual([
      ['2026-12-29', '400000.00'],
      ['2026-12-30', '600000.00'],
      ['2027-01-01', '600000.00'],
      ['2027-01-02', '400000.00'],
    ]);
  });

  it('priority wins even when the other season is shorter or newer', () => {
    const lowNewYear = { ...NEW_YEAR, priority: -1 };
    expect(winningSeason('2026-12-31', [HIGH, lowNewYear])).toBe(HIGH);
    expect(winningSeason('2026-12-31', [HIGH, NEW_YEAR])).toBe(NEW_YEAR);
    // Same priority: the newest season (higher id) decides, never the order.
    const sameA = { ...HIGH, id: 7 };
    const sameB = { ...NEW_YEAR, id: 3, priority: 0 };
    expect(winningSeason('2026-12-31', [sameA, sameB])).toBe(sameA);
    expect(winningSeason('2026-12-31', [sameB, sameA])).toBe(sameA);
    expect(winningSeason('2026-12-14', [HIGH, NEW_YEAR])).toBeNull();
  });

  it('season + weekday > season > weekday > base', () => {
    const prices = [
      { day_of_week: null, price: 250000 },
      { day_of_week: 6, price: 320000 },
      { day_of_week: null, price: 400000, season: HIGH },
      { day_of_week: 6, price: 450000, season: HIGH },
    ];
    // 2026-12-12 Sat (no season), 2026-12-14 Mon, 2026-12-18 Fri, 2026-12-19 Sat.
    expect(rates(['2026-12-12', '2026-12-14', '2026-12-18', '2026-12-19'], prices)).toEqual([
      ['2026-12-12', '320000.00'],
      ['2026-12-14', '250000.00'],
      ['2026-12-18', '400000.00'],
      ['2026-12-19', '450000.00'],
    ]);
  });

  it('a season without price for the plan and type leaves the regular price', () => {
    // NEW_YEAR covers the night but this type only has an "Alta" price.
    const prices = [
      { day_of_week: null, price: 250000 },
      { day_of_week: null, price: 400000, season: HIGH },
    ];
    expect(rates(['2026-12-31'], prices)).toEqual([['2026-12-31', '400000.00']]);
  });

  it('only a regular base price makes the plan sellable', () => {
    expect(hasBasePrice([{ day_of_week: null, price: 400000, season: HIGH }])).toBe(false);
    expect(hasBasePrice(DOUBLE_SEASONS)).toBe(true);
  });
});
