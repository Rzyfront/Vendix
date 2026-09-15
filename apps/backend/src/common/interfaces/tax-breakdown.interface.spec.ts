import {
  buildTaxBreakdown,
  scaleBreakdownToTotal,
} from './tax-breakdown.interface';

/**
 * F-111 (CP-pos-exclusive-tax-double-charge) — estos tests fallarían con el
 * `buildTaxBreakdown` de antes de F-111 (que sólo sabía `{tax_type,
 * tax_amount}` y agrupaba por tipo, punto). Cubren:
 *  - agrupación por (tipo, tarifa) sin colapsar 19 % con 5 %;
 *  - suma de `taxable_amount` por grupo;
 *  - un ítem sin tarifa sale sin `tax_rate`/`taxable_amount` (comportamiento
 *    histórico intacto);
 *  - la guarda de plausibilidad que evita que una fila de `invoice_taxes`
 *    (tarifa en PORCENTAJE, `Decimal(5,2)`) se cuele como si fuera fracción;
 *  - `scaleBreakdownToTotal` descarta `tax_rate`/`taxable_amount` a
 *    propósito, incluso si el insumo los trae.
 */
describe('tax-breakdown · buildTaxBreakdown (F-111)', () => {
  it('agrupa por (tipo, tarifa): IVA 19% y IVA 5% NO colapsan en un ítem', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 25, tax_rate: 0.05, taxable_amount: 500 },
    ]);

    expect(breakdown).toHaveLength(2);
    const at19 = breakdown.find((b) => b.tax_rate === 0.19);
    const at5 = breakdown.find((b) => b.tax_rate === 0.05);
    expect(at19).toEqual({
      tax_type: 'iva',
      tax_amount: 190,
      tax_rate: 0.19,
      taxable_amount: 1000,
    });
    expect(at5).toEqual({
      tax_type: 'iva',
      tax_amount: 25,
      tax_rate: 0.05,
      taxable_amount: 500,
    });
  });

  it('suma tax_amount Y taxable_amount al agrupar varias líneas con la misma (tipo, tarifa)', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 95, tax_rate: 0.19, taxable_amount: 500 },
    ]);

    expect(breakdown).toEqual([
      { tax_type: 'iva', tax_amount: 285, tax_rate: 0.19, taxable_amount: 1500 },
    ]);
  });

  it('una fila sin tax_rate sale SIN tax_rate ni taxable_amount (comportamiento histórico)', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'inc', tax_amount: 80 },
    ]);

    expect(breakdown).toEqual([{ tax_type: 'inc', tax_amount: 80 }]);
    expect(breakdown[0]).not.toHaveProperty('tax_rate');
    expect(breakdown[0]).not.toHaveProperty('taxable_amount');
  });

  it('dos filas sin tax_rate del mismo tipo SÍ colapsan (agrupación legacy por tipo)', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 100 },
      { tax_type: 'iva', tax_amount: 50 },
    ]);

    expect(breakdown).toEqual([{ tax_type: 'iva', tax_amount: 150 }]);
  });

  it('GUARDA DE PLAUSIBILIDAD: una tarifa en PORCENTAJE (invoice_taxes, ej. 19.00) se trata como ausente', () => {
    // Reproduce la fila COMPLETA que `invoice-flow.service.ts` pasa hoy
    // (`include: { invoice_taxes: true }`): tax_rate Decimal(5,2) SIEMPRE en
    // porcentaje, taxable_amount SIEMPRE presente. Sin la guarda, esto
    // adjuntaría tax_rate=19 al ítem y la compuerta de resolveTaxLines
    // dispararía un falso positivo en CADA factura.
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 19000, tax_rate: 19, taxable_amount: 100000 },
    ]);

    expect(breakdown).toEqual([{ tax_type: 'iva', tax_amount: 19000 }]);
    expect(breakdown[0]).not.toHaveProperty('tax_rate');
    expect(breakdown[0]).not.toHaveProperty('taxable_amount');
  });

  it('tax_rate exactamente 1 (100%) se acepta; tax_rate > 1 se rechaza', () => {
    const at100 = buildTaxBreakdown([
      { tax_type: 'ica', tax_amount: 1000, tax_rate: 1, taxable_amount: 1000 },
    ]);
    expect(at100[0]).toHaveProperty('tax_rate', 1);

    const above100 = buildTaxBreakdown([
      { tax_type: 'ica', tax_amount: 1000, tax_rate: 1.01, taxable_amount: 1000 },
    ]);
    expect(above100[0]).not.toHaveProperty('tax_rate');
  });

  it('filas sin tax_amount (0 o falsy) se ignoran, igual que antes de F-111', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 0, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
    ]);
    expect(breakdown).toEqual([
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
    ]);
  });
});

