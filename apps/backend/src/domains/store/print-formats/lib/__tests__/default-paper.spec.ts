/**
 * [print-editor-dsk P7] — Unit tests for `defaultPaperFor()`.
 *
 * The contract this file pins:
 *   1. Every known `PrintFormatTypeEnum` value resolves to the table
 *      value published in the spec (thermal_80 vs letter vs a4).
 *   2. Unknown format types fall back to `'letter'`, not `undefined`.
 */

import { defaultPaperFor } from '../default-paper';

describe('defaultPaperFor (P7 — paper fallback)', () => {
  it('1a. thermal_80 defaults — pos_sale_ticket, kitchen_ticket, dispatch_ticket', () => {
    expect(defaultPaperFor('pos_sale_ticket')).toBe('thermal_80');
    expect(defaultPaperFor('kitchen_ticket')).toBe('thermal_80');
    expect(defaultPaperFor('dispatch_ticket')).toBe('thermal_80');
  });

  it('1b. a4 default — dispatch_note', () => {
    expect(defaultPaperFor('dispatch_note')).toBe('a4');
  });

  it('1c. letter defaults — sales_order_invoice, quotation, credit_note, purchase_order, transfer_note, fiscal_electronic_invoice, fiscal_credit_note', () => {
    const letterFormats = [
      'sales_order_invoice',
      'quotation',
      'credit_note',
      'purchase_order',
      'transfer_note',
      'fiscal_electronic_invoice',
      'fiscal_credit_note',
    ];
    for (const format of letterFormats) {
      expect(defaultPaperFor(format as any)).toBe('letter');
    }
  });

  it('2. falls back to "letter" for unknown format types', () => {
    // 'nonsense_format' isn't in the enum — fallback must yield 'letter',
    // NOT throw, NOT return undefined. The renderer assumes a defined
    // PaperFormat downstream.
    expect(defaultPaperFor('nonsense_format' as any)).toBe('letter');
    expect(defaultPaperFor('' as any)).toBe('letter');
  });
});
