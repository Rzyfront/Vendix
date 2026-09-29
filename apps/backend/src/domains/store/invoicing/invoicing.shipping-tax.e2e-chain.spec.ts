import { create } from 'xmlbuilder2';
import { Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import {
  UblCommonBuilder,
  UblDocumentLine,
} from './providers/dian-direct/xml/ubl-common.builder';
import { DianTotalsValidator } from './providers/dian-direct/xml/dian-totals.validator';
import { UBL_NAMESPACES } from './providers/dian-direct/xml/xml-namespaces';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
} from './providers/invoice-provider.interface';
import { DianDirectProvider } from './providers/dian-direct/dian-direct.provider';
import {
  dianAmount,
  dianRate,
} from '../../../common/money-kernel/dian-money';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * Cadena orden → factura → XML (B8).
 *
 * La garantía de que la factura cuadra se ancla en el productor real
 * (`InvoicingService.createFromOrder`), no en líneas armadas a mano: la orden
 * de 100.000 con IVA 19 % incluido + envío de 15.000 con INC 8 % incluido
 * pasa por `createFromOrder`, lo persistido se mapea al contrato del
 * proveedor con las MISMAS funciones de emisión (`dianAmount`/`dianRate`,
 * ver `invoice-flow.service.ts`), se emite con `UblCommonBuilder` y se
 * valida con `DianTotalsValidator`.
 *
 * Importes: producto 84.033,61 + IVA 15.966,39 = 100.000;
 * envío 13.888,89 + INC 1.111,11 = 15.000; factura 115.000.
 */
