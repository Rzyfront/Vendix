import { InvoiceRevalidateDivergence } from '../interfaces/invoice-scanner.interface';
import {
  buildDivergenceView,
  divergenceFieldLabel,
  divergenceValuesEqual,
  formatDivergenceValue,
} from './revalidate-divergence-format.util';

const money = (n: number): string => '$' + n.toLocaleString('es-CO');

const TAXES = [
  { type: 'iva', rate: 19, fixed_amount_per_unit: null, amount: null, inclusive: false },
  { type: 'ibua', rate: null, fixed_amount_per_unit: 65, amount: null, inclusive: false },
];

function div(over: Partial<InvoiceRevalidateDivergence>): InvoiceRevalidateDivergence {
  return {
    line_index: 0,
    field: 'total',
    consolidated_value: 1,
    document_value: 1,
    revalidated_value: 1,
    reason: 'r',
    ...over,
  };
}

describe('revalidate-divergence-format.util', () => {
  it('etiqueta el campo y distingue total de línea y de cabecera', () => {
    expect(divergenceFieldLabel('taxes', 0)).toBe('Impuestos');
    expect(divergenceFieldLabel('total', 2)).toBe('Total de línea');
    expect(divergenceFieldLabel('total', null)).toBe('Total');
    expect(divergenceFieldLabel('some_new_field', null)).toBe('Some new field');
  });

  it('formatea la lista de impuestos sin JSON crudo', () => {
    expect(formatDivergenceValue('taxes', TAXES, money)).toBe('IVA 19 % · IBUA $65/u');
    expect(formatDivergenceValue('taxes', [], money)).toBe('Sin impuesto');
    expect(
      formatDivergenceValue('taxes', [{ type: 'iva', rate: null, amount: 1234, inclusive: true }], money),
    ).toBe('IVA $1.234 (incluido)');
  });

  it('formatea moneda, porcentaje, vacío y objetos', () => {
    expect(formatDivergenceValue('total', 44400, money)).toBe('$44.400');
    expect(formatDivergenceValue('discount_percent', 19, money)).toBe('19 %');
    expect(formatDivergenceValue('total', null, money)).toBe('—');
    expect(formatDivergenceValue('x', { a: 1 }, money)).not.toContain('{');
  });

  it('compara con tolerancia y taxes sin importar el orden', () => {
    expect(divergenceValuesEqual(100, 100.004)).toBeTrue();
    expect(divergenceValuesEqual(100, 100.01)).toBeFalse();
    expect(divergenceValuesEqual(TAXES, [...TAXES].reverse())).toBeTrue();
    expect(divergenceValuesEqual(TAXES, [TAXES[0]])).toBeFalse();
  });

  it('filtra las filas iguales y cuenta las ocultas', () => {
    const rows = Array.from({ length: 9 }, () =>
      div({ field: 'taxes', consolidated_value: TAXES, document_value: TAXES, revalidated_value: [...TAXES].reverse() }),
    );
    const view = buildDivergenceView(rows, money);
    expect(view.rows.length).toBe(0);
    expect(view.hiddenCount).toBe(9);
  });

  it('una divergencia real de taxes se lee legible y resalta', () => {
    const view = buildDivergenceView(
      [div({ field: 'taxes', consolidated_value: [], document_value: TAXES, revalidated_value: TAXES })],
      money,
    );
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].revalidated).toBe('IVA 19 % · IBUA $65/u');
    expect(view.rows[0].consolidated).toBe('Sin impuesto');
    expect(view.rows[0].differs).toBeTrue();
  });

  it('user_override no se filtra aunque coincida y se rotula', () => {
    const view = buildDivergenceView([div({ reason: 'user_override: cambió el precio' })], money);
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].isUserDecision).toBeTrue();
    expect(view.rows[0].reason).toBe('cambió el precio');
    expect(view.rows[0].differs).toBeFalse();
  });
});
