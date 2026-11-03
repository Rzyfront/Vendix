import {
  createFormatFromPreset,
  isValidEan13,
  parseVariableBarcode,
  resolveVariableBarcode,
  VARIABLE_BARCODE_PRESETS,
} from './variable-barcode.util';

function fmt(preset: 'rongta_07' | 'rongta_09' | 'rongta_17' | 'rongta_27') {
  return createFormatFromPreset(preset);
}

describe('variable-barcode.util', () => {
  it('isValidEan13 valida dígito de control', () => {
    expect(isValidEan13('2100003001801')).toBe(true);
    expect(isValidEan13('2100003001802')).toBe(false);
    expect(isValidEan13('123')).toBe(false);
    expect(isValidEan13('21000030018ab')).toBe(false);
  });

  it('tiene los 4 presets Rongta', () => {
    expect(VARIABLE_BARCODE_PRESETS.map((p) => p.preset)).toEqual([
      'rongta_07',
      'rongta_09',
      'rongta_17',
      'rongta_27',
    ]);
  });

  it('parsea 2100003001801 con rongta_07', () => {
    const r = parseVariableBarcode('2100003001801', fmt('rongta_07'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prefix).toBe('21');
      expect(r.productCode).toBe(3);
      expect(r.weightKg).toBeCloseTo(0.18, 6);
    }
  });

  it('rechaza dígito de control inválido', () => {
    expect(parseVariableBarcode('2100003001802', fmt('rongta_07'))).toEqual({
      ok: false,
      reason: 'check_digit',
    });
  });

  it('rechaza prefijo no configurado', () => {
    expect(parseVariableBarcode('2200003001808', fmt('rongta_07'))).toEqual({
      ok: false,
      reason: 'prefix',
    });
  });

  it('rechaza peso cero', () => {
    expect(parseVariableBarcode('2100003000002', fmt('rongta_07'))).toEqual({
      ok: false,
      reason: 'weight_range',
    });
  });

  it('rechaza peso sobre el máximo', () => {
    const f = { ...fmt('rongta_07'), max_weight_kg: 0.1 };
    expect(parseVariableBarcode('2100003001801', f)).toEqual({
      ok: false,
      reason: 'weight_range',
    });
  });

  it('rechaza largo y no numérico', () => {
    expect(parseVariableBarcode('210000300180', fmt('rongta_07'))).toEqual({
      ok: false,
      reason: 'length',
    });
    expect(parseVariableBarcode('21000030018ab', fmt('rongta_07'))).toEqual({
      ok: false,
      reason: 'non_numeric',
    });
  });

  it('formato desactivado se rechaza', () => {
    const f = { ...fmt('rongta_07'), enabled: false };
    expect(parseVariableBarcode('2100003001801', f)).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  it('rongta_09 interpreta gramos', () => {
    // 21 00003 00180 + control
    const body = '210000300180';
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
    const code = body + String((10 - (sum % 10)) % 10);
    const r = parseVariableBarcode(code, fmt('rongta_09'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.productCode).toBe(3);
      expect(r.weightKg).toBeCloseTo(0.18, 6);
    }
  });

  it('resolve ignora formatos desactivados', () => {
    const off = { ...fmt('rongta_07'), enabled: false };
    expect(resolveVariableBarcode('2100003001801', [off])).toEqual({
      ok: false,
      reason: 'no_formats',
    });
    const on = fmt('rongta_07');
    const r = resolveVariableBarcode('2100003001801', [off, on]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.format_id).toBe(on.id);
      expect(r.productCode).toBe(3);
    }
  });

  it('resolve rechaza ambiguo cuando dos formatos dan resultados distintos', () => {
    // Mismo prefijo 21, pero uno lee 3 decimales (0,180 kg) y otro 2 (1,80 kg).
    const r = resolveVariableBarcode('2100003001801', [
      fmt('rongta_07'),
      { ...fmt('rongta_07'), value_decimals: 2 },
    ]);
    expect(r).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('resolve acepta dos formatos con el mismo resultado', () => {
    const a = fmt('rongta_07');
    const b = fmt('rongta_07');
    const r = resolveVariableBarcode('2100003001801', [a, b]);
    expect(r.ok).toBe(true);
  });

  it('resolve informa el motivo cuando ningún formato lo acepta', () => {
    expect(resolveVariableBarcode('2200003001808', [fmt('rongta_07')])).toEqual({
      ok: false,
      reason: 'prefix',
    });
  });
});
