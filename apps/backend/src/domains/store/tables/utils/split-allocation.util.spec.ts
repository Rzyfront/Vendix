import { Prisma } from '@prisma/client';
import {
  allocateFinancialSplit,
  FinancialSplitAllocationResult,
  FinancialSplitRequest,
  FinancialSplitSource,
  formatCents,
  getCents,
  SplitAllocationError,
  SplitAllocationTaxInput,
} from './split-allocation.util';

// Independent integer oracle: never call the allocator or its parser to derive
// expected sums. Input factories deal in cents, not tax/formula approximations.
const money = (value: bigint | number): string => {
  const cents = BigInt(value);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
};
const cents = (value: string): bigint => {
  expect(value).toMatch(/^\d+\.\d{2}$/);
  return BigInt(value.replace('.', ''));
};
const add = (values: string[]): bigint =>
  values.reduce((sum, value) => sum + cents(value), 0n);
const tax = (
  amount: string,
  overrides: Partial<SplitAllocationTaxInput> = {},
): SplitAllocationTaxInput => ({
  tax_rate_id: 1,
  tax_name: 'IVA',
  tax_rate: '0.19',
  tax_type: 'iva',
  is_compound: false,
  is_inclusive: false,
  tax_amount: amount,
  ...overrides,
});

function basicSource(
  baseAmounts = ['10000.00', '1000.00'],
  paid = '0.00',
): FinancialSplitSource {
  const total = money(add(baseAmounts));
  return {
    subtotal_amount: total,
    discount_amount: '0.00',
    tax_amount: '0.00',
    shipping_cost: '0.00',
    tip_amount: '0.00',
    grand_total: total,
    paid_total: paid,
    items: baseAmounts.map((subtotal_amount, index) => ({
      id: index + 1,
      subtotal_amount,
      taxes: [],
    })),
  };
}

function richSource(): FinancialSplitSource {
  return {
    subtotal_amount: '10000.00',
    discount_amount: '1000.00',
    tax_amount: '1710.00',
    shipping_cost: '190.00',
    tip_amount: '100.00',
    grand_total: '11000.00',
    paid_total: '3000.00',
    items: [
      { id: 1, subtotal_amount: '6000.00', taxes: [tax('1026.00')] },
      { id: 2, subtotal_amount: '4000.00', taxes: [tax('684.00')] },
    ],
  };
}

function assertConservation(
  source: FinancialSplitSource,
  result: FinancialSplitAllocationResult,
) {
  const all = [
    ...(result.retained_account ? [result.retained_account] : []),
    ...result.accounts,
  ];
  const fields = [
    'subtotal_amount',
    'discount_amount',
    'tax_amount',
    'shipping_cost',
    'tip_amount',
    'grand_total',
  ] as const;
  for (const field of fields)
    expect(add(all.map((account) => account[field]))).toBe(
      cents(source[field].toString()),
    );
  expect(add(result.accounts.map((account) => account.grand_total))).toBe(
    cents(result.pending_to_split),
  );
  expect(cents(result.preserved_paid) + cents(result.pending_to_split)).toBe(
    cents(result.original_total),
  );
  if (result.retained_account)
    expect(result.retained_account.grand_total).toBe(result.preserved_paid);
  for (const account of all) {
    const items = account.lines.filter((line) => line.kind === 'item');
    expect(add(items.map((line) => line.subtotal_amount))).toBe(
      cents(account.subtotal_amount),
    );
    expect(add(items.map((line) => line.discount_amount))).toBe(
      cents(account.discount_amount),
    );
    expect(add(items.map((line) => line.tax_amount))).toBe(
      cents(account.tax_amount),
    );
    expect(add(account.lines.map((line) => line.total_amount))).toBe(
      cents(account.grand_total),
    );
    for (const line of account.lines) {
      expect(
        cents(line.subtotal_amount) -
          cents(line.discount_amount) +
          cents(line.tax_amount),
      ).toBe(cents(line.total_amount));
      expect(add(line.taxes.map((entry) => entry.tax_amount))).toBe(
        cents(line.tax_amount),
      );
    }
  }
  for (const original of source.items) {
    const lines = all
      .flatMap((account) => account.lines)
      .filter((line) => line.source_order_item_id === original.id);
    expect(add(lines.map((line) => line.subtotal_amount))).toBe(
      cents(original.subtotal_amount.toString()),
    );
    const key = (entry: SplitAllocationTaxInput) =>
      JSON.stringify([
        entry.tax_rate_id,
        entry.tax_name,
        entry.tax_rate.toString(),
        entry.tax_type,
        entry.is_compound,
        entry.is_inclusive,
      ]);
    const keys = new Set(original.taxes.map(key));
    for (const taxKey of keys) {
      expect(
        add(
          lines
            .flatMap((line) => line.taxes)
            .filter((entry) => key(entry) === taxKey)
            .map((entry) => entry.tax_amount),
        ),
      ).toBe(
        add(
          original.taxes
            .filter((entry) => key(entry) === taxKey)
            .map((entry) => entry.tax_amount.toString()),
        ),
      );
    }
  }
}

