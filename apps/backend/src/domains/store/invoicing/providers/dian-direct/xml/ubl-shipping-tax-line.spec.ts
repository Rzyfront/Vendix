import { create } from 'xmlbuilder2';
import { UblCommonBuilder, UblDocumentLine } from './ubl-common.builder';
import { UblEquivalentDocumentBuilder } from './ubl-equivalent-document.builder';
import { DianTotalsValidator } from './dian-totals.validator';
import { UBL_NAMESPACES } from './xml-namespaces';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
} from '../../invoice-provider.interface';
import {
  DianCustomerData,
  DianIssuerData,
  DianSoftwareSecurity,
} from '../interfaces/dian-config.interface';
import { DianDirectProvider } from '../dian-direct.provider';
import { FiscalDocumentValidator } from '../../../validators/fiscal-document.validator';

/**
 * Impuesto opcional del envío (copia de la orden): la línea Envío declara su
 * propio `cac:TaxTotal` —01 para IVA, 04 para INC— sobre la base
 * `shipping_cost − shipping_tax_amount`, sin tocar el builder:
 * `buildLineTaxTotal` ya usa los impuestos propios de la línea.
 *
 * Documentos (importes a mano):
 * · Plato 50.000 + INC 4.000; Envío 15.000 = 12.605,04 + IVA 2.394,96.
 *   12.605,04 × 19 % = 2.394,9576 ⇒ 1 ¢ de diferencia con la cuota declarada,
 *   dentro de FAX07 (±2,00). Total 69.000.
 * · Plato 50.000 + INC 4.000; Envío 15.000 = 13.888,89 + INC 1.111,11.
 *   Total 69.000.
 *
 * Todo pasa por `DianTotalsValidator` (FAU04 / FAU06 / FAX07).
 */
