import { create } from 'xmlbuilder2';
import { UblCommonBuilder, UblDocumentLine } from './ubl-common.builder';
import { DianTotalsValidator } from './dian-totals.validator';
import { UBL_NAMESPACES } from './xml-namespaces';
import { ProviderInvoiceTax } from '../../invoice-provider.interface';

/**
 * FAU04 — la cabecera y las líneas tienen que declarar la MISMA base imponible.
 *
 * Este archivo no afirma sobre importes sueltos: construye el documento
 * COMPLETO —líneas y grupo de totales— y lo pasa por `DianTotalsValidator`, que
 * es la misma compuerta que corre antes de firmar. Es la única forma de probar
 * la regla: los dos lados de la comparación los producen funciones distintas, y
 * un spec que sólo llama al grupo de totales no puede ver el desacuerdo.
 *
 * ## El defecto que motiva el archivo (Gap 11 / D2-d)
 *
 * La cabecera admitía una línea en la base con UNA condición (`!omit_tax_total`);
 * la línea emitía su `cac:TaxTotal` con DOS (`!omit_tax_total` **y** tener
 * tributo propio o de cabecera del que heredar). El documento SIN NINGÚN tributo
 * caía en la grieta: cero subtotales en las líneas, el bruto entero en la
 * cabecera, y FAU04 rechazándolo antes de firmar.
 *
 * El caso no es exótico: es una tienda que sólo vende bienes excluidos (art. 476
 * ET) y por lo tanto no marca `omit_tax_total` —esa bandera la pone el riel AIU,
 * no el catálogo—, así que llega con `taxes: []` y sin banderas.
 */
