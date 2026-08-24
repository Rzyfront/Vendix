import { create } from 'xmlbuilder2';
import { UblCommonBuilder } from './ubl-common.builder';
import { UBL_NAMESPACES } from './xml-namespaces';
import {
  ProviderInvoiceItem,
  ProviderInvoiceTax,
} from '../../invoice-provider.interface';
import { toDecimal } from '../../../utils/dian-money.util';

/**
 * Regression suite for the FAU14 defect.
 *
 * `LegalMonetaryTotal/LineExtensionAmount` used to publish the GROSS subtotal
 * while every `InvoiceLine/LineExtensionAmount` published its NET amount
 * (`qty × price − discount`). Any invoice carrying a discount therefore declared
 * a header that did not equal the sum of its lines, which the DIAN rejects
 * (`FAU14`). `TaxExclusiveAmount` repeated the gross value even though the
 * taxable base is net, and `AllowanceTotalAmount` restated a discount the lines
 * had already applied — with no document-level `AllowanceCharge` backing it.
 */
/**
 * Tributo de CABECERA por defecto de estos casos.
 *
 * Está acá porque la base imponible de la cabecera se DERIVA de lo que emiten las
 * líneas, y una línea sin desglose propio sólo emite su `cac:TaxTotal` si hay un
 * tributo de cabecera del que heredar. Un fixture con `tax_amount` pero sin
 * `taxes` describe un documento que el emisor NO puede producir: era ese fixture
 * imposible el que ocultaba el desacuerdo de FAU04.
 *
 * Los casos de este archivo afirman sobre descuentos y FAU14. Lo único que
 * necesitan del tributo es que EXISTA; ninguna aserción lee su tarifa.
 */
const HEADER_IVA: ProviderInvoiceTax = {
  tax_name: 'IVA',
  tax_rate: '19.00',
  taxable_amount: '0.00',
  tax_amount: '0.00',
};

