import { create } from 'xmlbuilder2';
import { UblCommonBuilder, UblDocumentLine } from './ubl-common.builder';
import { DianTotalsValidator } from './dian-totals.validator';
import { UBL_NAMESPACES } from './xml-namespaces';
import { ProviderInvoiceTax } from '../../invoice-provider.interface';

/**
 * FAX07 — una línea que NO causa impuesto no hereda la tarifa de cabecera.
 *
 * ## El defecto
 *
 * Una línea sin filas de impuesto propias caía al camino histórico de
 * `buildLineTaxTotal`: heredaba `header_taxes[0]` (tarifa y código) y declaraba
 * `TaxableAmount = dianLineExtension(item)` con `TaxAmount = item.tax_amount`.
 * Para la línea sintética «Envio» (`product_id` null, cuota 0) de una factura
 * INC 8 % salía `INC 8 % base 15000 cuota 0` y la DIAN rechazaba por FAX07:
 * `round(TaxAmount) = round(TaxableAmount × Percent ÷ 100)`. Mismo caso para la
 * propina/envío de una cuenta dividida (`split-invoice-projection.util.ts`).
 *
 * Anexo 1.9 FAX01/FAX05: la línea que no causa el tributo NO informa
 * `cac:TaxTotal`. El exento (`Percent 0.00`) sí va, y no cambia.
 *
 * Cada caso arma el documento COMPLETO y lo pasa por `DianTotalsValidator`,
 * porque FAU04 (cabecera ↔ líneas) sólo se ve con los dos lados emitidos.
 */
