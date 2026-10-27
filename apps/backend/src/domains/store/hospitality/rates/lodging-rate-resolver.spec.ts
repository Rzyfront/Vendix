import { Prisma } from '@prisma/client';
import {
  dayOfWeek,
  hasBasePrice,
  resolveNightRate,
  resolveNightRates,
  sumNights,
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
