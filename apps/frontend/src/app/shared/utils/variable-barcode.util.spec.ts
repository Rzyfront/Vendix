import {
  analyzeVariableBarcodeOverlaps,
  buildExampleBarcode,
  createFormatFromPreset,
  describeVariableBarcode,
  parsePrefixList,
  positionsLabel,
  validateVariableBarcodeLayout,
  weightUnitToKg,
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

  it('describeVariableBarcode segmenta los 13 dígitos con posiciones en base 1', () => {
    const segs = describeVariableBarcode(fmt('rongta_07'), '2100003001801');
    expect(segs.map((x) => [x.kind, x.digits, x.positions])).toEqual([
      ['prefix', '21', '1–2'],
      ['product', '00003', '3–7'],
      ['weight', '00180', '8–12'],
      ['check', '1', '13'],
    ]);
  });

  it('describeVariableBarcode marca huecos sin uso y usa marcadores sin código', () => {
    const f = { ...fmt('rongta_07'), product_code_length: 4, value_start: 8, value_length: 4 };
    const segs = describeVariableBarcode(f);
    expect(segs.map((x) => [x.kind, x.digits, x.positions])).toEqual([
      ['prefix', 'PP', '1–2'],
      ['product', 'CCCC', '3–6'],
      ['unused', '00', '7–8'],
      ['weight', 'WWWW', '9–12'],
      ['check', 'K', '13'],
    ]);
    expect(describeVariableBarcode({ ...f, value_length: 6 })).toEqual([]);
  });

  it('positionsLabel convierte índices base 0 a posiciones base 1', () => {
    expect(positionsLabel(2, 5)).toBe('3–7');
    expect(positionsLabel(12, 1)).toBe('13');
  });

  it('validateVariableBarcodeLayout aplica la regla del backend', () => {
    expect(validateVariableBarcodeLayout(fmt('rongta_07'))).toBeNull();
    expect(validateVariableBarcodeLayout(fmt('rongta_27'))).toBeNull();
    expect(validateVariableBarcodeLayout({ ...fmt('rongta_07'), value_length: 6 })).toBe(
      'El peso llega a la posición 13 y solo hay 12 de datos (la 13 es el dígito de control)',
    );
    expect(validateVariableBarcodeLayout({ ...fmt('rongta_07'), product_code_start: 1 })).toBe(
      'El prefijo y el código de producto se pisan en la posición 2',
    );
    expect(validateVariableBarcodeLayout({ ...fmt('rongta_07'), value_start: 5 })).toBe(
      'El código de producto y el peso se pisan en las posiciones 6–7',
    );
    expect(validateVariableBarcodeLayout({ ...fmt('rongta_07'), product_code_length: 0 })).toBe(
      'El código de producto debe tener al menos 1 dígito',
    );
  });

  it('parsePrefixList informa los prefijos inválidos en vez de descartarlos', () => {
    expect(parsePrefixList('21, 22, 2a, 123, 21', 2)).toEqual({
      prefixes: ['21', '22'],
      invalid: ['2a', '123'],
      truncated: false,
    });
    const many = Array.from({ length: 21 }, (_, i) => String(10 + i)).join(',');
    expect(parsePrefixList(many, 2).truncated).toBe(true);
  });

  it('buildExampleBarcode arma un EAN-13 válido que el parser lee igual', () => {
    for (const p of VARIABLE_BARCODE_PRESETS) {
      const f = fmt(p.preset);
      const code = buildExampleBarcode(f, 1234, 1.25);
      expect(code).not.toBeNull();
      expect(isValidEan13(code!)).toBe(true);
      const r = parseVariableBarcode(code!, f);
      expect(r).toEqual({ ok: true, prefix: f.prefixes[0], productCode: 1234, weightKg: 1.25 });
    }
    expect(buildExampleBarcode(fmt('rongta_07'), 123456, 1)).toBeNull();
  });

  it('analyzeVariableBarcodeOverlaps distingue equivalentes de conflictos', () => {
    const a = fmt('rongta_07');
    const b = fmt('rongta_09');
    const c = { ...fmt('rongta_07'), value_decimals: 2 };
    const d = fmt('rongta_27');
    const e = fmt('rongta_17');
    expect(analyzeVariableBarcodeOverlaps([a, b])).toEqual({
      equivalent: [{ a: a.id, b: b.id, prefixes: ['21'] }],
      conflicts: [],
    });
    expect(analyzeVariableBarcodeOverlaps([a, c]).conflicts.length).toBe(1);
    // "2" (1 dígito) se pisa con "21" y "27".
    expect(analyzeVariableBarcodeOverlaps([a, d, e]).conflicts).toEqual([
      { a: a.id, b: d.id, prefixes: ['21'] },
      { a: d.id, b: e.id, prefixes: ['27'] },
    ]);
    expect(analyzeVariableBarcodeOverlaps([a, { ...b, enabled: false }])).toEqual({
      equivalent: [],
      conflicts: [],
    });
  });

  it('weightUnitToKg convierte unidades de peso y rechaza otras', () => {
    expect(weightUnitToKg('kg')).toBe(1);
    expect(weightUnitToKg('g')).toBe(0.001);
    expect(weightUnitToKg(null)).toBe(1);
    expect(weightUnitToKg('und')).toBeNull();
  });
});
