import { Prisma } from '@prisma/client';
import { depositTotals, settleDeposit } from './lodging-deposit-math';

const d = (value: number) => new Prisma.Decimal(value);
const plain = (settlement: ReturnType<typeof settleDeposit>) =>
  Object.fromEntries(Object.entries(settlement).map(([key, value]) => [key, value.toNumber()]));

describe('lodging deposit math (H3.5)', () => {
  it('counts completed rows only: a pending Wompi link is not money yet', () => {
    const totals = depositTotals([
      { kind: 'received', status: 'completed', amount: 225000 },
      { kind: 'received', status: 'pending', amount: 50000 },
      { kind: 'applied', status: 'completed', amount: '100000.00' },
      { kind: 'retained', status: 'completed', amount: d(25000) },
    ]);

    expect(totals.received.toNumber()).toBe(225000);
    expect(totals.applied.toNumber()).toBe(100000);
    expect(totals.retained.toNumber()).toBe(25000);
    expect(totals.balance.toNumber()).toBe(100000);
  });

  it('"Penalidad $250.000 · retenido $225.000 · por cobrar $25.000"', () => {
    expect(plain(settleDeposit(d(250000), d(225000)))).toEqual({
      penalty: 250000,
      retained: 225000,
      to_collect: 25000,
      to_refund: 0,
    });
  });

  it('a deposit above the penalty leaves the rest "por devolver"', () => {
    expect(plain(settleDeposit(d(100000), d(225000)))).toEqual({
      penalty: 100000,
      retained: 100000,
      to_collect: 0,
      to_refund: 125000,
    });
  });

  it('a free cancellation retains nothing and returns the whole deposit', () => {
    expect(plain(settleDeposit(null, d(225000)))).toEqual({
      penalty: 0,
      retained: 0,
      to_collect: 0,
      to_refund: 225000,
    });
  });

  it('never retains more than the wallet really holds', () => {
    expect(plain(settleDeposit(d(250000), d(225000), d(200000)))).toEqual({
      penalty: 250000,
      retained: 200000,
      to_collect: 50000,
      to_refund: 25000,
    });
  });
});
