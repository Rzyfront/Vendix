import { resolveTip } from './tip.util';

describe('resolveTip — E.6 gross product base', () => {
  const round = (value: number) =>
    Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

  it.each([
    {
      name: '10% of products including tax',
      input: { tip_type: 'percentage' as const, tip_value: 10 },
      grossProducts: 119000,
      expected: { amount: 11900, type: 'fixed', value: 11900 },
    },
    {
      name: 'direct amount overrides percentage',
      input: { tip_amount: 3000, tip_type: 'percentage' as const, tip_value: 10 },
      grossProducts: 119000,
      expected: { amount: 3000, type: 'fixed', value: 3000 },
    },
    {
      name: 'zero tip stays zero',
      input: { tip_type: 'percentage' as const, tip_value: 0 },
      grossProducts: 119000,
      expected: { amount: 0, type: 'percentage', value: 0 },
    },
  ])('$name', ({ input, grossProducts, expected }) => {
    expect(resolveTip(input, grossProducts, round)).toEqual(expected);
  });
});
