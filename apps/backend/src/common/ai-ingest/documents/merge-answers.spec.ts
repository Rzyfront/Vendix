import { mergeFormAnswers } from './merge-answers';
import { buildFormInstruction, conflictWarnings, scanSourceOf } from './form-instruction';

describe('mergeFormAnswers (F5b: one form read in parts)', () => {
  it('one answer is returned as is', () => {
    const data = { nit: '900123456', field_confidence: { nit: 90 } };
    expect(mergeFormAnswers([data])).toEqual({ data, conflicts: [] });
  });

  it('first page that has a value wins, objects merge key by key, lowest confidence, notes joined', () => {
    const merged = mergeFormAnswers([
      { nit: '900123456', legal_name: '', tax_responsibilities: [], field_confidence: { nit: 95 }, confidence: 90, extraction_notes: 'Hoja 1' },
      { nit: '900123457', legal_name: 'ACME', tax_responsibilities: ['05'], field_confidence: { nit: 40, legal_name: 80 }, confidence: 70, extraction_notes: 'Hoja 2' },
    ]);
    expect(merged.data).toEqual({
      nit: '900123456',
      legal_name: 'ACME',
      tax_responsibilities: ['05'],
      field_confidence: { nit: 95, legal_name: 80 },
      confidence: 70,
      extraction_notes: 'Hoja 1 Hoja 2',
    });
    expect(merged.conflicts).toEqual(['nit']);
    expect(conflictWarnings(merged.conflicts, { nit: 'NIT' })[0]).toContain('«NIT»');
  });

  it('the same value written as number and text is not a conflict', () => {
    expect(mergeFormAnswers([{ range_to: 5000 }, { range_to: '5000' }]).conflicts).toEqual([]);
  });
});

describe('buildFormInstruction', () => {
  const ctx = (totalPages: number, totalBatches: number) => ({ totalPages, totalBatches });
  const image = { page_number: 1, mode: 'image' as const, text: '', image: 'x' };
  const text = { page_number: 2, mode: 'text' as const, text: 't' };

  it('one photo in one call: the scanner request word for word', () => {
    expect(buildFormInstruction('REQ', [image], ctx(1, 1))).toBe('REQ');
  });

  it('PDF pages: the request plus how pages come; a part says which pages it holds', () => {
    expect(buildFormInstruction('REQ', [text], ctx(1, 1))).toContain('The pages follow');
    const part = buildFormInstruction('REQ', [text], ctx(12, 2), 'LINES');
    expect(part).toContain('This message holds only page 2 out of 12 pages');
    expect(part).toContain('LINES');
  });

  it('scanSourceOf: documents only for several files; missing pages only when any', () => {
    expect(
      scanSourceOf({ answers: [], batches: [{ pages: [1], data: {} }], pages: 1, textPages: 1, missingPages: [], warnings: [] }),
    ).toEqual({ pages: 1, text_pages: 1, batches: 1 });
    expect(
      scanSourceOf({ batches: [], documents: 2, pages: 3, textPages: 0, missingPages: [{ document: 2, page: 1 }], warnings: [] }),
    ).toEqual({ documents: 2, pages: 3, text_pages: 0, batches: 0, missing_pages: [{ document: 2, page: 1 }] });
  });

  it('LAX_LIST keeps a lone number as is (ajv coerceTypes never turns 13 into "13")', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ajv = require('ajv');
    const { LAX_LIST } = require('../extraction/lax-schema');
    const validate = new Ajv({ coerceTypes: true, strict: false }).compile({
      type: 'object',
      properties: { list: LAX_LIST },
    });
    const data: any = { list: 13 };
    expect(validate(data)).toBe(true);
    expect(data.list).toBe(13);
  });
});