describe('UblCommonBuilder monetary totals', () => {
  function createRoot(): any {
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

  function item(overrides: Partial<ProviderInvoiceItem>): ProviderInvoiceItem {
    return {
      description: 'Producto',
      quantity: '1',
      unit_price: '1000.00',
      discount_amount: '0.00',
      tax_amount: '190.00',
      total_amount: '1190.00',
      ...overrides,
    };
  }

  /** Reads the text of every `cbc:<name>` under the given `cac:<parent>`. */
  function readValues(xml: string, name: string): string[] {
    const matches = xml.matchAll(
      new RegExp(`<cbc:${name}[^>]*>([^<]*)</cbc:${name}>`, 'g'),
    );
    return [...matches].map((m) => m[1]);
  }

  function buildTotals(data: {
    discount_amount: string;
    tax_amount: string;
    items: ProviderInvoiceItem[];
    /** Ausente ⇒ `HEADER_IVA`. Ver el comentario de la constante. */
    taxes?: ProviderInvoiceTax[];
  }): string {
    const doc = createRoot();
    const full = { ...data, taxes: data.taxes ?? [HEADER_IVA] };
    UblCommonBuilder.buildDocumentAllowanceCharge(doc, full, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(doc, full, 'COP');
    return doc.end({ prettyPrint: false });
  }

  function buildLines(items: ProviderInvoiceItem[]): string {
    const doc = createRoot();
    UblCommonBuilder.buildInvoiceLines(
      doc,
      items,
      [{ tax_name: 'IVA', tax_rate: '19.00', taxable_amount: '0', tax_amount: '0' }],
      'COP',
    );
    return doc.end({ prettyPrint: false });
  }

  describe('rule FAZ09 — StandardItemIdentification informado en toda línea', () => {
    it('emite el código del ítem con schemeID 999 cuando el llamador lo aporta', () => {
      const xml = buildLines([
        item({ item_code: 'SKU-001' }),
        item({ item_code: 'SKU-002' }),
      ]);

      const ids = [
        ...xml.matchAll(
          /<cac:StandardItemIdentification><cbc:ID schemeID="999">([^<]*)<\/cbc:ID><\/cac:StandardItemIdentification>/g,
        ),
      ].map((m) => m[1]);

      expect(ids).toEqual(['SKU-001', 'SKU-002']);
    });

    it('cae al número de línea cuando no hay código, porque el elemento es obligatorio', () => {
      // La DIAN rechaza la línea sin `StandardItemIdentification` (FAZ09), así que
      // la ausencia de catálogo no puede traducirse en omitir el elemento.
      const xml = buildLines([item({}), item({}), item({})]);

      const ids = [
        ...xml.matchAll(
          /<cac:StandardItemIdentification><cbc:ID schemeID="999">([^<]*)<\/cbc:ID><\/cac:StandardItemIdentification>/g,
        ),
      ].map((m) => m[1]);

      expect(ids).toEqual(['1', '2', '3']);
    });

    it('nunca emite el elemento vacío: un código en blanco cae al número de línea', () => {
      const xml = buildLines([item({ item_code: '   ' })]);

      expect(xml).toContain(
        '<cac:StandardItemIdentification><cbc:ID schemeID="999">1</cbc:ID></cac:StandardItemIdentification>',
      );
    });
  });

  describe('rule FAU14 — header equals the sum of the lines', () => {
    it('holds when lines carry discounts', () => {
      const items = [
        item({ quantity: '2', unit_price: '1000.00', discount_amount: '150.00' }),
        item({ quantity: '1', unit_price: '500.00', discount_amount: '50.00' }),
      ];
      // Gross would be 2500.00; net is 2500 - 200 = 2300.00.
      const totals = buildTotals({
        discount_amount: '200.00',
        tax_amount: '437.00',
        items,
      });
      const lines = buildLines(items);

      const header = readValues(totals, 'LineExtensionAmount')[0];
      const line_amounts = readValues(lines, 'LineExtensionAmount');
      const line_sum = line_amounts.reduce(
        (acc, v) => acc.plus(toDecimal(v)),
        toDecimal(0),
      );

      expect(header).toBe('2300.00');
      expect(line_sum.toFixed(2)).toBe(header);
    });

    it('holds on a clean invoice with no discount', () => {
      const items = [item({ quantity: '3', unit_price: '1000.00' })];
      const totals = buildTotals({
        discount_amount: '0.00',
        tax_amount: '570.00',
        items,
      });
      const lines = buildLines(items);

      const header = readValues(totals, 'LineExtensionAmount')[0];
      expect(header).toBe('3000.00');
      expect(readValues(lines, 'LineExtensionAmount')[0]).toBe('3000.00');
    });
  });

  describe('TaxExclusiveAmount is the NET taxable base', () => {
    it('subtracts the line discounts instead of publishing the gross subtotal', () => {
      const totals = buildTotals({
        discount_amount: '150.00',
        tax_amount: '161.50',
        items: [
          item({
            quantity: '1',
            unit_price: '1000.00',
            discount_amount: '150.00',
          }),
        ],
      });
      expect(readValues(totals, 'TaxExclusiveAmount')[0]).toBe('850.00');
    });
  });

  describe('PayableAmount identity', () => {
    it('equals TaxInclusiveAmount minus AllowanceTotalAmount', () => {
      const totals = buildTotals({
        discount_amount: '200.00',
        tax_amount: '437.00',
        items: [
          item({
            quantity: '2',
            unit_price: '1000.00',
            discount_amount: '150.00',
          }),
          item({ quantity: '1', unit_price: '500.00', discount_amount: '50.00' }),
        ],
      });

      const inclusive = toDecimal(readValues(totals, 'TaxInclusiveAmount')[0]);
      const allowance = toDecimal(readValues(totals, 'AllowanceTotalAmount')[0]);
      const payable = readValues(totals, 'PayableAmount')[0];

      expect(inclusive.minus(allowance).toFixed(2)).toBe(payable);
      // 2300 net + 437 tax = 2737; no document-level discount remains.
      expect(payable).toBe('2737.00');
    });
  });

  describe('document-level allowance', () => {
    it('is not emitted when the lines already carry the whole discount', () => {
      const totals = buildTotals({
        discount_amount: '150.00',
        tax_amount: '161.50',
        items: [
          item({
            quantity: '1',
            unit_price: '1000.00',
            discount_amount: '150.00',
          }),
        ],
      });
      expect(totals).not.toContain('AllowanceChargeReason');
      expect(readValues(totals, 'AllowanceTotalAmount')[0]).toBe('0.00');
    });

    it('is emitted with a backing AllowanceCharge for a footer-only discount', () => {
      // 100.00 of the document discount is not attributable to any line.
      const totals = buildTotals({
        discount_amount: '100.00',
        tax_amount: '190.00',
        items: [item({ quantity: '1', unit_price: '1000.00' })],
      });

      expect(totals).toContain('AllowanceChargeReason');
      expect(totals).toContain('<cbc:ChargeIndicator>false</cbc:ChargeIndicator>');
      expect(readValues(totals, 'AllowanceTotalAmount')[0]).toBe('100.00');
      // 1000 net + 190 tax - 100 footer discount.
      expect(readValues(totals, 'PayableAmount')[0]).toBe('1090.00');
      // BaseAmount is the net line extension the allowance applies to.
      expect(readValues(totals, 'BaseAmount')[0]).toBe('1000.00');
    });

    it('never emits a negative allowance when lines over-discount', () => {
      const totals = buildTotals({
        discount_amount: '50.00',
        tax_amount: '161.50',
        items: [
          item({
            quantity: '1',
            unit_price: '1000.00',
            discount_amount: '150.00',
          }),
        ],
      });
      expect(readValues(totals, 'AllowanceTotalAmount')[0]).toBe('0.00');
      expect(totals).not.toContain('AllowanceChargeReason');
    });
  });

  describe('scale of every emitted amount', () => {
    it('pads unscaled inputs to two decimals', () => {
      const totals = buildTotals({
        discount_amount: '0',
        tax_amount: '190',
        items: [item({ quantity: '1', unit_price: '1000', tax_amount: '190' })],
      });
      for (const name of [
        'LineExtensionAmount',
        'TaxExclusiveAmount',
        'TaxInclusiveAmount',
        'AllowanceTotalAmount',
        'PayableAmount',
      ]) {
        expect(readValues(totals, name)[0]).toMatch(/^-?\d+\.\d{2}$/);
      }
    });

    it('pads the line tax percent to two decimals', () => {
      const doc = createRoot();
      UblCommonBuilder.buildInvoiceLines(
        doc,
        [item({})],
        // '19' is what a Decimal(5,2) holding 19.00 used to serialize as.
        [
          {
            tax_name: 'IVA',
            tax_rate: '19',
            taxable_amount: '1000',
            tax_amount: '190',
          },
        ],
        'COP',
      );
      const xml = doc.end({ prettyPrint: false });
      expect(readValues(xml, 'Percent')[0]).toBe('19.00');
    });
  });
});

/**
 * Regresión del rechazo `FAU04` del 17/08/2026.
 *
 * `TaxExclusiveAmount` se emitía siempre como el bruto de líneas. La DIAN lo
 * compara contra
 * `sum(//cac:InvoiceLine/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount)`, y una
 * línea que omite su grupo de tributos —un EXCLUIDO, art. 476 ET— no aporta
 * ninguna base. La suscripción de $69.900 declaró 69900 contra una suma de 0.
 *
 * La guarda de `buildTaxTotals` sola NO corregía esto: son dos defectos
 * independientes en el mismo documento.
 */
describe('UblCommonBuilder TaxExclusiveAmount — base declarada (FAU04)', () => {
  function createRoot(): any {
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

  function line(overrides: Record<string, any>): any {
    return {
      description: 'Producto',
      quantity: '1',
      unit_price: '1000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '1000.00',
      ...overrides,
    };
  }

  function totalsOf(data: {
    discount_amount: string;
    tax_amount: string;
    items: any[];
    /** Ausente ⇒ `HEADER_IVA`. Ver el comentario de la constante. */
    taxes?: ProviderInvoiceTax[];
  }): Record<string, string> {
    const doc = createRoot();
    const full = { ...data, taxes: data.taxes ?? [HEADER_IVA] };
    UblCommonBuilder.buildLegalMonetaryTotal(doc, full, 'COP');
    const xml = doc.end({ prettyPrint: false });
    const out: Record<string, string> = {};
    for (const m of xml.matchAll(/<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g)) {
      out[m[1]] = m[2];
    }
    return out;
  }

  it('una operación 100 % excluida declara base imponible CERO, no el bruto', () => {
    // El caso exacto de la suscripción rechazada: una línea, excluida de IVA.
    const totals = totalsOf({
      discount_amount: '0.00',
      tax_amount: '0.00',
      items: [
        line({ unit_price: '69900.00', total_amount: '69900.00', omit_tax_total: true }),
      ],
    });

    expect(totals.LineExtensionAmount).toBe('69900.00');
    expect(totals.TaxExclusiveAmount).toBe('0.00');
    // FAU06 y FAU14 no se tocan: el cliente sigue debiendo lo mismo.
    expect(totals.TaxInclusiveAmount).toBe('69900.00');
    expect(totals.PayableAmount).toBe('69900.00');
  });

  it('en un documento mixto sólo suman las líneas que declaran tributo', () => {
    const totals = totalsOf({
      discount_amount: '0.00',
      tax_amount: '190.00',
      items: [
        line({ unit_price: '1000.00', tax_amount: '190.00', total_amount: '1190.00' }),
        line({ unit_price: '500.00', total_amount: '500.00', omit_tax_total: true }),
      ],
    });

    expect(totals.LineExtensionAmount).toBe('1500.00');
    expect(totals.TaxExclusiveAmount).toBe('1000.00');
    expect(totals.TaxInclusiveAmount).toBe('1690.00');
    expect(totals.PayableAmount).toBe('1690.00');
  });

  it('sin la bandera, la base sigue siendo el total de líneas — los tenants no cambian', () => {
    // Las 4 transmisiones aceptadas en producción tienen todas sus líneas
    // gravadas, así que el filtro no descarta ninguna y el valor es idéntico.
    const totals = totalsOf({
      discount_amount: '0.00',
      tax_amount: '190.00',
      items: [line({ unit_price: '1000.00', tax_amount: '190.00', total_amount: '1190.00' })],
    });

    expect(totals.LineExtensionAmount).toBe('1000.00');
    expect(totals.TaxExclusiveAmount).toBe('1000.00');
  });

  it('`omit_tax_total: false` es explícitamente una línea gravada', () => {
    const totals = totalsOf({
      discount_amount: '0.00',
      tax_amount: '190.00',
      items: [
        line({
          unit_price: '1000.00',
          tax_amount: '190.00',
          total_amount: '1190.00',
          omit_tax_total: false,
        }),
      ],
    });

    expect(totals.TaxExclusiveAmount).toBe('1000.00');
  });
});