describe('UBL — la línea Envío con impuesto de la copia', () => {
  const tax = (
    t: Partial<ProviderInvoiceTax> & {
      tax_type: string;
      tax_rate: string;
      taxable_amount: string;
      tax_amount: string;
    },
  ): ProviderInvoiceTax =>
    ({ tax_name: t.tax_type.toUpperCase(), ...t }) as ProviderInvoiceTax;

  const platoInc = tax({
    tax_name: 'INC',
    tax_type: 'inc',
    tax_rate: '8.00',
    taxable_amount: '50000.00',
    tax_amount: '4000.00',
  });

  interface Scenario {
    label: string;
    scheme_id: string;
    percent: string;
    envio_tax: ProviderInvoiceTax;
    header: ProviderInvoiceTax[];
    tax_total: string;
    base_total: string;
    cufe: { iva: string; inc: string };
  }

  const scenarios: Scenario[] = [
    {
      label: 'IVA 19 % en el envío + plato INC 8 %',
      scheme_id: '01',
      percent: '19.00',
      envio_tax: tax({
        tax_name: 'IVA 19%',
        tax_type: 'iva',
        tax_rate: '19.00',
        taxable_amount: '12605.04',
        tax_amount: '2394.96',
      }),
      header: [
        platoInc,
        tax({
          tax_name: 'IVA 19%',
          tax_type: 'iva',
          tax_rate: '19.00',
          taxable_amount: '12605.04',
          tax_amount: '2394.96',
        }),
      ],
      tax_total: '6394.96',
      base_total: '62605.04',
      cufe: { iva: '2394.96', inc: '4000.00' },
    },
    {
      label: 'INC 8 % en el envío + plato INC 8 %',
      scheme_id: '04',
      percent: '8.00',
      envio_tax: tax({
        tax_name: 'INC',
        tax_type: 'inc',
        tax_rate: '8.00',
        taxable_amount: '13888.89',
        tax_amount: '1111.11',
      }),
      header: [
        tax({
          tax_name: 'INC',
          tax_type: 'inc',
          tax_rate: '8.00',
          taxable_amount: '63888.89',
          tax_amount: '5111.11',
        }),
      ],
      tax_total: '5111.11',
      base_total: '63888.89',
      cufe: { iva: '0.00', inc: '5111.11' },
    },
  ];

  const linesFor = (s: Scenario): UblDocumentLine[] => [
    {
      description: 'Plato',
      quantity: '1',
      unit_price: '50000.00',
      discount_amount: '0.00',
      tax_amount: '4000.00',
      total_amount: '54000.00',
      taxes: [{ ...platoInc }],
    } as UblDocumentLine,
    {
      description: 'Envio',
      quantity: '1',
      unit_price: s.envio_tax.taxable_amount,
      discount_amount: '0.00',
      tax_amount: s.envio_tax.tax_amount,
      total_amount: '15000.00',
      taxes: [{ ...s.envio_tax }],
    } as UblDocumentLine,
  ];

  const expectClean = (xml: string) => {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  };

  const invoiceLines = (xml: string) =>
    [...xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/g)].map(
      (m) => m[1],
    );

  const monetaryTotals = (xml: string) => {
    const totals: Record<string, string> = {};
    for (const m of xml.matchAll(
      /<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/g,
    )) {
      for (const n of m[1].matchAll(
        /<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g,
      )) {
        totals[n[1]] = n[2];
      }
    }
    return totals;
  };

  const buildInvoiceXml = (
    items: UblDocumentLine[],
    header: ProviderInvoiceTax[],
    tax_amount: string,
  ) => {
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
    UblCommonBuilder.buildTaxTotals(doc, header, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(
      doc,
      { tax_amount, items, taxes: header, discount_amount: '0.00' },
      'COP',
    );
    UblCommonBuilder.buildInvoiceLines(doc, items, header, 'COP');
    return doc.end({ prettyPrint: false });
  };

  describe.each(scenarios)('$label', (s) => {
    it(`factura: el Envío emite TaxTotal ${s.scheme_id} y el documento cuadra (FAU04/FAU06/FAX07)`, () => {
      const items = linesFor(s);
      const xml = buildInvoiceXml(items, s.header, s.tax_total);

      const [plato, envio] = invoiceLines(xml);
      expect(plato).toContain('<cbc:ID>04</cbc:ID>');
      expect(envio).toContain('<cac:TaxTotal>');
      expect(envio).toContain(`<cbc:ID>${s.scheme_id}</cbc:ID>`);
      expect(envio).toContain(`<cbc:Percent>${s.percent}</cbc:Percent>`);
      expect(envio).toContain(
        `<cbc:TaxableAmount currencyID="COP">${s.envio_tax.taxable_amount}</cbc:TaxableAmount>`,
      );
      expect(envio).toContain(
        `<cbc:TaxAmount currencyID="COP">${s.envio_tax.tax_amount}</cbc:TaxAmount>`,
      );
      expect(
        UblCommonBuilder.inheritsNothingFromHeader(items[1], s.header),
      ).toBe(false);

      const totals = monetaryTotals(xml);
      expect(totals.LineExtensionAmount).toBe(s.base_total);
      expect(totals.TaxExclusiveAmount).toBe(s.base_total);
      expect(totals.TaxInclusiveAmount).toBe('69000.00');
      expect(totals.PayableAmount).toBe('69000.00');
      expectClean(xml);
    });

    it('CUFE: ValImp reparte el impuesto del envío por tipo; ValTot no cambia', () => {
      const calculateTaxAmounts = (DianDirectProvider.prototype as any)
        .calculateTaxAmounts as (data: Partial<ProviderInvoiceData>) => {
        iva: string;
        inc: string;
        ica: string;
      };
      const amounts = calculateTaxAmounts.call(
        {},
        { taxes: [platoInc, s.envio_tax] },
      );
      expect(amounts).toEqual({ ...s.cufe, ica: '0.00' });
    });

    it('documento equivalente POS: el Envío declara su impuesto y el documento cuadra', () => {
      const issuer: DianIssuerData = {
        document_type: '31',
        nit: '900123456',
        nit_dv: '1',
        legal_name: 'Restaurante Demo SAS',
        address_line: 'Calle 1',
        city_code: '11001',
        city_name: 'Bogotá',
        department_code: '11',
        department_name: 'Bogotá D.C.',
        country_code: 'CO',
        postal_code: '111711',
        email: 'facturacion@restaurante.co',
        tax_regime: '48',
        tax_scheme: 'O-48',
      };
      const customer: DianCustomerData = {
        document_type: 'CC',
        document_number: '222222222222',
        verification_digit: null,
        legal_name: 'Consumidor final',
        tax_responsibilities: ['R-99-PN'],
        person_type: 'NATURAL',
        ciiu_code: null,
      };
      const software_security: DianSoftwareSecurity = {
        software_id: 'guid-software',
        software_pin: '11111',
        software_security_code: 'c'.repeat(96),
        provider_nit: '900123456',
        provider_nit_dv: '1',
      };
      const invoice_data: ProviderInvoiceData = {
        invoice_number: 'POS1',
        invoice_type: 'pos_equivalent',
        issue_date: '2026-09-22',
        issue_time: '12:00:00-05:00',
        currency: 'COP',
        subtotal_amount: s.base_total,
        discount_amount: '0.00',
        tax_amount: s.tax_total,
        withholding_amount: '0.00',
        total_amount: '69000.00',
        payment_form: '1',
        payment_means: '10',
        items: linesFor(s) as any,
        taxes: s.header,
      };
      const xml = UblEquivalentDocumentBuilder.build({
        invoice_data,
        issuer,
        customer,
        software_security,
        cude: 'd'.repeat(96),
        environment: 'test',
      });
      const [, envio] = invoiceLines(xml);
      expect(envio).toContain(`<cbc:ID>${s.scheme_id}</cbc:ID>`);
      expect(envio).toContain(
        `<cbc:TaxAmount currencyID="COP">${s.envio_tax.tax_amount}</cbc:TaxAmount>`,
      );
      const totals = monetaryTotals(xml);
      expect(totals.TaxExclusiveAmount).toBe(s.base_total);
      expect(totals.PayableAmount).toBe('69000.00');
      expectClean(xml);
    });
  });

  describe('IVA 19 % en el envío + productos IVA 5 % (mismo esquema, dos tarifas)', () => {
    const iva5 = tax({
      tax_name: 'IVA 5%',
      tax_type: 'iva',
      tax_rate: '5.00',
      taxable_amount: '50000.00',
      tax_amount: '2500.00',
    });
    const iva19Envio = tax({
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      tax_rate: '19.00',
      taxable_amount: '12605.04',
      tax_amount: '2394.96',
    });
    const header = [iva5, iva19Envio];
    const items: UblDocumentLine[] = [
      {
        description: 'Producto',
        quantity: '1',
        unit_price: '50000.00',
        discount_amount: '0.00',
        tax_amount: '2500.00',
        total_amount: '52500.00',
        taxes: [{ ...iva5 }],
      } as UblDocumentLine,
      {
        description: 'Envio',
        quantity: '1',
        unit_price: '12605.04',
        discount_amount: '0.00',
        tax_amount: '2394.96',
        total_amount: '15000.00',
        taxes: [{ ...iva19Envio }],
      } as UblDocumentLine,
    ];

    const headerTaxTotal = (xml: string) => {
      const body = xml.replace(
        /<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g,
        '',
      );
      const blocks = [
        ...body.matchAll(/<cac:TaxTotal>([\s\S]*?)<\/cac:TaxTotal>/g),
      ].map((m) => m[1]);
      expect(blocks).toHaveLength(1);
      return blocks[0];
    };

    it('cabecera: UN TaxTotal 01 con un TaxSubtotal por tarifa y TaxAmount = Σ (FAS01a/FAS02/FAS04)', () => {
      const xml = buildInvoiceXml(items, header, '4894.96');
      const block = headerTaxTotal(xml);
      expect(block).toMatch(
        /^<cbc:TaxAmount currencyID="COP">4894.96<\/cbc:TaxAmount>/,
      );
      const subtotals = [
        ...block.matchAll(/<cac:TaxSubtotal>([\s\S]*?)<\/cac:TaxSubtotal>/g),
      ].map((m) => m[1]);
      expect(subtotals).toHaveLength(2);
      expect(subtotals[0]).toContain('<cbc:Percent>5.00</cbc:Percent>');
      expect(subtotals[0]).toContain(
        '<cbc:TaxableAmount currencyID="COP">50000.00</cbc:TaxableAmount>',
      );
      expect(subtotals[0]).toContain(
        '<cbc:TaxAmount currencyID="COP">2500.00</cbc:TaxAmount>',
      );
      expect(subtotals[1]).toContain('<cbc:Percent>19.00</cbc:Percent>');
      expect(subtotals[1]).toContain(
        '<cbc:TaxAmount currencyID="COP">2394.96</cbc:TaxAmount>',
      );
      for (const sub of subtotals) expect(sub).toContain('<cbc:ID>01</cbc:ID>');

      const [producto, envio] = invoiceLines(xml);
      expect(producto).toContain('<cbc:Percent>5.00</cbc:Percent>');
      expect(envio).toContain('<cbc:Percent>19.00</cbc:Percent>');

      const totals = monetaryTotals(xml);
      expect(totals.TaxExclusiveAmount).toBe('62605.04');
      expect(totals.PayableAmount).toBe('67500.00');
      expectClean(xml);
    });

    it('CUFE: ValImp1 = Σ de los dos subtotales IVA', () => {
      const calculateTaxAmounts = (DianDirectProvider.prototype as any)
        .calculateTaxAmounts as (data: Partial<ProviderInvoiceData>) => {
        iva: string;
        inc: string;
        ica: string;
      };
      expect(calculateTaxAmounts.call({}, { taxes: header })).toEqual({
        iva: '4894.96',
        inc: '0.00',
        ica: '0.00',
      });
    });

    it('prevalidador: cada tarifa cuadra su subtotal y ya no hay colisión de esquema', () => {
      const findings = (new FiscalDocumentValidator() as any).checkTaxSubtotals(
        header,
      ) as Array<{ code: string }>;
      expect(findings).toEqual([]);
    });

    it('productos IVA 19 % + IVA 5 % sin envío: mismo tratamiento', () => {
      const iva19 = tax({
        tax_name: 'IVA 19%',
        tax_type: 'iva',
        tax_rate: '19.00',
        taxable_amount: '1000.00',
        tax_amount: '190.00',
      });
      const iva5b = tax({
        tax_name: 'IVA 5%',
        tax_type: 'iva',
        tax_rate: '5.00',
        taxable_amount: '1000.00',
        tax_amount: '50.00',
      });
      const lines = [iva19, iva5b].map(
        (t, i) =>
          ({
            description: `P${i}`,
            quantity: '1',
            unit_price: '1000.00',
            discount_amount: '0.00',
            tax_amount: t.tax_amount,
            total_amount: String(1000 + Number(t.tax_amount)),
            taxes: [{ ...t }],
          }) as UblDocumentLine,
      );
      const xml = buildInvoiceXml(lines, [iva19, iva5b], '240.00');
      const block = headerTaxTotal(xml);
      expect(block.match(/<cac:TaxSubtotal>/g)).toHaveLength(2);
      expect(block).toMatch(
        /^<cbc:TaxAmount currencyID="COP">240.00<\/cbc:TaxAmount>/,
      );
      expect(monetaryTotals(xml).PayableAmount).toBe('2240.00');
      expectClean(xml);
    });
  });

  it('sin copia: el Envío no declara TaxTotal y la base no lo cuenta (como hoy)', () => {
    const header = [platoInc];
    const items: UblDocumentLine[] = [
      linesFor(scenarios[1])[0],
      {
        description: 'Envio',
        quantity: '1',
        unit_price: '15000.00',
        discount_amount: '0.00',
        tax_amount: '0.00',
        total_amount: '15000.00',
      } as UblDocumentLine,
    ];
    const xml = buildInvoiceXml(items, header, '4000.00');
    const [, envio] = invoiceLines(xml);
    expect(envio).not.toContain('<cac:TaxTotal>');
    const totals = monetaryTotals(xml);
    expect(totals.LineExtensionAmount).toBe('65000.00');
    expect(totals.TaxExclusiveAmount).toBe('50000.00');
    expect(totals.PayableAmount).toBe('69000.00');
    expectClean(xml);
  });
});
