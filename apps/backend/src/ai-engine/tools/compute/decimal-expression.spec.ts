import {
  ExpressionError,
  evaluateDecimalExpression as ev,
} from './decimal-expression';
import {
  computeGrowth,
  productMarginPct,
  round2,
} from '../../../domains/store/analytics/analytics-metrics.contract';

describe('evaluateDecimalExpression', () => {
  it('respeta precedencia y paréntesis', () => {
    expect(ev('2 + 3 * 4').value).toBe('14');
    expect(ev('(2 + 3) * 4').value).toBe('20');
    expect(ev('-(2 + 3) * 2').value).toBe('-10');
    expect(ev('10 - 4 - 3').value).toBe('3');
  });

  it('suma decimal exacta (0.1 + 0.2 = 0.3)', () => {
    expect(ev('0.1 + 0.2').value).toBe('0.3');
  });

  it('resuelve variables por nombre', () => {
    expect(ev('a * b', { a: 3, b: '1.5' }).value).toBe('4.5');
  });

  it('cubre cada función', () => {
    expect(ev('round(2.345, 2)').value).toBe('2.35');
    expect(ev('round(-2.345, 2)').value).toBe('-2.35');
    expect(ev('round(2.5)').value).toBe('3');
    expect(ev('abs(-4)').value).toBe('4');
    expect(ev('min(3, 1, 2)').value).toBe('1');
    expect(ev('max(3, 1, 2)').value).toBe('3');
    expect(ev('sum(1, 2, 3.5)').value).toBe('6.5');
    expect(ev('avg(1, 2, 3, 4)').value).toBe('2.5');
    expect(ev('pct(25, 200)').value).toBe('12.5');
    expect(ev('pct_change(150, 100)').value).toBe('50');
    expect(ev('margin(200, 150)').value).toBe('25');
  });

  it('división por cero devuelve null con motivo, no un número', () => {
    const r = ev('10 / (5 - 5)');
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/cero/i);
    expect(ev('pct(5, 0)').value).toBeNull();
    // el null se propaga, no se vuelve 0
    expect(ev('1 + 10 / 0').value).toBeNull();
  });

  it('pct_change con base 0 devuelve null con motivo', () => {
    const r = ev('pct_change(10, 0)');
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/base/i);
  });

  it('margin con ingreso <= 0 devuelve null', () => {
    expect(ev('margin(0, 5)').value).toBeNull();
  });

  it('variable desconocida lanza error tipado', () => {
    expect(() => ev('x + 1')).toThrow(ExpressionError);
    expect(() => ev('x + 1')).toThrow(/Variable desconocida "x"/);
  });

  it('sintaxis inválida lanza error tipado', () => {
    expect(() => ev('2 +')).toThrow(ExpressionError);
    expect(() => ev('(2')).toThrow(ExpressionError);
    expect(() => ev('2 3')).toThrow(ExpressionError);
    expect(() => ev('round()')).toThrow(ExpressionError);
  });

  it('rechaza expresión demasiado larga', () => {
    expect(() => ev('1+'.repeat(300) + '1')).toThrow(/500 caracteres/);
  });

  it('rechaza profundidad excesiva', () => {
    const deep = '('.repeat(40) + '1' + ')'.repeat(40);
    expect(() => ev(deep)).toThrow(/anida/);
  });

  it.each([
    'constructor',
    'constructor("return 1")()',
    'process.exit()',
    'a.b',
    '__proto__',
    'toString()',
    'a["b"]',
  ])('rechaza intento de inyección: %s', (src) => {
    expect(() => ev(src, { a: 1 })).toThrow(ExpressionError);
  });

  it('coincide con el módulo de analítica (variación y margen)', () => {
    const pairs: Array<[number, number]> = [
      [1234.56, 987.65],
      [100, 0],
      [50, 80],
      [-20, -40],
    ];
    for (const [cur, prev] of pairs) {
      const g = computeGrowth(cur, prev);
      const mine = ev('round(pct_change(cur, prev), 2)', { cur, prev }).value;
      expect(mine === null ? null : Number(mine)).toBe(g === null ? null : round2(g));
    }
    for (const [revenue, cost] of pairs) {
      const m = productMarginPct(revenue, revenue - cost);
      const mine = ev('round(margin(revenue, cost), 2)', { revenue, cost }).value;
      expect(mine === null ? null : Number(mine)).toBe(m);
    }
  });
});
