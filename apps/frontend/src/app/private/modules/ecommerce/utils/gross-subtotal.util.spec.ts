import { grossLineTotal, sumGrossSubtotal } from './gross-subtotal.util';

describe('gross-subtotal.util', () => {
  it('suma line_total_gross de las líneas', () => {
    expect(
      sumGrossSubtotal([{ line_total_gross: 119 }, { line_total_gross: 59.5 }]),
    ).toBeCloseTo(178.5, 2);
  });

  it('excluye las líneas canceladas', () => {
    expect(
      sumGrossSubtotal([
        { line_total_gross: 119 },
        { line_total_gross: 59.5, cancelled_at: '2026-01-01T10:00:00Z' },
      ]),
    ).toBe(119);
  });

  it('cae a total_price_gross, luego total_price y total', () => {
    expect(grossLineTotal({ total_price_gross: 10, total_price: 8 })).toBe(10);
    expect(grossLineTotal({ total_price: 8 })).toBe(8);
    expect(grossLineTotal({ total: 5 })).toBe(5);
  });

  it('acepta strings numéricos y listas vacías o nulas', () => {
    expect(sumGrossSubtotal([{ line_total_gross: '12.5' }])).toBe(12.5);
    expect(sumGrossSubtotal([])).toBe(0);
    expect(sumGrossSubtotal(null)).toBe(0);
    expect(grossLineTotal({})).toBe(0);
  });
});
