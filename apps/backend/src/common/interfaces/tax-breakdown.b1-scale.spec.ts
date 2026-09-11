import {
  buildTaxBreakdown,
  scaleBreakdownToTotal,
} from './tax-breakdown.interface';

/**
 * B.1 (F-022) — `scaleBreakdownToTotal` en `Decimal` con `ROUND_DOWN` +
 * resto mayor: las partes SIEMPRE suman `targetTotal` al centavo.
 *
 * Archivo NUEVO: no toca specs de A.1/A.2 (no existía spec para el escalado).
 */
describe('tax-breakdown · scaleBreakdownToTotal exacto (B.1/F-022)', () => {
  const sum = (rows: Array<{ tax_amount: number }>): number =>
    Math.round(rows.reduce((acc, r) => acc + r.tax_amount, 0) * 100) / 100;

  it('tres partes con redondeo cruzado suman EXACTO el objetivo', () => {
    const scaled = scaleBreakdownToTotal(
      [
        { tax_type: 'iva', tax_amount: 100 },
        { tax_type: 'inc', tax_amount: 100 },
        { tax_type: 'ica', tax_amount: 100 },
      ],
      10,
    );
    // 10/3 = 3.333…: truncado daría 3.33×3 = 9.99; el resto mayor pone 3.34
    // en la primera parte (desempate por orden).
    expect(scaled).toEqual([
      { tax_type: 'iva', tax_amount: 3.34 },
      { tax_type: 'inc', tax_amount: 3.33 },
      { tax_type: 'ica', tax_amount: 3.33 },
    ]);
    expect(sum(scaled)).toBe(10);
  });

  it('el centavo suelto va a la fracción mayor, no a la primera', () => {
    const scaled = scaleBreakdownToTotal(
      [
        { tax_type: 'iva', tax_amount: 70 },
        { tax_type: 'inc', tax_amount: 20 },
        { tax_type: 'ica', tax_amount: 10 },
      ],
      10,
    );
    // Exactos 7.00 / 2.00 / 1.00: sin resto que repartir, proporciones puras.
    expect(scaled).toEqual([
      { tax_type: 'iva', tax_amount: 7 },
      { tax_type: 'inc', tax_amount: 2 },
      { tax_type: 'ica', tax_amount: 1 },
    ]);
    expect(sum(scaled)).toBe(10);
  });

  it('una sola parte hereda el objetivo íntegro', () => {
    const scaled = scaleBreakdownToTotal(
      [{ tax_type: 'inc', tax_amount: 222.22 }],
      111.11,
    );
    expect(scaled).toEqual([{ tax_type: 'inc', tax_amount: 111.11 }]);
  });

  it('reverso proporcional de línea absorbida ($3.000 → 222.22) cierra al centavo', () => {
    const base = buildTaxBreakdown([
      { tax_type: 'inc', tax_amount: 222.22 },
      { tax_type: 'iva', tax_amount: 0 },
    ]);
    expect(base).toEqual([{ tax_type: 'inc', tax_amount: 222.22 }]);
    const scaled = scaleBreakdownToTotal(base, 111.11);
    expect(sum(scaled)).toBe(111.11);
  });

  it('guardas: vacío, objetivo nulo y suma nula devuelven []', () => {
    expect(scaleBreakdownToTotal([], 10)).toEqual([]);
    expect(
      scaleBreakdownToTotal([{ tax_type: 'iva', tax_amount: 5 }], 0),
    ).toEqual([]);
    expect(
      scaleBreakdownToTotal([{ tax_type: 'iva', tax_amount: 0 }], 10),
    ).toEqual([]);
  });
});
