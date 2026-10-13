import {
  CreateCreditNoteDto,
  CreateDebitNoteDto,
  InvoiceItem,
  InvoiceNoteContextLine,
} from '../../interfaces/invoice.interface';
import { buildNoteItems, buildNotePayload, estimateLine, noteTotals } from './invoice-note-payload.util';

const source: InvoiceItem = {
  id: 41,
  invoice_id: 7,
  product_name: 'Producto fuente',
  quantity: 2,
  unit_price: 100,
  discount_amount: 10,
  tax_amount: 1.27,
  total_amount: 7.94,
  unit_code: 'KGM',
  price_unit_quantity: 12,
};

const context: InvoiceNoteContextLine = {
  source_invoice_item_id: 41,
  description: 'Producto fuente',
  quantity: 2,
  unit_price: 100,
  discount_amount: 10,
  unit_code: 'KGM',
  price_unit_quantity: 12,
  is_inclusive: false,
  taxes: [{
    tax_name: 'IVA', tax_type: 'iva', tax_rate: 19,
    rate_basis: 'percent', is_inclusive: false,
  }],
  remaining_quantity: 2,
  remaining_base: 6.67,
  remaining_total: 7.94,
};

describe('invoice-note-payload.util', () => {
  it('builds minimal explicit note lines without fiscal or catalog fields', () => {
    const items = buildNoteItems([{
      item: source,
      quantity: 1.5,
      unit_price: 120,
      discount_amount: 7,
      unit_code: 'LTR',
      context,
    }]);

    expect(items).toEqual([{
      source_invoice_item_id: 41,
      quantity: 1.5,
      unit_price: 120,
      discount_amount: 7,
      unit_code: 'LTR',
    }]);
    expect('taxes' in items[0]).toBeFalse();
    expect('tax_amount' in items[0]).toBeFalse();
    expect('product_id' in items[0]).toBeFalse();
    expect('description' in items[0]).toBeFalse();
    expect('price_unit_quantity' in items[0]).toBeFalse();
  });

  it('estimates with captured taxes and treats an explicit discount as replacement', () => {
    const result = estimateLine({
      item: source,
      quantity: 1,
      unit_price: 20,
      discount_amount: 2,
      context: { ...context, price_unit_quantity: 1, taxes: [{ ...context.taxes[0], tax_rate: 10 }] },
    });
    expect(result).toEqual({
      quantity: 1, unit_price: 20, discount_amount: 2,
      tax_amount: 1.8, base: 18, total: 19.8,
    });
  });

  it('omits an unmodified prorated default so the server owns the effective allowance', () => {
    const [line] = buildNoteItems([{
      item: source,
      quantity: 0.5,
      context,
      discount_overridden: false,
    }]);
    expect('discount_amount' in line).toBeFalse();
  });

  it('estimates pack pricing using the captured price-unit divisor', () => {
    const selection = {
      item: source,
      quantity: 2,
      context: {
        ...context,
        price_unit_quantity: 12,
        taxes: [{ ...context.taxes[0], tax_rate: 19 }],
      },
    };

    expect(estimateLine(selection)).toEqual({
      quantity: 2, unit_price: 100, discount_amount: 10,
      tax_amount: 1.27, base: 6.67, total: 7.94,
    });
    expect(noteTotals([selection])).toEqual({ subtotal: 16.67, discount: 10, tax: 1.27, total: 7.94 });
  });

  it('omits all line amounts for total notes and keeps both note DTOs source-only', () => {
    const payload = buildNotePayload({
      invoice: { id: 7 } as never,
      scope: 'total',
      conceptCode: '1',
      conceptLabel: 'Anulación',
      reason: 'Corrección',
      selections: [{ item: source, quantity: 2 }],
    });
    expect('items' in payload).toBeFalse();
    expect('taxes' in payload).toBeFalse();

    const credit: CreateCreditNoteDto = { related_invoice_id: 7, items: buildNoteItems([{ item: source, quantity: 1 }]) };
    const debit: CreateDebitNoteDto = { related_invoice_id: 7, items: buildNoteItems([{ item: source, quantity: 1 }]) };
    expect(credit.items?.[0].source_invoice_item_id).toBe(41);
    expect(debit.items?.[0].source_invoice_item_id).toBe(41);
  });
});
