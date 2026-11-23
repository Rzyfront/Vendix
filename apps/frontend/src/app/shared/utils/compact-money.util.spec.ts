import { formatCompactMoney } from './compact-money.util';

describe('formatCompactMoney (QUI-1017)', () => {
  it('pone el signo antes del símbolo', () => {
    expect(formatCompactMoney(-5_900_000)).toBe('-$5.9M');
    expect(formatCompactMoney(-12_345)).toBe('-$12.3K');
    expect(formatCompactMoney(-950)).toBe('-$950');
  });

  it('positivos sin cambios y cero sin signo', () => {
    expect(formatCompactMoney(5_900_000)).toBe('$5.9M');
    expect(formatCompactMoney(1_500)).toBe('$1.5K');
    expect(formatCompactMoney(0)).toBe('$0');
    expect(formatCompactMoney(-0.2)).toBe('$0');
    expect(formatCompactMoney(null)).toBe('$0');
  });

  it('modo eje: enteros', () => {
    expect(formatCompactMoney(-5_900_000, { mode: 'axis' })).toBe('-$6M');
    expect(formatCompactMoney(2_300, { mode: 'axis' })).toBe('$2K');
  });

  it('símbolo después y símbolo con espacio', () => {
    expect(formatCompactMoney(-1_500, { symbol: '€', position: 'after' })).toBe('-1.5K€');
    expect(formatCompactMoney(-2_000_000, { symbol: '$ ' })).toBe('-$ 2.0M');
  });
});