describe('InvoicingService.createFromOrder → UBL — cadena con envío gravado (B8)', () => {
  const ORDER_ID = 9001;
  const money = (value: number | string) => new Prisma.Decimal(value);

  let prisma: PrismaMock;
  let service: InvoicingService;

  beforeEach(() => {
    mockRequestContext({ store_id: 105, organization_id: 1, user_id: 7 });

    prisma = createPrismaMock({
      orders: ['findFirst'],
      invoices: ['findFirst', 'create', 'update'],
      invoice_items: ['findMany', 'deleteMany'],
      invoice_taxes: ['createMany', 'deleteMany'],
    });
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.invoices.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 7001,
        invoice_number: null,
      }),
    );
    prisma.invoice_taxes.createMany.mockImplementation(
      async ({ data }: { data: unknown[] }) => ({ count: data.length }),
    );

    service = new InvoicingService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {
        resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 3 }),
      } as any,
      {} as any,
      {} as any,
      { assertAreaActive: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      new InvoiceCalculatorService(),
      {} as any,
      {} as any,
    );
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Orden real: producto 100.000 IVA 19 % incluido + envío 15.000 INC 8 %. */
  const taxedOrder = () =>
    buildOrder({
      shipping_cost: money(15000),
      shipping_tax_rate_id: 68,
      shipping_tax_name: 'INC',
      shipping_tax_type: 'inc',
      shipping_tax_rate: money('0.08000'),
      shipping_tax_amount: money('1111.11'),
      order_items: [
        buildOrderItem({
          quantity: 1,
          unit_price: money('84033.61'),
          total_price: money('84033.61'),
          tax_rate: money('0.19'),
          tax_amount_item: money('15966.39'),
          order_item_taxes: [
            {
              tax_rate_id: 1,
              tax_name: 'IVA 19%',
              tax_rate: money('0.19'),
              tax_amount: money('15966.39'),
              tax_type: 'iva',
              is_inclusive: true,
            },
          ],
        }),
      ],
    });

  const toProviderTax = (row: any): ProviderInvoiceTax => ({
    tax_name: row.tax_name,
    tax_rate: dianRate(row.tax_rate),
    taxable_amount: dianAmount(row.taxable_amount),
    tax_amount: dianAmount(row.tax_amount),
    tax_type: row.tax_type ?? undefined,
  });

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

  it('100.000 IVA 19 % + envío 15.000 INC 8 %: el productor factura 115.000 y el XML cuadra (FAU04/FAU06/FAX07)', async () => {
    prisma.orders.findFirst.mockResolvedValue(taxedOrder());
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 501 }, { id: 502 }]);

    await service.createFromOrder(ORDER_ID);

    // Lo que el productor real persistió: líneas + tributos por línea.
    const data = prisma.invoices.create.mock.calls[0][0].data as any;
    const persisted_taxes = (prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data ?? []) as any[];

    expect(data.subtotal_amount.toString()).toBe('97922.5');
    expect(data.tax_amount.toString()).toBe('17077.5');
    expect(data.total_amount.toString()).toBe('115000');
    expect(data.shipping_amount.toString()).toBe('13888.89');

    const [product, shipping] = data.invoice_items.create;
    expect(product.total_amount.toString()).toBe('100000');
    expect(shipping).toMatchObject({
      product_id: null,
      description: 'Envio',
      is_inclusive: false,
    });
    expect(shipping.unit_price.toString()).toBe('13888.89');
    expect(shipping.tax_amount.toString()).toBe('1111.11');
    expect(shipping.total_amount.toString()).toBe('15000');

    // Split forzado por el impuesto del envío: tributos ligados por línea.
    expect(data.invoice_taxes).toBeUndefined();
    expect(persisted_taxes).toHaveLength(2);

    // Mapeo al contrato del proveedor con las funciones de emisión.
    const items: UblDocumentLine[] = data.invoice_items.create.map(
      (item: any, index: number) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit_price: dianAmount(item.unit_price),
        discount_amount: dianAmount(item.discount_amount),
        tax_amount: dianAmount(item.tax_amount),
        total_amount: dianAmount(item.total_amount),
        taxes: persisted_taxes
          .filter((row) => Number(row.invoice_item_id) === 501 + index)
          .map(toProviderTax),
      }),
    );
    const header: ProviderInvoiceTax[] =
      persisted_taxes.map(toProviderTax);

    const xml = buildInvoiceXml(items, header, dianAmount(data.tax_amount));

    const [producto_xml, envio_xml] = invoiceLines(xml);
    expect(producto_xml).toContain('<cbc:ID>01</cbc:ID>');
    expect(producto_xml).toContain('<cbc:Percent>19.00</cbc:Percent>');
    expect(envio_xml).toContain('<cac:TaxTotal>');
    expect(envio_xml).toContain('<cbc:ID>04</cbc:ID>');
    expect(envio_xml).toContain('<cbc:Percent>8.00</cbc:Percent>');
    expect(envio_xml).toContain(
      '<cbc:TaxableAmount currencyID="COP">13888.89</cbc:TaxableAmount>',
    );
    expect(envio_xml).toContain(
      '<cbc:TaxAmount currencyID="COP">1111.11</cbc:TaxAmount>',
    );

    const totals = monetaryTotals(xml);
    expect(totals.LineExtensionAmount).toBe('97922.50');
    expect(totals.TaxExclusiveAmount).toBe('97922.50');
    expect(totals.TaxInclusiveAmount).toBe('115000.00');
    expect(totals.PayableAmount).toBe('115000.00');

    const result = DianTotalsValidator.validate(xml);
    expect(
      result.violations.filter((v) =>
        ['FAU04', 'FAU06', 'FAX07'].includes(v.rule),
      ),
    ).toEqual([]);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('paso 14 — agregado 10.000 IVA 19%: línea Envío base 10.000 + IVA 1.900 y el XML cuadra', async () => {
    prisma.orders.findFirst.mockResolvedValue(
      buildOrder({
        shipping_cost: money(11900),
        shipping_tax_rate_id: 5,
        shipping_tax_name: 'IVA',
        shipping_tax_type: 'iva',
        shipping_tax_rate: money('0.19000'),
        shipping_tax_amount: money('1900'),
        shipping_tax_is_inclusive: false,
        order_items: [
          buildOrderItem({
            quantity: 1,
            unit_price: money('42016.80'),
            total_price: money('42016.80'),
            tax_rate: money('0.19'),
            tax_amount_item: money('7983.20'),
            order_item_taxes: [
              {
                tax_rate_id: 1,
                tax_name: 'IVA 19%',
                tax_rate: money('0.19'),
                tax_amount: money('7983.20'),
                tax_type: 'iva',
                is_inclusive: true,
              },
            ],
          }),
        ],
      }),
    );
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 501 }, { id: 502 }]);

    await service.createFromOrder(ORDER_ID);

    const data = prisma.invoices.create.mock.calls[0][0].data as any;
    const persisted_taxes = (prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data ?? []) as any[];

    expect(data.subtotal_amount.toString()).toBe('52016.8');
    expect(data.tax_amount.toString()).toBe('9883.2');
    expect(data.total_amount.toString()).toBe('61900');
    expect(data.shipping_amount.toString()).toBe('10000');

    const [product, shipping] = data.invoice_items.create;
    expect(product.total_amount.toString()).toBe('50000');
    expect(shipping).toMatchObject({
      product_id: null,
      description: 'Envio',
      is_inclusive: false,
    });
    expect(shipping.unit_price.toString()).toBe('10000');
    expect(shipping.tax_amount.toString()).toBe('1900');
    expect(shipping.total_amount.toString()).toBe('11900');
    expect(persisted_taxes).toHaveLength(2);

    const items: UblDocumentLine[] = data.invoice_items.create.map(
      (item: any, index: number) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit_price: dianAmount(item.unit_price),
        discount_amount: dianAmount(item.discount_amount),
        tax_amount: dianAmount(item.tax_amount),
        total_amount: dianAmount(item.total_amount),
        taxes: persisted_taxes
          .filter((row) => Number(row.invoice_item_id) === 501 + index)
          .map(toProviderTax),
      }),
    );
    const header: ProviderInvoiceTax[] =
      persisted_taxes.map(toProviderTax);

    const xml = buildInvoiceXml(items, header, dianAmount(data.tax_amount));

    const [, envio_xml] = invoiceLines(xml);
    expect(envio_xml).toContain('<cbc:ID>01</cbc:ID>');
    expect(envio_xml).toContain('<cbc:Percent>19.00</cbc:Percent>');
    expect(envio_xml).toContain(
      '<cbc:TaxableAmount currencyID="COP">10000.00</cbc:TaxableAmount>',
    );
    expect(envio_xml).toContain(
      '<cbc:TaxAmount currencyID="COP">1900.00</cbc:TaxAmount>',
    );

    const totals = monetaryTotals(xml);
    expect(totals.LineExtensionAmount).toBe('52016.80');
    expect(totals.TaxExclusiveAmount).toBe('52016.80');
    expect(totals.TaxInclusiveAmount).toBe('61900.00');
    expect(totals.PayableAmount).toBe('61900.00');

    const result = DianTotalsValidator.validate(xml);
    expect(
      result.violations.filter((v) =>
        ['FAU04', 'FAU06', 'FAX07'].includes(v.rule),
      ),
    ).toEqual([]);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('CUFE: ValImp reparte el impuesto del productor por tipo (IVA 15.966,39 / INC 1.111,11)', async () => {
    prisma.orders.findFirst.mockResolvedValue(taxedOrder());
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 501 }, { id: 502 }]);

    await service.createFromOrder(ORDER_ID);

    const persisted_taxes = (prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data ?? []) as any[];
    const calculateTaxAmounts = (DianDirectProvider.prototype as any)
      .calculateTaxAmounts as (data: Partial<ProviderInvoiceData>) => {
      iva: string;
      inc: string;
      ica: string;
    };
    expect(
      calculateTaxAmounts.call(
        {},
        { taxes: persisted_taxes.map(toProviderTax) },
      ),
    ).toEqual({ iva: '15966.39', inc: '1111.11', ica: '0.00' });
  });
});
