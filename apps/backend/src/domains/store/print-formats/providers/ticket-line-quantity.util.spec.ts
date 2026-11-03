import { formatTicketLineQuantity } from './ticket-line-quantity.util';

describe('formatTicketLineQuantity (QUI-978)', () => {
  it('prints the sale-unit snapshot chosen by the cashier', () => {
    expect(
      formatTicketLineQuantity({
        quantity: 250,
        sale_unit_code_snapshot: 'lb',
        sale_quantity_snapshot: '0.5',
        products: { stock_uom: { code: 'g' } },
      }),
    ).toBe('0,5 lb');
  });

  it('prints grams when the cashier weighed 300 g', () => {
    expect(
      formatTicketLineQuantity({
        quantity: 300,
        sale_unit_code_snapshot: 'g',
        sale_quantity_snapshot: 300,
      }),
    ).toBe('300 g');
  });

  it('falls back to the legacy scale weight', () => {
    expect(
      formatTicketLineQuantity({ quantity: 1, weight: '1.25', weight_unit: 'kg' }),
    ).toBe('1,25 kg');
  });

  it('falls back to the product stock UoM for orders without snapshot', () => {
    expect(
      formatTicketLineQuantity({
        quantity: 300,
        sale_unit_code_snapshot: null,
        sale_quantity_snapshot: null,
        weight: null,
        products: { stock_uom: { code: 'g' } },
      }),
    ).toBe('300 g');
  });

  it('keeps the bare number for piece and package lines', () => {
    expect(formatTicketLineQuantity({ quantity: 2, products: null })).toBeUndefined();
    expect(
      formatTicketLineQuantity({
        quantity: 2,
        stock_units_consumed: 24,
        products: { stock_uom: { code: 'und' } },
      }),
    ).toBeUndefined();
  });
});
