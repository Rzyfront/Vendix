import {
  assertTipAllowed,
  isTipPolicyActive,
  resolveTip,
  resolveTipPolicy,
  TipPolicy,
} from './tip.util';
import { VendixHttpException } from '../errors/vendix-http.exception';

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

describe('resolveTip — fixed por tip_value', () => {
  const round = (v: number) => Math.round(v * 100) / 100;
  it('fixed + tip_value sin tip_amount resuelve al monto', () => {
    expect(
      resolveTip({ tip_type: 'fixed', tip_value: 5000 }, 119000, round),
    ).toEqual({ amount: 5000, type: 'fixed', value: 5000 });
  });
  it('tip_amount directo gana sobre fixed tip_value', () => {
    expect(
      resolveTip(
        { tip_amount: 3000, tip_type: 'fixed', tip_value: 5000 },
        119000,
        round,
      ),
    ).toEqual({ amount: 3000, type: 'fixed', value: 5000 });
  });
});

describe('resolveTipPolicy', () => {
  it('enabled undefined + restaurante => manual true', () => {
    expect(resolveTipPolicy({}, true).manualEnabled).toBe(true);
    expect(resolveTipPolicy(undefined, true).manualEnabled).toBe(true);
  });
  it('enabled undefined + no restaurante => manual false', () => {
    expect(resolveTipPolicy(null, false).manualEnabled).toBe(false);
  });
  it('enabled=false explicito en restaurante => manual false', () => {
    expect(resolveTipPolicy({ enabled: false }, true).manualEnabled).toBe(false);
  });
  it('sugerida con value 0 => null', () => {
    expect(
      resolveTipPolicy(
        { suggested_enabled: true, suggested_type: 'fixed', suggested_value: 0 },
        false,
      ).suggested,
    ).toBeNull();
  });
  it('sugerida activa => type/value', () => {
    const p = resolveTipPolicy(
      { suggested_enabled: true, suggested_type: 'percentage', suggested_value: 10 },
      false,
    );
    expect(p.suggested).toEqual({ type: 'percentage', value: 10 });
    expect(isTipPolicyActive(p)).toBe(true);
  });
});

describe('assertTipAllowed', () => {
  const round = (v: number) => Math.round(v * 100) / 100;
  const base = 100000;
  const policy = (
    manualEnabled: boolean,
    suggested: TipPolicy['suggested'],
  ): TipPolicy => ({ manualEnabled, suggested });
  const sug = { type: 'percentage' as const, value: 10 };

  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(VendixHttpException);
      return (err as VendixHttpException).errorCode;
    }
    return undefined;
  };

  it.each([
    ['ninguno', policy(false, null)],
    ['manual', policy(true, null)],
    ['sugerida', policy(false, sug)],
    ['ambos', policy(true, sug)],
  ])('propina 0 siempre valida (%s)', (_n, p) => {
    expect(codeOf(() => assertTipAllowed({}, p, base, round))).toBeUndefined();
    expect(
      codeOf(() => assertTipAllowed({ tip_amount: 0 }, p, base, round)),
    ).toBeUndefined();
  });

  it('ninguno activo + propina > 0 => TIP_NOT_ENABLED_001', () => {
    expect(
      codeOf(() =>
        assertTipAllowed({ tip_amount: 500 }, policy(false, null), base, round),
      ),
    ).toBe('TIP_NOT_ENABLED_001');
  });

  it('solo manual + propina > 0 => ok', () => {
    expect(
      codeOf(() =>
        assertTipAllowed({ tip_amount: 777 }, policy(true, null), base, round),
      ),
    ).toBeUndefined();
  });

  it('solo sugerida + monto distinto => TIP_NOT_SUGGESTED_001', () => {
    expect(
      codeOf(() =>
        assertTipAllowed({ tip_amount: 500 }, policy(false, sug), base, round),
      ),
    ).toBe('TIP_NOT_SUGGESTED_001');
  });

  it('solo sugerida + mismo type/value => ok', () => {
    expect(
      codeOf(() =>
        assertTipAllowed(
          { tip_type: 'percentage', tip_value: 10 },
          policy(false, sug),
          base,
          round,
        ),
      ),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        assertTipAllowed({ tip_amount: 10000 }, policy(false, sug), base, round),
      ),
    ).toBeUndefined();
  });

  it('ambos + monto libre => ok', () => {
    expect(
      codeOf(() =>
        assertTipAllowed({ tip_amount: 500 }, policy(true, sug), base, round),
      ),
    ).toBeUndefined();
  });
});
