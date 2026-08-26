import {
  computeDocumentFormatHint,
  extractMinFromRegex,
} from './document-format-hint.util';

/**
 * QUI-723 — Unit tests for the document-format-hint util.
 *
 * Pure-function tests (no TestBed). Run with `ng test` (Karma + Jasmine).
 *
 * Coverage map:
 *   - empty input                         → null
 *   - no type selected                    → 'info' (count without range)
 *   - below min (CC, typed "123")         → 'info' (Faltan 3)
 *   - in range (CC, typed "12345678")     → 'ok' (✓ 8 entre 6 y 10)
 *   - above max (CC, typed 11 digits)     → 'warn' (1 carácter de más)
 *   - non-standard format (letters)       → 'warn' (formato no estándar)
 *   - singular vs plural                  → "1 carácter" / "N caracteres"
 *   - whitespace + lowercase input        → uppercased + trimmed
 *   - extractMinFromRegex parses \d{N,...} shape for every doc type
 */
describe('computeDocumentFormatHint', () => {
  it('returns null when the input is empty', () => {
    expect(computeDocumentFormatHint('CC', '')).toBeNull();
    expect(computeDocumentFormatHint('CC', '   ')).toBeNull();
    expect(computeDocumentFormatHint('CC', null)).toBeNull();
    expect(computeDocumentFormatHint('CC', undefined)).toBeNull();
  });

  it('returns null when only whitespace is typed', () => {
    expect(computeDocumentFormatHint('CC', '\t\n  ')).toBeNull();
  });

  it('shows "no type selected" hint when type is empty', () => {
    const hint = computeDocumentFormatHint(null, '12345678');
    expect(hint?.tone).toBe('info');
    expect(hint?.text).toContain('8 caracteres');
    expect(hint?.text).toContain('sin tipo de documento seleccionado');
  });

  it('shows "Faltan N" when typed digits are below the min (CC min=6)', () => {
    const hint = computeDocumentFormatHint('CC', '123');
    expect(hint?.tone).toBe('info');
    expect(hint?.text).toContain('Faltan 3');
    expect(hint?.text).toContain('mínimo 6');
    expect(hint?.text).toContain('Cédula de Ciudadanía');
    // Plural form (3 missing → "caracteres", not singular "carácter")
    expect(hint?.text).toContain('caracteres');
  });

  it('shows "✓ N caracteres — entre X y Y" when input is in range', () => {
    const hint = computeDocumentFormatHint('CC', '12345678');
    expect(hint?.tone).toBe('ok');
    expect(hint?.text).toContain('✓ 8 caracteres');
    expect(hint?.text).toContain('entre 6 y 10');
  });

  it('shows overflow warning with correct singular/plural for 1 char over', () => {
    const hint = computeDocumentFormatHint('CC', '12345678901'); // 11 digits
    expect(hint?.tone).toBe('warn');
    expect(hint?.text).toContain('1 carácter de más');
    expect(hint?.text).toContain('máximo 10');
  });

  it('uses plural form when overflow is more than 1 char', () => {
    const hint = computeDocumentFormatHint('CC', '1234567890123'); // 13 digits, 3 over
    expect(hint?.tone).toBe('warn');
    expect(hint?.text).toContain('3 caracteres de más');
  });

  it('shows "formato no estándar" when input fails regex but is in range length', () => {
    const hint = computeDocumentFormatHint('CC', '12AB56'); // 6 chars but not digits
    expect(hint?.tone).toBe('warn');
    expect(hint?.text).toContain('6 caracteres para Cédula de Ciudadanía');
    expect(hint?.text).toContain('formato no estándar');
  });

  it('normalizes whitespace and case (uppercases the number)', () => {
    const hint = computeDocumentFormatHint('cc', '  12345678  ');
    expect(hint?.tone).toBe('ok');
    expect(hint?.text).toContain('8 caracteres');
  });

  describe('per document type', () => {
    // overflow inputs MUST actually exceed the max so the util says 'warn'.
    // Earlier versions used inputs that were still in-range (e.g. NIT
    // '9001234567' = 10 digits = exactly at maxLength 12; PA 'AB...34' = 16
    // chars = at maxLength 16) and silently passed the warn assertion.
    const cases: Array<{
      type: string;
      valid: string;
      invalid: string; // one char too short
      overflow: string; // strictly over the max
      label: string;
      minHint?: string;
    }> = [
      { type: 'CC', valid: '1234567', invalid: '123', overflow: '1234567890123', label: 'Cédula de Ciudadanía', minHint: 'entre 6 y 10' },
      { type: 'CE', valid: '1234567', invalid: '123', overflow: '1234567890123', label: 'Cédula de Extranjería', minHint: 'entre 6 y 10' },
      { type: 'NIT', valid: '900123456', invalid: '1234', overflow: '9001234567890', label: 'NIT', minHint: 'entre 8 y 12' },
      { type: 'TI', valid: '12345678901', invalid: '123', overflow: '1234567890123', label: 'Tarjeta de Identidad', minHint: 'entre 8 y 11' },
      { type: 'RC', valid: '12345678901', invalid: '123', overflow: '1234567890123', label: 'Registro Civil', minHint: 'entre 8 y 11' },
      { type: 'PA', valid: 'AB12345', invalid: 'AB', overflow: 'AB1234567890123456', label: 'Pasaporte', minHint: 'entre 5 y 16' },
      { type: 'PEP', valid: '123456789', invalid: '123', overflow: '12345678901234567', label: 'Permiso Especial', minHint: 'entre 9 y 15' },
      { type: 'PPT', valid: '123456789', invalid: '123', overflow: '12345678901234567', label: 'Permiso por Protección', minHint: 'entre 9 y 15' },
      { type: 'DIE', valid: 'AB12345', invalid: 'AB', overflow: 'AB12345678901234567890', label: 'Documento de Identificación', minHint: 'entre 5 y 20' },
      { type: 'NUIP', valid: '12345678901', invalid: '123', overflow: '1234567890123', label: 'Número Único', minHint: 'entre 8 y 11' },
    ];

    for (const c of cases) {
      it(`handles ${c.type} (${c.label})`, () => {
        // In range
        const ok = computeDocumentFormatHint(c.type, c.valid);
        expect(ok?.tone).toBe('ok');
        expect(ok?.text).toContain(c.minHint!);

        // Below min — the text uses "caracteres" (or "carácter" for missing=1),
        // so the regex matches the first 7 chars of "caracter" or "caracté".
        const below = computeDocumentFormatHint(c.type, c.invalid);
        expect(below?.tone).toBe('info');
        expect(below?.text).toMatch(/Faltan \d+ caráct/);

        // Overflow — input must EXCEED the max (no match for exactly-at-max).
        const over = computeDocumentFormatHint(c.type, c.overflow);
        expect(over?.tone).toBe('warn');
        expect(over?.text).toContain('de más');
      });
    }
  });
});

describe('extractMinFromRegex', () => {
  it('parses digit quantifiers for every supported doc type', () => {
    expect(extractMinFromRegex(/^\d{6,10}$/)).toBe(6); // CC
    expect(extractMinFromRegex(/^\d{8,12}-?\d?$/)).toBe(8); // NIT
    expect(extractMinFromRegex(/^\d{8,11}$/)).toBe(8); // TI/RC/NUIP
    expect(extractMinFromRegex(/^[A-Z0-9]{5,16}$/)).toBe(5); // PA
    expect(extractMinFromRegex(/^\d{9,15}$/)).toBe(9); // PEP/PPT
    expect(extractMinFromRegex(/^[A-Z0-9]{5,20}$/)).toBe(5); // DIE
  });

  it('falls back to 1 when the regex has no quantifier', () => {
    expect(extractMinFromRegex(/^.*$/)).toBe(1);
  });
});
