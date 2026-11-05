import {
  applicableCents,
  centsToAmount,
  depositBalance,
  toCents,
  ServiceDepositRow,
} from './service-deposit-math';

const row = (
  kind: ServiceDepositRow['kind'],
  amount: number | string,
  status: ServiceDepositRow['status'] = 'completed',
): ServiceDepositRow => ({ kind, status, amount });

describe('service deposit math', () => {
  it('converts amounts to integer cents without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('400000.00')).toBe(40000000);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(null)).toBe(0);
    expect(centsToAmount(40000000)).toBe(400000);
  });

  it('balance = received - applied - refunded - released, completed rows only', () => {
    const totals = depositBalance([
      row('received', 400000),
      row('received', 50000, 'pending'),
      row('received', 99999, 'cancelled'),
      row('applied', 150000.1),
      row('refunded', 20000),
      row('released', 30000),
    ]);
    expect(totals).toEqual({
      received_cents: 40000000,
      applied_cents: 15000010,
      refunded_cents: 2000000,
      released_cents: 3000000,
      balance_cents: 19999990,
    });
  });

  it('never reports a negative balance', () => {
    expect(depositBalance([row('received', 10), row('applied', 25)]).balance_cents).toBe(0);
  });

  it('applicable amount is the minimum of balance, remaining and wallet available', () => {
    expect(applicableCents({ balance_cents: 500, remaining_cents: 300, available_cents: 900 })).toBe(300);
    expect(applicableCents({ balance_cents: 500, remaining_cents: 800, available_cents: 200 })).toBe(200);
    expect(applicableCents({ balance_cents: 100, remaining_cents: 800, available_cents: 900 })).toBe(100);
    expect(applicableCents({ balance_cents: 100, remaining_cents: -5, available_cents: 900 })).toBe(0);
  });
});