describe('FAX07 — la línea sin impuesto no hereda la tarifa de cabecera', () => {
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

  const INC8: ProviderInvoiceTax = {
    tax_name: 'INC',
    tax_type: 'inc',
    tax_rate: '8.00',
    taxable_amount: '100000.00',
    tax_amount: '8000.00',
  } as ProviderInvoiceTax;

  function plato(overrides: Partial<UblDocumentLine> = {}): UblDocumentLine {
    return {
      description: 'Plato',
      quantity: '1',
      unit_price: '100000.00',
      discount_amount: '0.00',
      tax_amount: '8000.00',
      total_amount: '108000.00',
      ...overrides,
    };
  }

  function envio(overrides: Partial<UblDocumentLine> = {}): UblDocumentLine {
    return {
      description: 'Envio',
      quantity: '1',
      unit_price: '15000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '15000.00',
      ...overrides,
    };
  }

  function emit(data: {
    tax_amount: string;
    items: UblDocumentLine[];
    taxes: ProviderInvoiceTax[];
  }): { xml: string; totals: Record<string, string>; lines: string[] } {
    const doc = createInvoice();
    const payload = { ...data, discount_amount: '0.00' };
    UblCommonBuilder.buildTaxTotals(doc, data.taxes, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(doc, payload, 'COP');
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
    const lines = [
      ...xml.matchAll(/<cac:InvoiceLine>(.*?)<\/cac:InvoiceLine>/g),
    ].map((m) => m[1]);
    return { xml, totals, lines };
  }

  function expectClean(xml: string): void {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  }

  it('factura INC 8 % con impuestos por línea: el envío con cuota 0 calla su TaxTotal', () => {
    const { xml, totals, lines } = emit({
      tax_amount: '8000.00',
      items: [
        plato({
          taxes: [{ ...INC8 }],
        } as Partial<UblDocumentLine>),
        envio({ taxes: [] } as Partial<UblDocumentLine>),
      ],
      taxes: [INC8],
    });

    expect(lines).toHaveLength(2);
    // El plato declara su INC 8 %…
    expect(lines[0]).toContain('<cac:TaxTotal>');
    expect(lines[0]).toContain('<cbc:Percent>8.00</cbc:Percent>');
    // …el envío no declara ninguno.
    expect(lines[1]).not.toContain('<cac:TaxTotal>');
    expect(lines[1]).not.toContain('TaxSubtotal');

    // FAU04: la base de cabecera es sólo la gravada.
    expect(totals.LineExtensionAmount).toBe('115000.00');
    expect(totals.TaxExclusiveAmount).toBe('100000.00');
    expect(totals.TaxInclusiveAmount).toBe('123000.00');
    expect(totals.PayableAmount).toBe('123000.00');
    expectClean(xml);
  });

  it('documento histórico de un solo impuesto en cabecera (sin desglose): el plato hereda, el envío calla', () => {
    // Sin `invoice_item_id`: el INC vive sólo en cabecera y ninguna línea trae
    // filas propias. El plato causó el tributo y lo hereda; el envío no.
    const { xml, totals, lines } = emit({
      tax_amount: '8000.00',
      items: [plato(), envio()],
      taxes: [INC8],
    });

    expect(lines[0]).toContain('<cac:TaxTotal>');
    expect(lines[0]).toContain(
      '<cbc:TaxableAmount currencyID="COP">100000.00</cbc:TaxableAmount>',
    );
    expect(lines[0]).toContain('<cbc:ID>04</cbc:ID>');
    expect(lines[1]).not.toContain('<cac:TaxTotal>');

    expect(totals.TaxExclusiveAmount).toBe('100000.00');
    expect(totals.PayableAmount).toBe('123000.00');
    expectClean(xml);
  });

  it('cuenta dividida: la línea de propina sin impuestos no emite TaxTotal', () => {
    // Forma que produce `projectFinancialAccountInvoice`: cada línea trae sus
    // filas (`taxes`), y la de propina/envío llega con `taxes: []`.
    const IVA19: ProviderInvoiceTax = {
      tax_name: 'IVA',
      tax_type: 'iva',
      tax_rate: '19',
      taxable_amount: '1000.00',
      tax_amount: '190.00',
    } as ProviderInvoiceTax;
    const { xml, totals, lines } = emit({
      tax_amount: '190.00',
      items: [
        {
          description: 'Participación · item',
          quantity: '1',
          unit_price: '1000.00',
          discount_amount: '0.00',
          tax_amount: '190.00',
          total_amount: '1190.00',
          taxes: [{ ...IVA19 }],
        } as UblDocumentLine,
        {
          description: 'Participación · tip',
          quantity: '1',
          unit_price: '300.00',
          discount_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '300.00',
          taxes: [],
        } as UblDocumentLine,
      ],
      taxes: [IVA19],
    });

    expect(lines[1]).not.toContain('<cac:TaxTotal>');
    expect(totals.TaxExclusiveAmount).toBe('1000.00');
    expect(totals.PayableAmount).toBe('1490.00');
    expectClean(xml);
  });

  it('el exento IVA 0 % NO cambia: la línea con cuota 0 sigue heredando Percent 0.00', () => {
    const EXENTO: ProviderInvoiceTax = {
      tax_name: 'IVA',
      tax_type: 'iva',
      tax_rate: '0.00',
      taxable_amount: '50000.00',
      tax_amount: '0.00',
    } as ProviderInvoiceTax;
    const { xml, totals, lines } = emit({
      tax_amount: '0.00',
      items: [
        {
          description: 'Exento',
          quantity: '1',
          unit_price: '50000.00',
          discount_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '50000.00',
        },
      ],
      taxes: [EXENTO],
    });

    expect(lines[0]).toContain('<cac:TaxTotal>');
    expect(lines[0]).toContain('<cbc:Percent>0.00</cbc:Percent>');
    expect(totals.TaxExclusiveAmount).toBe('50000.00');
    expectClean(xml);
  });

  it('inheritsNothingFromHeader y lineTaxableContribution usan la MISMA condición', () => {
    const envio_line = envio();
    expect(UblCommonBuilder.inheritsNothingFromHeader(envio_line, [INC8])).toBe(
      true,
    );
    expect(UblCommonBuilder.lineTaxableContribution(envio_line, [INC8])).toBe(
      null,
    );
    expect(UblCommonBuilder.inheritsNothingFromHeader(plato(), [INC8])).toBe(
      false,
    );
    expect(UblCommonBuilder.lineTaxableContribution(plato(), [INC8])).toBe(
      '100000.00',
    );
    expect(UblCommonBuilder.inheritsNothingFromHeader(plato(), [])).toBe(true);
  });
});
