import {
  buildPlatformNotePayload,
  estimateLinesTotal,
  exceedsCreditBalance,
  validatePlatformNote,
  type PlatformNoteFormState,
} from './platform-invoice-note-payload.util';

const baseState: PlatformNoteFormState = {
  relatedInvoiceId: 42,
  noteType: 'credit_note',
  conceptCode: '2',
  reason: '  Factura emitida por error  ',
  mode: 'total',
  lines: [
    { description: 'Plan Pro', quantity: 1, unit_price: 100000, unit_code: 'EA', tax_rate: 19 },
  ],
};

describe('platform invoice note payload', () => {
  it('total credit note sends no items', () => {
    const body = buildPlatformNotePayload(baseState);
    expect(body).toEqual({
      related_invoice_id: 42,
      note_concept_code: '2',
      reason: 'Factura emitida por error',
    });
    expect('items' in body).toBe(false);
  });

  it('by-lines credit note sends numeric items and omits tax_rate', () => {
    const body = buildPlatformNotePayload({
      ...baseState,
      mode: 'lines',
      lines: [
        { description: ' Plan Pro ', quantity: 2 as number, unit_price: Number('50000'), unit_code: 'EA', tax_rate: 19 },
        { description: 'Extra', quantity: 1, unit_price: 10, tax_rate: 0 },
      ],
    });
    expect(body.items).toEqual([
      { description: 'Plan Pro', quantity: 2, unit_price: 50000, unit_code: 'EA' },
      { description: 'Extra', quantity: 1, unit_price: 10 },
    ]);
  });

  it('debit note always sends items, even when mode is total', () => {
    const body = buildPlatformNotePayload({ ...baseState, noteType: 'debit_note' });
    expect(body.items?.length).toBe(1);
  });

  it('estimates totals with tax and detects balance overflow', () => {
    expect(estimateLinesTotal(baseState.lines)).toBe(119000);
    expect(exceedsCreditBalance(119000.01, 119000)).toBe(true);
    expect(exceedsCreditBalance(119000, 119000)).toBe(false);
  });

  it('validates reason, concept and lines', () => {
    expect(validatePlatformNote(baseState)).toEqual([]);
    expect(validatePlatformNote({ ...baseState, conceptCode: '', reason: ' ' })).toEqual([
      'Selecciona el concepto DIAN.',
      'El motivo es obligatorio.',
    ]);
    expect(
      validatePlatformNote({ ...baseState, reason: 'x'.repeat(501) }),
    ).toContain('El motivo no puede superar 500 caracteres.');
    expect(
      validatePlatformNote({ ...baseState, mode: 'lines', lines: [] }),
    ).toContain('Agrega al menos una línea.');
  });
});
