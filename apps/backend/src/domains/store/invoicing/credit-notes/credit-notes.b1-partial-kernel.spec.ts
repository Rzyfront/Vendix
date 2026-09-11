import { Prisma } from '@prisma/client';
import { derivePartialNoteLinesViaKernel } from './credit-notes.service';

/**
 * B.1 (F-020) — la nota PARCIAL deriva por el kernel único
 * (`absorbInclusiveLine`, el mismo loop del motor): la cuota persistida ES
 * `trunc(base_final × rate)` por construcción y la cabecera suma lo derivado,
 * nunca el reclamo del cliente. La nota TOTAL sigue copia exacta (no se
 * prueba acá: ese camino no se tocó).
 *
 * Archivo NUEVO: prueba el helper puro exportado, sin levantar el servicio.
 */
describe('credit-notes · parcial por kernel (B.1/F-020)', () => {
  const scheme = (
    overrides: Partial<{
      tax_rate_id: number | null;
      tax_name: string;
      tax_rate: number;
      tax_type: string | null;
    }> = {},
  ) => ({
    tax_rate_id: 7,
    tax_name: 'INC 8%',
    tax_rate: new Prisma.Decimal(8),
    tax_type: 'inc',
    ...overrides,
  });

  const relatedLine = (
    overrides: Partial<{
      product_id: number | null;
      product_variant_id: number | null;
      is_inclusive: boolean | null;
      tax_amount?: number | null;
      price_unit_quantity?: number | null;
    }> = {},
  ) => ({ product_id: 11, product_variant_id: null, is_inclusive: true as boolean | null, ...overrides });

  it('parcial inclusiva $3.000/INC 8% ⇒ base 2777.78 + cuota 222.22 = 3000.00', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 11,
          description: 'Devolución parcial',
          quantity: 1,
          unit_price: 3000,
          tax_amount: 0,
        },
      ],
      [relatedLine()],
      [scheme()],
      901,
      'credit_note',
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].base_amount.toString()).toBe('2777.78');
    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.lines[0].total_amount.toString()).toBe('3000');
    expect(result.totals.subtotal.toString()).toBe('2777.78');
    expect(result.totals.tax.toString()).toBe('222.22');
    expect(result.totals.total.toString()).toBe('3000');
    expect(result.taxes).toHaveLength(1);
    expect(result.taxes[0]).toMatchObject({
      tax_name: 'INC 8%',
      taxable_amount: 2777.78,
      tax_amount: 222.22,
    });
  });

  it('el reclamo del cliente NO manda: cuota 999 ⇒ persiste 222.22', () => {
    const warnings: string[] = [];
    const result = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 11,
          quantity: 1,
          unit_price: 3000,
          tax_amount: 999,
        },
      ],
      [relatedLine()],
      [scheme()],
      902,
      'credit_note',
      { warn: (message: string) => warnings.push(message) },
    );

    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.totals.total.toString()).toBe('3000');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('server wins');
  });

  it('línea adicional IVA 19% $100 ⇒ base 100 + 19 = 119', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 12,
          quantity: 1,
          unit_price: 100,
          is_inclusive: false,
          tax_amount: 0,
        },
      ],
      [relatedLine({ product_id: 12, is_inclusive: false })],
      [scheme({ tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva' })],
      903,
      'debit_note',
    );

    expect(result.lines[0].base_amount.toString()).toBe('100');
    expect(result.lines[0].tax_amount.toString()).toBe('19');
    expect(result.lines[0].total_amount.toString()).toBe('119');
  });

  it('factura multi-esquema sin desglose ⇒ CALC_001 (igual que antes)', () => {
    const thrown: any = (() => {
      try {
        derivePartialNoteLinesViaKernel(
          [{ quantity: 1, unit_price: 3000, tax_amount: 100 }],
          [relatedLine()],
          [
            scheme(),
            scheme({ tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva' }),
          ],
          904,
          'credit_note',
        );
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).not.toBeNull();
    expect(thrown).toMatchObject({ errorCode: 'INVOICING_CALC_001' });
  });

  it('bruto inalcanzable ($17/INC 8%) ⇒ CALC_005 antes de numerar', () => {
    // Mismo caso que el gate del motor (A.2): f(15.74) = 16.99 y f(15.75)
    // salta a 17.01 — el kernel persiste closest-below y la nota bloquea.
    const thrown: any = (() => {
      try {
        derivePartialNoteLinesViaKernel(
          [{ quantity: 1, unit_price: 17, tax_amount: 1.26 }],
          [relatedLine()],
          [scheme()],
          905,
          'credit_note',
        );
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).not.toBeNull();
    expect(thrown).toMatchObject({ errorCode: 'INVOICING_CALC_005' });
    expect(thrown.getResponse?.().details).toMatchObject({ line_index: 0 });
  });

  it('líneas exentas ⇒ sin filas de impuesto (Anexo 1.9)', () => {
    const result = derivePartialNoteLinesViaKernel(
      [{ quantity: 2, unit_price: 5000, is_inclusive: false, tax_amount: 0 }],
      [relatedLine({ is_inclusive: false })],
      [scheme({ tax_name: 'IVA 0%', tax_rate: 0, tax_type: 'iva' })],
      906,
      'credit_note',
    );

    expect(result.taxes).toEqual([]);
    expect(result.totals.total.toString()).toBe('10000');
  });

  it('gemela exenta bajo esquema único no-cero: el kernel NO inventa cuota (N1)', () => {
    // La factura tiene UNA fila INC 8% (de otra línea); esta línea es exenta
    // (su gemela trae tax 0) y la nota no reclama nada: cero preservado.
    const result = derivePartialNoteLinesViaKernel(
      [{ product_id: 12, quantity: 1, unit_price: 5000, tax_amount: 0 }],
      [relatedLine({ product_id: 12, is_inclusive: false, tax_amount: 0 })],
      [scheme()],
      907,
      'credit_note',
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].tax_amount.toString()).toBe('0');
    expect(result.lines[0].base_amount.toString()).toBe('5000');
    expect(result.lines[0].total_amount.toString()).toBe('5000');
  });

  it('factura sin impuestos + nota sin reclamo: camino cero, sin 422 (N2)', () => {
    const result = derivePartialNoteLinesViaKernel(
      [
        { product_id: 11, quantity: 2, unit_price: 5000, tax_amount: 0 },
        { product_id: 12, quantity: 1, unit_price: 3000, tax_amount: 0 },
      ],
      [relatedLine(), relatedLine({ product_id: 12 })],
      [],
      908,
      'credit_note',
    );

    expect(result.taxes).toEqual([]);
    expect(result.totals.tax.toString()).toBe('0');
    expect(result.totals.total.toString()).toBe('13000');
  });

  it('R3-01: N2 con pack ×12 divide por la gemela (no vale 12×)', () => {
    // Factura SIN impuestos + presentación de 12 a $36000 ($3000/unidad):
    // base = 36000/12 = 3000, no 36000.
    const result = derivePartialNoteLinesViaKernel(
      [{ product_id: 11, quantity: 1, unit_price: 36000, tax_amount: 0 }],
      [relatedLine({ price_unit_quantity: 12 })],
      [],
      910,
      'credit_note',
    );

    expect(result.taxes).toEqual([]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].base_amount.toString()).toBe('3000');
    expect(result.lines[0].tax_amount.toString()).toBe('0');
    expect(result.lines[0].total_amount.toString()).toBe('3000');
  });

  it('pack ×12: el divisor sale de la gemela, no del DTO (N3)', () => {
    // Presentación de 12 a $36000 ($3000/unidad) con INC 8% incluido:
    // bruto = 36000/12 = 3000 ⇒ base 2777.78 + 222.22 (no 33333.33/2666.66).
    const result = derivePartialNoteLinesViaKernel(
      [{ product_id: 11, quantity: 1, unit_price: 36000, tax_amount: 0 }],
      [relatedLine({ price_unit_quantity: 12 })],
      [scheme()],
      909,
      'credit_note',
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].base_amount.toString()).toBe('2777.78');
    expect(result.lines[0].tax_amount.toString()).toBe('222.22');
    expect(result.lines[0].total_amount.toString()).toBe('3000');
  });
});
