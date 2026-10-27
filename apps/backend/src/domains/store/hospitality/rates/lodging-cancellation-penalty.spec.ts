import { Prisma } from '@prisma/client';
import {
  CancellationPolicySnapshot,
  combinePenalties,
  depositRequired,
  hoursBeforeCheckIn,
  roomPenalty,
} from './lodging-cancellation-penalty';

const D = (value: number | string) => new Prisma.Decimal(value);

// "Flexible: gratis hasta 48 h, luego 1 noche"; no-show = 100 %.
const FLEXIBLE: CancellationPolicySnapshot = {
  id: 1,
  name: 'Flexible',
  rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 1 }],
  no_show_penalty: { penalty_type: 'percent', penalty_value: 100 },
};

const NIGHTS = [D(250000), D(320000), D(320000)];
const room = (policy: CancellationPolicySnapshot | null = FLEXIBLE) => ({
  policy,
  nights: NIGHTS,
  total: D(890000),
});

describe('roomPenalty', () => {
  it('is free outside every window', () => {
    expect(roomPenalty(room(), 72, 'cancel')).toBeNull();
    expect(roomPenalty(room(), 48, 'cancel')).toBeNull();
  });

  it('charges the first night inside the 48 h window', () => {
    const penalty = roomPenalty(room(), 24, 'cancel')!;
    expect(penalty.amount.toFixed(2)).toBe('250000.00');
    expect(penalty.detail).toBe('1 noche');
  });

  it('applies the narrowest matching window', () => {
    const policy: CancellationPolicySnapshot = {
      ...FLEXIBLE,
      rules: [
        { hours_before: 72, penalty_type: 'percent', penalty_value: 30 },
        { hours_before: 24, penalty_type: 'nights', penalty_value: 2 },
      ],
    };
    expect(roomPenalty(room(policy), 48, 'cancel')!.amount.toFixed(2)).toBe('267000.00');
    expect(roomPenalty(room(policy), 48, 'cancel')!.detail).toBe('30 %');
    const late = roomPenalty(room(policy), 10, 'cancel')!;
    expect(late.amount.toFixed(2)).toBe('570000.00');
    expect(late.detail).toBe('2 noches');
  });

  it('keeps charging after the check-in time passed', () => {
    expect(roomPenalty(room(), -5, 'cancel')!.amount.toFixed(2)).toBe('250000.00');
  });

  it('never charges more nights than the stay has', () => {
    const policy: CancellationPolicySnapshot = {
      ...FLEXIBLE,
      rules: [{ hours_before: 48, penalty_type: 'nights', penalty_value: 5 }],
    };
    expect(roomPenalty(room(policy), 1, 'cancel')!.amount.toFixed(2)).toBe('890000.00');
  });

  it('uses the no-show penalty for a no-show, whatever the hour', () => {
    const penalty = roomPenalty(room(), 500, 'no_show')!;
    expect(penalty.amount.toFixed(2)).toBe('890000.00');
    expect(penalty.detail).toBe('100 %');
    expect(roomPenalty(room({ ...FLEXIBLE, no_show_penalty: null }), 0, 'no_show')).toBeNull();
  });

  it('is free without a policy', () => {
    expect(roomPenalty(room(null), 1, 'cancel')).toBeNull();
  });
});

describe('combinePenalties', () => {
  it('adds the rooms and keeps one detail per distinct term', () => {
    const total = combinePenalties([
      { amount: D(250000), detail: '1 noche' },
      null,
      { amount: D(200000), detail: '1 noche' },
    ])!;
    expect(total.amount.toFixed(2)).toBe('450000.00');
    expect(total.detail).toBe('1 noche');
    expect(combinePenalties([null, null])).toBeNull();
  });
});

describe('depositRequired', () => {
  it('shows the percent when every room asks the same', () => {
    const deposit = depositRequired([
      { deposit_percent: D(30), total: D(500000) },
      { deposit_percent: D(30), total: D(250000) },
    ]);
    expect(deposit).toEqual({ percent: '30', amount: '225000.00' });
  });

  it('sums mixed percents without a single percent', () => {
    expect(
      depositRequired([
        { deposit_percent: D(30), total: D(500000) },
        { deposit_percent: D(0), total: D(250000) },
      ]),
    ).toEqual({ percent: null, amount: '150000.00' });
  });

  it('is zero without rooms', () => {
    expect(depositRequired([])).toEqual({ percent: null, amount: '0.00' });
  });
});

describe('hoursBeforeCheckIn', () => {
  it('counts to the check-in time of the arrival day in the store time zone', () => {
    // 15:00 Bogotá (UTC-5) of 2026-12-07 = 20:00 UTC.
    const now = new Date('2026-12-06T20:00:00.000Z');
    expect(hoursBeforeCheckIn('2026-12-07', '15:00', 'America/Bogota', now)).toBe(24);
  });
});
