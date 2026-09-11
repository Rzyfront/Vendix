import {
  InvoiceCalculatorInput,
  InvoiceCalculatorService,
} from './invoice-calculator.service';

/**
 * A.2 — pinning de los carve-outs (CP-facturacion-impuesto-incluido-redondeo).
 *
 * Las líneas AIU-contrato, de base fija y `omit_tax_total` NO pasan por el
 * kernel (F-005/F-010/F-021): conservan la fórmula legacy byte-idéntica. Este
 * spec fija esa conducta con cifras calculadas A MANO para que cualquier
 * cambio futuro tenga que romperlo antes de mover un centavo esculpido.
 * Archivo NUEVO: no toca los specs de A.1.
 */
describe('InvoiceCalculatorService · pinning de carve-outs (A.2)', () => {
  let service: InvoiceCalculatorService;

  beforeEach(() => {
    service = new InvoiceCalculatorService();
  });

  const oneLine = (
    line: InvoiceCalculatorInput['items'][number],
    aiu?: InvoiceCalculatorInput['aiu'],
  ): InvoiceCalculatorInput => ({ ...(aiu ? { aiu } : {}), items: [line] });

  it('línea contrato inclusiva: despeje legacy sin climb + split sobre la base legacy', () => {
    // Neto 1000000.07 con IVA 19% dentro, componentes 17/29/54 (basis aiu).
    // Legacy: B0 = trunc(1000000.07/1.19) = trunc(840336.1932…) = 840336.19;
    // el kernel la llevaría a 840336.20+ (residuo 60.01), el carve-out no.
    // Split sobre 840336.19: A = trunc(142857.1523) = 142857.15;
    // I = trunc(243697.4951) = 243697.49; U = resto = 453781.55.
    // Cuota IVA sobre la fracción Utilidad: trunc(453781.55×0.19) =
    // trunc(86218.4945) = 86218.49. Total: 840336.19 + 86218.49 = 926554.68.
    const result = service.calculate(
      oneLine(
        {
          description: 'Contrato AIU inclusivo',
          quantity: 1,
          unit_price: 1000000.07,
          aiu_component: 'contrato',
          is_inclusive: true,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
        {
          taxable_basis: 'utilidad',
          components_basis: 'aiu',
          components: { administracion: '17', imprevistos: '29', utilidad: '54' },
        },
      ),
    );

    const [line] = result.lines;
    expect(line.line_extension_amount).toBe('840336.19');
    expect(line.taxable_amount).toBe('453781.55');
    expect(line.tax_amount).toBe('86218.49');
    expect(line.total_amount).toBe('926554.68');
    // Esculpida: sin evidencia del kernel.
    expect(line.absorb).toBeUndefined();
    // El resumen AIU deriva de la misma base legacy.
    expect(result.aiu?.taxable_base).toBe('453781.55');
    expect(result.aiu?.aiu_value).toBe('840336.19');
  });

  it('línea de base fija inclusiva: la base dada manda, sin despeje ni climb', () => {
    // Neto 119000 con IVA dentro pero base explícita 50000: la cuota es
    // trunc(50000×0.19) = 9500.00 y la base sale del numerador
    // (119000 − 9500)/1 = 109500.00. Total 119000.00.
    const result = service.calculate(
      oneLine({
        description: 'Base fija',
        quantity: 1,
        unit_price: 119000,
        is_inclusive: true,
        taxes: [
          { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva', taxable_amount: 50000 },
        ],
      }),
    );

    const [line] = result.lines;
    expect(line.line_extension_amount).toBe('109500.00');
    expect(line.taxes[0].taxable_amount).toBe('50000.00');
    expect(line.taxes[0].tax_amount).toBe('9500.00');
    expect(line.total_amount).toBe('119000.00');
    expect(line.absorb).toBeUndefined();
  });

  it('línea omit_tax_total inclusiva: base neta legacy, sin impuesto, sin kernel', () => {
    // Costo reembolsable (sin componente) bajo base 'utilidad': fuera de la
    // base gravable aunque declare IVA — se lo quita con divergencia
    // informativa (no bloqueante) y la base es el neto legacy.
    const result = service.calculate(
      oneLine(
        {
          description: 'Costo reembolsable',
          quantity: 1,
          unit_price: 100000,
          is_inclusive: true,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
        { taxable_basis: 'utilidad' },
      ),
    );

    const [line] = result.lines;
    expect(line.omit_tax_total).toBe(true);
    expect(line.line_extension_amount).toBe('100000.00');
    expect(line.taxes).toHaveLength(0);
    expect(line.tax_amount).toBe('0.00');
    expect(line.total_amount).toBe('100000.00');
    expect(line.absorb).toBeUndefined();
    expect(
      result.divergences.some((d) => d.scope === 'aiu_untaxable_line_declares_tax'),
    ).toBe(true);
  });

  it('línea estándar inclusiva: evidencia del kernel con versión y residuo', () => {
    // $3.000 INC 8%: B0 2777.77 +1¢ ⇒ 2777.78/222.22/3000.00.
    const result = service.calculate(
      oneLine({
        description: 'Inclusiva estándar',
        quantity: 1,
        unit_price: 3000,
        is_inclusive: true,
        taxes: [{ tax_name: 'INC', tax_rate: 8, tax_type: 'inc' }],
      }),
    );

    const [line] = result.lines;
    expect(line.line_extension_amount).toBe('2777.78');
    expect(line.tax_amount).toBe('222.22');
    expect(line.total_amount).toBe('3000.00');
    expect(line.absorb).toMatchObject({
      kernel: 'inclusive-absorb-v1',
      residual_absorbed_cents: 1,
      unclosed_residual_cents: 0,
      steps: 1,
    });
  });

  it('línea exclusiva: evidencia trivial del kernel, mismos importes legacy', () => {
    const result = service.calculate(
      oneLine({
        description: 'Exclusiva',
        quantity: 2,
        unit_price: 50000,
        taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
      }),
    );

    const [line] = result.lines;
    expect(line.line_extension_amount).toBe('100000.00');
    expect(line.tax_amount).toBe('19000.00');
    expect(line.total_amount).toBe('119000.00');
    expect(line.absorb).toMatchObject({
      kernel: 'inclusive-absorb-v1',
      residual_absorbed_cents: 0,
      unclosed_residual_cents: 0,
    });
  });
});