describe('allocateFinancialSplit — exact financial participation, no physical clones', () => {
  it('11,000 with an existing 3,000 payment becomes preserved 3,000 and two 4,000 accounts', () => {
    const source = basicSource(undefined, '3000.00');
    const result = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 2,
    });
    expect(result.original_total).toBe('11000.00');
    expect(result.preserved_paid).toBe('3000.00');
    expect(result.pending_to_split).toBe('8000.00');
    expect(result.retained_account?.grand_total).toBe('3000.00');
    expect(result.accounts.map((account) => account.grand_total)).toEqual([
      '4000.00',
      '4000.00',
    ]);
    assertConservation(source, result);
  });

  it('fixes the asymmetric old greedy result: 10,000 and 1,000 split equally are 5,500 each', () => {
    const source = basicSource();
    const result = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 2,
    });
    expect(result.retained_account).toBeNull();
    expect(result.accounts.map((account) => account.grand_total)).toEqual([
      '5500.00',
      '5500.00',
    ]);
    assertConservation(source, result);
  });

  it('honors custom targets, not greedy groups or the original total', () => {
    const source = richSource();
    const result = allocateFinancialSplit(source, {
      mode: 'custom',
      n_splits: 3,
      amounts: ['1.01', '2998.99', '5000.00'],
    });
    expect(result.accounts.map((account) => account.grand_total)).toEqual([
      '1.01',
      '2998.99',
      '5000.00',
    ]);
    assertConservation(source, result);
  });

  it('preserves the exact paid economic snapshot across equal, custom and item grouping', () => {
    const source = richSource();
    const equal = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 2,
    });
    const thirds = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 3,
    });
    const custom = allocateFinancialSplit(source, {
      mode: 'custom',
      n_splits: 2,
      amounts: ['1999.99', '6000.01'],
    });
    const items = allocateFinancialSplit(source, {
      mode: 'items',
      item_groups: [{ order_item_ids: [2] }, { order_item_ids: [1] }],
    });
    for (const result of [thirds, custom, items]) {
      expect(result.retained_account).toEqual(equal.retained_account);
      assertConservation(source, result);
    }
    expect(
      items.accounts[0].lines
        .filter((line) => line.kind === 'item')
        .map((line) => line.source_order_item_id),
    ).toEqual([2]);
    expect(
      items.accounts[1].lines
        .filter((line) => line.kind === 'item')
        .map((line) => line.source_order_item_id),
    ).toEqual([1]);
  });

  it('balances columns as well as rows when independent remainder allocation would give all three cents to account 1', () => {
    const source = basicSource(['0.01', '0.01', '0.01']);
    const result = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 3,
    });
    expect(result.accounts.map((account) => account.grand_total)).toEqual([
      '0.01',
      '0.01',
      '0.01',
    ]);
    assertConservation(source, result);
  });

  it('allows more accounts than physical lines without manufacturing empty accounts', () => {
    const source = basicSource(['10.00']);
    const result = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 3,
    });
    expect(result.accounts.map((account) => account.grand_total)).toEqual([
      '3.34',
      '3.33',
      '3.33',
    ]);
    assertConservation(source, result);
  });

  it('keeps IVA/INC, compound and inclusive tax snapshots separate without repricing', () => {
    const source = basicSource(['100.00', '50.00']);
    source.items[0].taxes = [
      tax('19.00'),
      tax('8.00', {
        tax_rate_id: 2,
        tax_name: 'INC',
        tax_rate: '0.08',
        tax_type: 'inc',
        is_inclusive: true,
        is_compound: true,
      }),
    ];
    source.tax_amount = '27.00';
    source.grand_total = '177.00';
    const result = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 3,
    });
    assertConservation(source, result);
    expect(
      result.accounts
        .flatMap((account) => account.lines)
        .flatMap((line) => line.taxes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tax_type: 'inc',
          tax_rate: '0.08',
          is_compound: true,
          is_inclusive: true,
        }),
        expect.objectContaining({ tax_type: 'iva', tax_rate: '0.19' }),
      ]),
    );
  });

  it('supports fully discounted lines and real shipping/tip without making a negative base', () => {
    const source = basicSource(['20.00', '10.00'], '3.00');
    source.discount_amount = '30.00';
    source.shipping_cost = '8.00';
    source.tip_amount = '2.00';
    source.grand_total = '10.00';
    for (const request of [
      { mode: 'equal', n_splits: 2 },
      {
        mode: 'items',
        item_groups: [{ order_item_ids: [1] }, { order_item_ids: [2] }],
      },
    ] as FinancialSplitRequest[]) {
      assertConservation(source, allocateFinancialSplit(source, request));
    }
  });

  it('uses bigint products at the full Decimal(12,2) limit', () => {
    const source = basicSource(['9999999999.99']);
    const result = allocateFinancialSplit(source, {
      mode: 'equal',
      n_splits: 3,
    });
    expect(result.accounts.map((account) => account.grand_total)).toEqual([
      '3333333333.33',
      '3333333333.33',
      '3333333333.33',
    ]);
    assertConservation(source, result);
  });

  it('is deterministic under source item/tax row permutations and does not mutate inputs', () => {
    const source = richSource();
    source.items[0].taxes = [
      tax('600.00'),
      tax('426.00', { tax_name: 'Second', tax_rate_id: 2 }),
    ];
    const before = JSON.stringify(source);
    const request: FinancialSplitRequest = { mode: 'equal', n_splits: 7 };
    const expected = allocateFinancialSplit(source, request);
    const reordered = JSON.parse(before) as FinancialSplitSource;
    reordered.items.reverse();
    reordered.items.forEach((item) => item.taxes.reverse());
    expect(allocateFinancialSplit(reordered, request)).toEqual(expected);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each([
    { mode: 'equal', n_splits: 1 },
    { mode: 'equal', n_splits: 21 },
    { mode: 'equal', n_splits: 2.5 },
    { mode: 'custom', n_splits: 2, amounts: ['5500.00', '5499.99'] },
    { mode: 'custom', n_splits: 2, amounts: ['5500.00', '5500.01'] },
    { mode: 'custom', n_splits: 2, amounts: ['11000.00'] },
    {
      mode: 'items',
      item_groups: [{ order_item_ids: [1] }, { order_item_ids: [1, 2] }],
    },
    {
      mode: 'items',
      item_groups: [{ order_item_ids: [1] }, { order_item_ids: [999] }],
    },
    {
      mode: 'items',
      item_groups: [{ order_item_ids: [1] }, { order_item_ids: [] }],
    },
  ] as FinancialSplitRequest[])(
    'rejects invalid split request %j',
    (request) => {
      expect(() => allocateFinancialSplit(basicSource(), request)).toThrow(
        SplitAllocationError,
      );
    },
  );

  it.each(['0.00', '-1.00'])(
    'rejects nonpositive custom account %s',
    (amount) => {
      const rest = amount === '0.00' ? '11000.00' : '11001.00';
      expect(() =>
        allocateFinancialSplit(basicSource(), {
          mode: 'custom',
          n_splits: 2,
          amounts: [amount, rest],
        }),
      ).toThrow(expect.objectContaining({ code: 'EMPTY_ACCOUNT' }));
    },
  );

  it('rejects a zero remaining share by item instead of silently dropping an account', () => {
    const source = basicSource(['0.00', '1.00']);
    expect(() =>
      allocateFinancialSplit(source, {
        mode: 'items',
        item_groups: [{ order_item_ids: [1] }, { order_item_ids: [2] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'EMPTY_ACCOUNT' }));
  });

  it('rejects more positive accounts than remaining cents', () => {
    expect(() =>
      allocateFinancialSplit(basicSource(['0.01']), {
        mode: 'equal',
        n_splits: 2,
      }),
    ).toThrow(expect.objectContaining({ code: 'EMPTY_ACCOUNT' }));
  });

  it.each([
    ['grand total mismatch', { grand_total: '11000.01' }],
    [
      'line base mismatch',
      { subtotal_amount: '11001.00', grand_total: '11001.00' },
    ],
    ['line tax mismatch', { tax_amount: '1.00', grand_total: '11001.00' }],
    ['negative shipping', { shipping_cost: '-1.00', grand_total: '10999.00' }],
    ['fully paid', { paid_total: '11000.00' }],
    ['overpaid', { paid_total: '11000.01' }],
    ['negative paid', { paid_total: '-1.00' }],
    [
      'discount exceeds base',
      { discount_amount: '12000.00', grand_total: '0.00' },
    ],
  ])('fails closed on %s', (_label, override) => {
    expect(() =>
      allocateFinancialSplit(
        { ...basicSource(), ...override },
        { mode: 'equal', n_splits: 2 },
      ),
    ).toThrow(SplitAllocationError);
  });

  it('rejects duplicate source identities', () => {
    const source = basicSource();
    source.items[1].id = 1;
    expect(() =>
      allocateFinancialSplit(source, { mode: 'equal', n_splits: 2 }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SOURCE' }));
  });

  it('preserves exact row/column/line totals over 120 deterministic generated inputs and 2–20 accounts', () => {
    let seed = 731;
    const random = (max: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % max;
    };
    for (let sample = 0; sample < 120; sample += 1) {
      const bases = Array.from(
        { length: 1 + random(7) },
        () => 100 + random(100000),
      );
      const source = basicSource(bases.map((base) => money(base)));
      const baseTotal = bases.reduce((a, b) => a + b, 0);
      const discount = random(Math.floor(baseTotal / 2) + 1);
      const shipping = random(1000);
      const tip = random(1000);
      let taxTotal = 0;
      source.items.forEach((item) => {
        const first = random(5000);
        const second = random(2000);
        taxTotal += first + second;
        item.taxes = [
          tax(money(first)),
          tax(money(second), {
            tax_rate_id: 2,
            tax_name: 'INC',
            tax_type: 'inc',
            tax_rate: '0.08',
          }),
        ];
      });
      const total = baseTotal - discount + taxTotal + shipping + tip;
      const count = 2 + random(19);
      const paid = random(total - count);
      Object.assign(source, {
        discount_amount: money(discount),
        tax_amount: money(taxTotal),
        shipping_cost: money(shipping),
        tip_amount: money(tip),
        grand_total: money(total),
        paid_total: money(paid),
      });
      const equal = allocateFinancialSplit(source, {
        mode: 'equal',
        n_splits: count,
      });
      assertConservation(source, equal);
      let remainder = total - paid;
      const targets = Array.from({ length: count }, (_, index) => {
        const amount =
          index === count - 1
            ? remainder
            : 1 + random(remainder - (count - index - 1));
        remainder -= amount;
        return money(amount);
      });
      const custom = allocateFinancialSplit(source, {
        mode: 'custom',
        n_splits: count,
        amounts: targets,
      });
      expect(custom.accounts.map((account) => account.grand_total)).toEqual(
        targets,
      );
      expect(custom.retained_account).toEqual(equal.retained_account);
      assertConservation(source, custom);
    }
  });
});

describe('split money serialization', () => {
  it.each([
    'NaN',
    'Infinity',
    '-Infinity',
    '0.001',
    '99999999999.99',
    '1e1000000000',
    '',
  ])('rejects unsafe money %s instead of rounding', (value) => {
    expect(() => getCents(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_MONEY' }),
    );
  });
  it('accepts Prisma Decimal and serializes exact cents without float drift', () => {
    expect(getCents(new Prisma.Decimal('2424.99'))).toBe(242499n);
    expect(formatCents(242499n)).toBe('2424.99');
    expect(formatCents(-1n)).toBe('-0.01');
    expect(formatCents(0n)).toBe('0.00');
  });
});