describe('tax-breakdown · scaleBreakdownToTotal descarta tarifa/base (F-111)', () => {
  it('descarta tax_rate y taxable_amount del resultado aunque el insumo los traiga', () => {
    const scaled = scaleBreakdownToTotal(
      [
        { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      ],
      95,
    );

    expect(scaled).toEqual([{ tax_type: 'iva', tax_amount: 95 }]);
    expect(scaled[0]).not.toHaveProperty('tax_rate');
    expect(scaled[0]).not.toHaveProperty('taxable_amount');
  });
});

describe('tax-breakdown · base todo-o-nada por grupo (F-111)', () => {
  // El defecto que cubren estas dos primeras pruebas era ASIMÉTRICO: con la
  // fila con base primero se publicaba una base parcial (falso positivo en la
  // compuerta); con la fila sin base primero se descartaba. El mismo dato daba
  // dos resultados según el orden de llegada.
  it('base presente en la primera fila y ausente en la segunda ⇒ el grupo NO publica base', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 380, tax_rate: 0.19 },
    ]);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].tax_amount).toBe(570);
    expect(breakdown[0].tax_rate).toBe(0.19);
    // 1000 × 0.19 = 190, pero el impuesto acumulado es 570: publicar esa base
    // haría que `resolveTaxLines` marcara como desviación un dato correcto.
    expect(breakdown[0]).not.toHaveProperty('taxable_amount');
  });

  it('base ausente en la primera fila y presente en la segunda ⇒ mismo resultado (sin base)', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 380, tax_rate: 0.19 },
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
    ]);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].tax_amount).toBe(570);
    expect(breakdown[0]).not.toHaveProperty('taxable_amount');
  });

  it('el orden de las filas no cambia el resultado — la propiedad que faltaba', () => {
    const rows = [
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 380, tax_rate: 0.19 },
    ];
    expect(buildTaxBreakdown([...rows].reverse())).toEqual(
      buildTaxBreakdown(rows),
    );
  });

  it('todas las filas del grupo con base ⇒ la base sí se publica, sumada', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 380, tax_rate: 0.19, taxable_amount: 2000 },
    ]);

    expect(breakdown).toEqual([
      { tax_type: 'iva', tax_amount: 570, tax_rate: 0.19, taxable_amount: 3000 },
    ]);
  });

  it('una base incompleta en IVA 19% no contamina al grupo IVA 5%, que sí la tiene completa', () => {
    const breakdown = buildTaxBreakdown([
      { tax_type: 'iva', tax_amount: 190, tax_rate: 0.19, taxable_amount: 1000 },
      { tax_type: 'iva', tax_amount: 380, tax_rate: 0.19 },
      { tax_type: 'iva', tax_amount: 50, tax_rate: 0.05, taxable_amount: 1000 },
    ]);

    const iva19 = breakdown.find((b) => b.tax_rate === 0.19);
    const iva5 = breakdown.find((b) => b.tax_rate === 0.05);
    expect(iva19).not.toHaveProperty('taxable_amount');
    expect(iva5?.taxable_amount).toBe(1000);
  });
});