describe('FAU04 — la base de la cabecera es la que declaran las líneas', () => {
  function createInvoice(): any {
    return create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
  }

  function line(overrides: Partial<UblDocumentLine>): UblDocumentLine {
    return {
      description: 'Ítem',
      quantity: '1',
      unit_price: '1000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '1000.00',
      ...overrides,
    };
  }

  function tax(overrides: Partial<ProviderInvoiceTax>): ProviderInvoiceTax {
    return {
      tax_name: 'IVA',
      tax_rate: '19.00',
      taxable_amount: '1000.00',
      tax_amount: '190.00',
      ...overrides,
    };
  }

  /**
   * Emite líneas + totales en el MISMO documento y devuelve el XML junto con los
   * importes del grupo de totales. El orden importa poco para estas dos reglas,
   * pero se emite como el emisor real: totales antes de líneas.
   */
  function emit(data: {
    discount_amount: string;
    tax_amount: string;
    items: UblDocumentLine[];
    taxes: ProviderInvoiceTax[];
  }): { xml: string; totals: Record<string, string> } {
    const doc = createInvoice();
    UblCommonBuilder.buildLegalMonetaryTotal(doc, data, 'COP');
    UblCommonBuilder.buildInvoiceLines(doc, data.items, data.taxes, 'COP');
    const xml = doc.end({ prettyPrint: false });

    const totals: Record<string, string> = {};
    for (const m of xml.matchAll(
      /<cac:LegalMonetaryTotal>(.*?)<\/cac:LegalMonetaryTotal>/g,
    )) {
      for (const n of m[1].matchAll(
        /<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g,
      )) {
        totals[n[1]] = n[2];
      }
    }
    return { xml, totals };
  }

  /** Suma los `cbc:TaxableAmount` de línea tal como los lee la DIAN. */
  function lineTaxableSum(xml: string): number {
    let total = 0;
    for (const l of xml.matchAll(/<cac:InvoiceLine>(.*?)<\/cac:InvoiceLine>/g)) {
      for (const t of l[1].matchAll(
        /<cbc:TaxableAmount currencyID="COP">([^<]*)<\/cbc:TaxableAmount>/g,
      )) {
        total += Number(t[1]);
      }
    }
    return total;
  }

  function expectClean(xml: string): void {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('EL DEFECTO: 100 % excluida SIN bandera y sin tributos de cabecera', () => {
    // Ni una línea marca `omit_tax_total` ni hay tributos de cabecera. Antes del
    // arreglo la cabecera declaraba 69900,00 y las líneas 0,00 → FAU04.
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '0.00',
      items: [
        line({ unit_price: '69900.00', total_amount: '69900.00' }),
      ],
      taxes: [],
    });

    expect(totals.LineExtensionAmount).toBe('69900.00');
    expect(totals.TaxExclusiveAmount).toBe('0.00');
    // FAU06 / FAU14 intactas: el cliente sigue debiendo lo mismo.
    expect(totals.TaxInclusiveAmount).toBe('69900.00');
    expect(totals.PayableAmount).toBe('69900.00');

    expect(lineTaxableSum(xml)).toBe(0);
    expect(xml).not.toContain('cac:TaxTotal');
    expectClean(xml);
  });

  it('100 % excluida CON bandera — el camino que ya funcionaba', () => {
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '0.00',
      items: [
        line({
          unit_price: '69900.00',
          total_amount: '69900.00',
          omit_tax_total: true,
        }),
      ],
      taxes: [],
    });

    expect(totals.TaxExclusiveAmount).toBe('0.00');
    expect(lineTaxableSum(xml)).toBe(0);
    expectClean(xml);
  });

  it('mixta: sólo la línea que declara tributo aporta base', () => {
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '190.00',
      items: [
        line({ unit_price: '1000.00', tax_amount: '190.00', total_amount: '1190.00' }),
        line({ unit_price: '500.00', total_amount: '500.00', omit_tax_total: true }),
      ],
      taxes: [tax({})],
    });

    expect(totals.LineExtensionAmount).toBe('1500.00');
    expect(totals.TaxExclusiveAmount).toBe('1000.00');
    expect(lineTaxableSum(xml)).toBe(1000);
    expectClean(xml);
  });

  it('AIU: el valor del contrato y la base gravable son cifras DISTINTAS', () => {
    // Contrato de 100 M con base gravable de 10 M (A+I+U del 10 %). La cabecera
    // NO puede declarar el contrato como base: la línea declara 10 M.
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '1900000.00',
      items: [
        line({
          description: 'Administración',
          unit_price: '100000000.00',
          total_amount: '100000000.00',
          tax_amount: '1900000.00',
          taxes: [
            tax({ taxable_amount: '10000000.00', tax_amount: '1900000.00' }),
          ],
        }),
      ],
      taxes: [tax({ taxable_amount: '10000000.00', tax_amount: '1900000.00' })],
    });

    expect(totals.LineExtensionAmount).toBe('100000000.00');
    expect(totals.TaxExclusiveAmount).toBe('10000000.00');
    // FAU06: `TaxInclusiveAmount` = valor del contrato + impuesto, NO base +
    // impuesto. Es la cifra que el cliente debe.
    expect(totals.TaxInclusiveAmount).toBe('101900000.00');
    expect(lineTaxableSum(xml)).toBe(10000000);
    expectClean(xml);
  });

  it('dos tributos en una línea: la cabecera replica la Σ de subtotales', () => {
    // IVA 19 % e INC 8 % sobre la MISMA base de 1000. FAU04 suma NODOS
    // `cbc:TaxableAmount`, así que la Σ de línea es 2000 y la cabecera tiene que
    // declarar 2000 para cuadrar. "Corregir" el doble conteo a 1000 produciría el
    // rechazo — la regla no admite la interpretación contable.
    const { xml, totals } = emit({
      discount_amount: '0.00',
      tax_amount: '270.00',
      items: [
        line({
          unit_price: '1000.00',
          total_amount: '1270.00',
          tax_amount: '270.00',
          taxes: [
            tax({ taxable_amount: '1000.00', tax_amount: '190.00' }),
            tax({
              tax_name: 'INC',
              tax_rate: '8.00',
              taxable_amount: '1000.00',
              tax_amount: '80.00',
              tax_type: 'inc',
            }),
          ],
        }),
      ],
      taxes: [tax({})],
    });

    expect(totals.TaxExclusiveAmount).toBe('2000.00');
    expect(lineTaxableSum(xml)).toBe(2000);
    expectClean(xml);
  });
});
