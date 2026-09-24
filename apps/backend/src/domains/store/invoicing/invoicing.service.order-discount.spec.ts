import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import { InvoicingService } from './invoicing.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { FiscalDocumentValidator } from './validators/fiscal-document.validator';
import { projectOrderInvoiceLines } from './utils/order-invoice-lines.util';
import { derivePartialNoteLinesViaKernel } from './credit-notes/credit-notes.service';
import {
  UblCommonBuilder,
  UblDocumentLine,
} from './providers/dian-direct/xml/ubl-common.builder';
import { DianTotalsValidator } from './providers/dian-direct/xml/dian-totals.validator';
import { UBL_NAMESPACES } from './providers/dian-direct/xml/xml-namespaces';
import { DianDirectProvider } from './providers/dian-direct/dian-direct.provider';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
} from './providers/invoice-provider.interface';
import { ErrorCodes } from 'src/common/errors';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — DESCUENTO DE ORDEN (P0-2) e IMPUESTO DE LÍNEA sobre la
 * base total de la línea (P2-1).
 *
 * P0-2. POS y checkout aplican `orders.discount_amount` DESPUÉS del impuesto y
 * ninguna línea lo lleva (`order_items` no tiene columna de descuento). La
 * factura lo perdía: cobraba 242.000 y facturaba 252.000. Regla (art. 454 ET):
 * lo que pagó el cliente no cambia. El descuento se reparte por bruto, el
 * centavo sobrante a la línea mayor, y cada línea se despeja UNA vez.
 *
 * Orden (importes a mano):
 * · Camisa   2 × 50.000 + IVA 19 %   = 119.000 bruto
 * · Licor    1 × 100.000 + INC 8 %   = 108.000 bruto
 * · Libro    exento                   =  20.000 bruto
 * · Envío    5.000 = 4.201,69 + IVA 798,31 (copia de la orden, sin descuento)
 * · Descuento de orden 10.000 ⇒ grand_total 247.000 − 10.000 + 5.000 = 242.000
 *
 * Reparto 10.000 × bruto / 247.000 (truncado): 4.817,81 / 4.372,46 / 809,71
 * = 9.999,98 ⇒ los 2 ¢ a la Camisa (4.817,83).
 * · Camisa 114.182,17 ⇒ base 95.951,41 + IVA 18.230,76
 * · Licor  103.627,54 ⇒ base 95.951,43 + INC 7.676,11
 * · Libro   19.190,29 ⇒ base 19.190,29
 *
 * P2-1. INC 8 % incluido, 2.425 × 500: el canal guarda base 2.245,37 +
 * 179,62 por unidad ⇒ línea 1.122.685 + 89.810 (bruto 1.212.495). Pero
 * trunc(1.122.685 × 8 %) = 89.814,80: 4,80 de diferencia. Re-despejado el
 * bruto de la LÍNEA una sola vez: base 1.122.680,56 + INC 89.814,44.
 */
describe('InvoicingService.createFromOrder — descuento de orden e impuesto de línea', () => {
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
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const createDraft = async (order: Record<string, unknown>) => {
    prisma.orders.findFirst.mockResolvedValue(buildOrder(order));
    const lineCount =
      (order.order_items as unknown[]).length +
      (Number(order.shipping_cost || 0) > 0 ? 1 : 0);
    prisma.invoice_items.findMany.mockResolvedValue(
      Array.from({ length: lineCount }, (_, index) => ({ id: 501 + index })),
    );
    await service.createFromOrder(9001);
    const data = prisma.invoices.create.mock.calls[0][0].data;
    const line_tax_rows = (prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data ?? []) as any[];
    return { data, line_tax_rows };
  };

  const row = (
    tax_rate_id: number,
    tax_name: string,
    tax_rate: string,
    tax_amount: string,
    tax_type: string,
    is_inclusive: boolean,
  ) => ({
    tax_rate_id,
    tax_name,
    tax_rate: money(tax_rate),
    tax_amount: money(tax_amount),
    tax_type,
    is_inclusive,
  });

  const camisa = () =>
    buildOrderItem({
      id: 1,
      product_id: 11,
      product_name: 'Camisa',
      quantity: 2,
      unit_price: money('50000'),
      total_price: money('100000'),
      tax_rate: money('0.19'),
      tax_amount_item: money('9500'),
      order_item_taxes: [row(1, 'IVA 19%', '0.19', '19000', 'iva', false)],
    });
  const licor = () =>
    buildOrderItem({
      id: 2,
      product_id: 12,
      product_name: 'Licor',
      quantity: 1,
      unit_price: money('100000'),
      total_price: money('100000'),
      tax_rate: money('0.08'),
      tax_amount_item: money('8000'),
      order_item_taxes: [row(68, 'INC', '0.08', '8000', 'inc', true)],
    });
  const libro = () =>
    buildOrderItem({
      id: 3,
      product_id: 13,
      product_name: 'Libro',
      quantity: 1,
      unit_price: money('20000'),
      total_price: money('20000'),
      tax_rate: money('0'),
      tax_amount_item: money('0'),
      order_item_taxes: [],
    });
  const shippingCopy = {
    shipping_cost: money(5000),
    shipping_tax_rate_id: 1,
    shipping_tax_name: 'IVA 19%',
    shipping_tax_type: 'iva',
    shipping_tax_rate: money('0.19000'),
    shipping_tax_amount: money('798.31'),
  };
  const discountedOrder = () => ({
    ...shippingCopy,
    subtotal_amount: money('220000'),
    tax_amount: money('27000'),
    discount_amount: money('10000'),
    grand_total: money('242000'),
    order_items: [camisa(), licor(), libro()],
  });

  /** Factura persistida → datos UBL (líneas con SUS filas, cabecera = todas). */
  const toUbl = (data: any, line_tax_rows: any[]) => {
    const asTax = (r: any): ProviderInvoiceTax =>
      ({
        tax_name: r.tax_name,
        tax_type: r.tax_type,
        tax_rate: Number(r.tax_rate).toFixed(2),
        taxable_amount: Number(r.taxable_amount).toFixed(2),
        tax_amount: Number(r.tax_amount).toFixed(2),
      }) as ProviderInvoiceTax;
    const header = line_tax_rows.map(asTax);
    const items = (data.invoice_items.create as any[]).map(
      (line, index) =>
        ({
          description: line.description,
          quantity: Number(line.quantity).toString(),
          unit_price: Number(line.unit_price).toFixed(2),
          discount_amount: Number(line.discount_amount).toFixed(2),
          tax_amount: Number(line.tax_amount).toFixed(2),
          total_amount: Number(line.total_amount).toFixed(2),
          taxes: line_tax_rows
            .filter((r) => r.invoice_item_id === 501 + index)
            .map(asTax),
        }) as UblDocumentLine,
    );
    return { header, items };
  };

  const buildXml = (data: any, line_tax_rows: any[]) => {
    const { header, items } = toUbl(data, line_tax_rows);
    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
    const discount_amount = Number(data.discount_amount).toFixed(2);
    UblCommonBuilder.buildDocumentAllowanceCharge(
      doc,
      { discount_amount, items },
      'COP',
    );
    UblCommonBuilder.buildTaxTotals(doc, header, 'COP');
    UblCommonBuilder.buildLegalMonetaryTotal(
      doc,
      {
        tax_amount: Number(data.tax_amount).toFixed(2),
        items,
        taxes: header,
        discount_amount,
      },
      'COP',
    );
    UblCommonBuilder.buildInvoiceLines(doc, items, header, 'COP');
    return { xml: doc.end({ prettyPrint: false }), header };
  };

  const monetaryTotals = (xml: string) => {
    const totals: Record<string, string> = {};
    const block = xml.match(
      /<cac:LegalMonetaryTotal>([\s\S]*?)<\/cac:LegalMonetaryTotal>/,
    )![1];
    for (const n of block.matchAll(
      /<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g,
    )) {
      totals[n[1]] = n[2];
    }
    return totals;
  };

  const expectDianClean = (xml: string) => {
    const result = DianTotalsValidator.validate(xml);
    expect(result.violations.map((v) => `${v.rule}: ${v.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  };

  const taxSubtotalFindings = (rows: any[]) =>
    (new FiscalDocumentValidator() as any).checkTaxSubtotals(
      rows.map((r) => ({
        tax_name: r.tax_name,
        tax_type: r.tax_type,
        tax_rate: r.tax_rate,
        taxable_amount: r.taxable_amount,
        tax_amount: r.tax_amount,
      })),
    ) as Array<{ code: string }>;

  const sumCents = (rows: any[], field: string) =>
    Math.round(rows.reduce((a, r) => a + Number(r[field]), 0) * 100);

  describe('P0-2 — descuento de orden', () => {
    it('reparte por bruto, despeja cada línea y la factura suma EXACTO el grand_total', async () => {
      const { data, line_tax_rows } = await createDraft(discountedOrder());
      const [c, l, b, envio] = data.invoice_items.create;

      // Precio unitario y cantidad intactos; el descuento va en la línea.
      expect(c.unit_price.toString()).toBe('50000');
      expect(c.discount_amount.toString()).toBe('4048.59');
      expect(c.tax_amount.toString()).toBe('18230.76');
      expect(c.total_amount.toString()).toBe('114182.17');
      expect(l.discount_amount.toString()).toBe('4048.57');
      expect(l.tax_amount.toString()).toBe('7676.11');
      expect(l.total_amount.toString()).toBe('103627.54');
      expect(b.discount_amount.toString()).toBe('809.71');
      expect(b.tax_amount.toString()).toBe('0');
      expect(b.total_amount.toString()).toBe('19190.29');

      // El envío no recibe descuento.
      expect(envio.description).toBe('Envio');
      expect(envio.discount_amount.toString()).toBe('0');
      expect(envio.unit_price.toString()).toBe('4201.69');
      expect(envio.tax_amount.toString()).toBe('798.31');
      expect(envio.total_amount.toString()).toBe('5000');

      // Cabecera: subtotal NETO (FAU02), descuento = Σ descuentos de línea.
      expect(data.subtotal_amount.toString()).toBe('215294.82');
      expect(data.discount_amount.toString()).toBe('8906.87');
      expect(data.tax_amount.toString()).toBe('26705.18');
      expect(data.total_amount.toString()).toBe('242000');
      const lineTotals = (data.invoice_items.create as any[]).reduce(
        (a, line) => a + Math.round(Number(line.total_amount) * 100),
        0,
      );
      expect(lineTotals).toBe(24200000);

      // Filas ligadas: base = base neta de SU línea; Σ = cabecera.
      expect(data.invoice_taxes).toBeUndefined();
      const byItem = (id: number) =>
        line_tax_rows.filter((r) => r.invoice_item_id === id);
      expect(byItem(501)[0].taxable_amount.toString()).toBe('95951.41');
      expect(byItem(501)[0].tax_amount.toString()).toBe('18230.76');
      expect(byItem(502)[0].taxable_amount.toString()).toBe('95951.43');
      expect(byItem(502)[0].tax_amount.toString()).toBe('7676.11');
      expect(byItem(503)).toHaveLength(0);
      expect(byItem(504)[0].tax_amount.toString()).toBe('798.31');
      expect(sumCents(line_tax_rows, 'tax_amount')).toBe(2670518);
      expect(taxSubtotalFindings(line_tax_rows)).toEqual([]);
    });

    it('UBL: AllowanceCharge de línea reduce LineExtension; Payable = grand_total; FAU04/FAU06/FAX07 limpios', async () => {
      const { data, line_tax_rows } = await createDraft(discountedOrder());
      const { xml, header } = buildXml(data, line_tax_rows);

      const lines = [
        ...xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/g),
      ].map((m) => m[1]);
      expect(lines[0]).toContain(
        '<cbc:LineExtensionAmount currencyID="COP">95951.41</cbc:LineExtensionAmount>',
      );
      expect(lines[0]).toContain(
        '<cbc:Amount currencyID="COP">4048.59</cbc:Amount>',
      );
      expect(lines[0]).toContain(
        '<cbc:BaseAmount currencyID="COP">100000.00</cbc:BaseAmount>',
      );
      expect(lines[3]).not.toContain('<cac:AllowanceCharge>');

      // Todo el descuento está en las líneas: sin AllowanceCharge de documento.
      const body = xml.replace(
        /<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g,
        '',
      );
      expect(body).not.toContain('<cac:AllowanceCharge>');

      const totals = monetaryTotals(xml);
      expect(totals.LineExtensionAmount).toBe('215294.82');
      expect(totals.TaxInclusiveAmount).toBe('242000.00');
      expect(totals.AllowanceTotalAmount).toBe('0.00');
      expect(totals.PayableAmount).toBe('242000.00');
      expectDianClean(xml);

      // CUFE: ValImp por esquema.
      const calculateTaxAmounts = (DianDirectProvider.prototype as any)
        .calculateTaxAmounts as (data: Partial<ProviderInvoiceData>) => {
        iva: string;
        inc: string;
        ica: string;
      };
      expect(calculateTaxAmounts.call({}, { taxes: header })).toEqual({
        iva: '19029.07',
        inc: '7676.11',
        ica: '0.00',
      });
    });

    it('orden sin descuento: factura idéntica a la de hoy (ninguna línea proyectada)', async () => {
      const { data } = await createDraft({
        ...shippingCopy,
        discount_amount: money(0),
        order_items: [camisa(), licor(), libro()],
      });
      const [c, l, b] = data.invoice_items.create;
      expect(c.discount_amount.toString()).toBe('0');
      expect(c.tax_amount.toString()).toBe('19000');
      expect(c.total_amount.toString()).toBe('119000');
      expect(l.total_amount.toString()).toBe('108000');
      expect(b.total_amount.toString()).toBe('20000');
      expect(data.subtotal_amount.toString()).toBe('224201.69');
      expect(data.discount_amount.toString()).toBe('0');
      expect(data.total_amount.toString()).toBe('252000');
    });

    it('descuento mayor que las líneas: rechaza ANTES de crear el borrador (INVOICING_CALC_006)', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        buildOrder({
          discount_amount: money('247000.01'),
          order_items: [camisa(), licor(), libro()],
        }),
      );
      await expect(service.createFromOrder(9001)).rejects.toMatchObject({
        errorCode: ErrorCodes.INVOICING_CALC_006.code,
      });
      expect(prisma.invoices.create).not.toHaveBeenCalled();
    });
  });

  describe('filas que no se pueden despejar (M3)', () => {
    it('tarifa 0 con impuesto > 0 y descuento de orden: rechaza antes del borrador, sin perder el impuesto', async () => {
      const roto = buildOrderItem({
        id: 5,
        product_id: 15,
        product_name: 'Roto',
        quantity: 1,
        unit_price: money('10000'),
        total_price: money('10000'),
        tax_rate: money('0'),
        tax_amount_item: money('1900'),
        order_item_taxes: [row(1, 'IVA 19%', '0', '1900', 'iva', false)],
      });
      prisma.orders.findFirst.mockResolvedValue(
        buildOrder({
          discount_amount: money('1000'),
          order_items: [camisa(), roto],
        }),
      );
      await expect(service.createFromOrder(9001)).rejects.toMatchObject({
        errorCode: ErrorCodes.INVOICING_CALC_006.code,
      });
      expect(prisma.invoices.create).not.toHaveBeenCalled();
    });

    it('exenta legítima (tarifa 0, impuesto 0) sí recibe su parte del descuento', async () => {
      const exenta = buildOrderItem({
        id: 6,
        product_id: 16,
        product_name: 'Exenta',
        quantity: 1,
        unit_price: money('10000'),
        total_price: money('10000'),
        tax_rate: money('0'),
        tax_amount_item: money('0'),
        order_item_taxes: [row(9, 'Exento', '0', '0', 'iva', false)],
      });
      const { data } = await createDraft({
        discount_amount: money('1290'),
        order_items: [camisa(), exenta],
      });
      // 1.290 × 10.000 / 129.000 = 100 a la exenta; 1.190 a la Camisa.
      const [, e] = data.invoice_items.create;
      expect(e.discount_amount.toString()).toBe('100');
      expect(e.total_amount.toString()).toBe('9900');
      expect(data.total_amount.toString()).toBe('127710');
    });

    it('tarifa compuesta: invalid_rate (el despeje es aditivo)', () => {
      const result = projectOrderInvoiceLines(
        [
          {
            quantity: 1,
            total_price: '1000',
            tax_amount_item: '190',
            order_item_taxes: [
              {
                tax_name: 'IVA',
                tax_rate: '0.19',
                tax_amount: '190',
                tax_type: 'iva',
                is_compound: true,
              },
            ],
          },
        ],
        '10',
      );
      expect(result.error).toMatchObject({ code: 'invalid_rate' });
    });
  });

  describe('bruto que la tarifa no alcanza (M4): la factura siempre cierra', () => {
    const dosTarifas = () => ({
      quantity: 1,
      total_price: '720',
      tax_amount_item: '280.8',
      order_item_taxes: [
        { tax_name: 'IVA', tax_rate: '0.19', tax_amount: '136.8', tax_type: 'iva' },
        { tax_name: 'ICUI', tax_rate: '0.2', tax_amount: '144', tax_type: 'icui' },
      ],
    });

    it('IVA 19 % + 20 %: el despeje deja 2 ¢ abajo y se reparten 1 ¢ por fila', () => {
      // 1.000,80 − 0,22 = 1.000,58: el kernel llega a 1.000,56 (base 719,84).
      const result = projectOrderInvoiceLines([dosTarifas()], '0.22');
      expect(result.error).toBeUndefined();
      const [line] = result.lines;
      expect(line.base.toString()).toBe('719.84');
      expect(line.tax_amounts.map(String)).toEqual(['136.77', '143.97']);
      expect(line.base.plus(line.tax_total).toString()).toBe('1000.58');
      expect(
        taxSubtotalFindings([
          { tax_name: 'IVA', tax_type: 'iva', tax_rate: 19, taxable_amount: '719.84', tax_amount: '136.77' },
          { tax_name: 'ICUI', tax_type: 'icui', tax_rate: 20, taxable_amount: '719.84', tax_amount: '143.97' },
        ]),
      ).toEqual([]);
    });

    it('mensaje del rechazo: sin jerga y sin pedir tocar una orden ya cobrada', async () => {
      prisma.orders.findFirst.mockResolvedValue(
        buildOrder({
          discount_amount: money('247000.01'),
          order_items: [camisa(), licor(), libro()],
        }),
      );
      const error = await service.createFromOrder(9001).catch((e) => e);
      expect(String(error.message)).toContain('No se creó la factura');
      expect(String(error.message)).not.toMatch(/base negativa|centavo/);
    });
  });

  describe('NC sobre una línea proyectada con el centavo cerrado en la cuota', () => {
    // 2 × 500 + IVA 19 % = 1.190; descuento de orden 0,01 ⇒ 1.189,99 no se
    // alcanza: base 999,99 + IVA 190,00 (trunc 189,99 + 1 ¢).
    const projected = projectOrderInvoiceLines(
      [
        {
          quantity: 2,
          total_price: '1000',
          tax_amount_item: '95',
          order_item_taxes: [
            { tax_name: 'IVA 19%', tax_rate: '0.19', tax_amount: '190', tax_type: 'iva' },
          ],
        },
      ],
      '0.01',
    ).lines[0];
    const related = [
      {
        id: 501,
        product_id: 11,
        product_variant_id: null,
        is_inclusive: false,
        tax_amount: Number(projected.tax_total),
        quantity: 2,
        unit_price: 500,
        discount_amount: Number(projected.discount),
      },
    ];
    const iva19 = [
      { tax_rate_id: 1, tax_name: 'IVA 19%', tax_rate: 19, tax_type: 'iva', invoice_item_id: 501 },
    ];

    const creditNoteXml = (note: ReturnType<typeof derivePartialNoteLinesViaKernel>, discount: number, quantity: number) => {
      const header = note.taxes.map(
        (t) =>
          ({
            tax_name: t.tax_name,
            tax_type: t.tax_type,
            tax_rate: t.tax_rate.toFixed(2),
            taxable_amount: t.taxable_amount.toFixed(2),
            tax_amount: t.tax_amount.toFixed(2),
          }) as ProviderInvoiceTax,
      );
      const items = [
        {
          description: 'Producto',
          quantity: String(quantity),
          unit_price: '500.00',
          discount_amount: discount.toFixed(2),
          tax_amount: Number(note.lines[0].tax_amount).toFixed(2),
          total_amount: Number(note.lines[0].total_amount).toFixed(2),
          taxes: header.map((t) => ({ ...t })),
        } as UblDocumentLine,
      ];
      const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(
        UBL_NAMESPACES.CREDIT_NOTE,
        'CreditNote',
        {
          'xmlns:cac': UBL_NAMESPACES.CAC,
          'xmlns:cbc': UBL_NAMESPACES.CBC,
          'xmlns:ext': UBL_NAMESPACES.EXT,
        },
      );
      UblCommonBuilder.buildTaxTotals(doc, header, 'COP');
      UblCommonBuilder.buildLegalMonetaryTotal(
        doc,
        {
          tax_amount: Number(note.totals.tax).toFixed(2),
          items,
          taxes: header,
          discount_amount: discount.toFixed(2),
        },
        'COP',
      );
      UblCommonBuilder.buildDocumentLines(doc, items, header, 'COP', {
        line_element: 'CreditNoteLine',
        quantity_element: 'CreditedQuantity',
      });
      return { xml: doc.end({ prettyPrint: false }), header };
    };

    it('fixture: la línea proyectada lleva el centavo en la cuota', () => {
      expect(projected.base.toString()).toBe('999.99');
      expect(projected.tax_total.toString()).toBe('190');
    });

    it('NC de la línea completa: hereda 190,00 y prevalidador + FAU04/FAU06/FAX07 limpios', () => {
      const note = derivePartialNoteLinesViaKernel(
        [{ product_id: 11, quantity: 2, unit_price: 500, discount_amount: 0.01 }],
        related,
        iva19,
        920,
        'credit_note',
      );
      expect(note.lines[0].base_amount.toString()).toBe('999.99');
      expect(note.lines[0].tax_amount.toString()).toBe('190');
      expect(note.lines[0].total_amount.toString()).toBe('1189.99');
      expect(taxSubtotalFindings(note.taxes)).toEqual([]);
      const { xml } = creditNoteXml(note, 0.01, 2);
      expectDianClean(xml);
      expect(monetaryTotals(xml).PayableAmount).toBe('1189.99');
    });

    it('NC parcial (1 de 2): el kernel re-deriva sin el centavo y también cuadra', () => {
      const note = derivePartialNoteLinesViaKernel(
        [{ product_id: 11, quantity: 1, unit_price: 500, discount_amount: 0 }],
        related,
        iva19,
        921,
        'credit_note',
      );
      expect(note.lines[0].base_amount.toString()).toBe('500');
      expect(note.lines[0].tax_amount.toString()).toBe('95');
      expect(taxSubtotalFindings(note.taxes)).toEqual([]);
      expectDianClean(creditNoteXml(note, 0, 1).xml);
    });
  });

  describe('P2-1 — impuesto sobre la base total de la línea', () => {
    const licorPorMayor = () =>
      buildOrderItem({
        id: 4,
        product_id: 14,
        product_name: 'Licor por mayor',
        quantity: 500,
        unit_price: money('2245.37'),
        total_price: money('1122685'),
        tax_rate: money('0.08'),
        tax_amount_item: money('179.62'),
        order_item_taxes: [row(68, 'INC', '0.08', '89810', 'inc', true)],
      });

    it('INC incluido 2.425 × 500: re-despeja el bruto de la línea una vez; FAX07 limpio', async () => {
      const { data, line_tax_rows } = await createDraft({
        discount_amount: money(0),
        grand_total: money('1212495'),
        order_items: [licorPorMayor()],
      });
      const [line] = data.invoice_items.create;
      expect(line.quantity.toString()).toBe('500');
      expect(line.unit_price.toString()).toBe('2245.37');
      expect(line.discount_amount.toString()).toBe('4.44');
      expect(line.tax_amount.toString()).toBe('89814.44');
      expect(line.total_amount.toString()).toBe('1212495');
      expect(data.subtotal_amount.toString()).toBe('1122680.56');
      expect(data.tax_amount.toString()).toBe('89814.44');
      expect(data.total_amount.toString()).toBe('1212495');

      expect(line_tax_rows).toHaveLength(1);
      expect(line_tax_rows[0].taxable_amount.toString()).toBe('1122680.56');
      expect(line_tax_rows[0].tax_amount.toString()).toBe('89814.44');
      expect(taxSubtotalFindings(line_tax_rows)).toEqual([]);

      const { xml } = buildXml(data, line_tax_rows);
      const totals = monetaryTotals(xml);
      expect(totals.LineExtensionAmount).toBe('1122680.56');
      expect(totals.PayableAmount).toBe('1212495.00');
      expectDianClean(xml);
    });

    it('sin re-despeje la línea declararía 89.810 sobre 1.122.685 (4,80 fuera de FAX07)', () => {
      // Lo que la factura llevaba hasta hoy, para fijar que el caso es real.
      const expected = Math.floor(1122685 * 0.08 * 100) / 100;
      expect(expected).toBe(89814.8);
      expect(Math.abs(expected - 89810)).toBeGreaterThan(2);
    });
  });

  describe('projectOrderInvoiceLines (puro)', () => {
    const plain = (total: string, tax: string, fraction: string) => ({
      quantity: 1,
      total_price: total,
      tax_amount_item: tax,
      order_item_taxes: [
        {
          tax_name: 'IVA',
          tax_rate: fraction,
          tax_amount: tax,
          tax_type: 'iva',
          is_inclusive: false,
        },
      ],
    });

    it('deriva de un centavo (truncado del productor) NO re-despeja: la línea queda como hoy', () => {
      const result = projectOrderInvoiceLines(
        [plain('4201.69', '798.31', '0.19')],
        0,
      );
      expect(result.error).toBeUndefined();
      expect(result.lines[0].reason).toBe('unchanged');
      expect(result.lines[0].tax_total.toString()).toBe('798.31');
    });

    it('el centavo sobrante del reparto va a la línea de mayor bruto', () => {
      const result = projectOrderInvoiceLines(
        [plain('1000', '190', '0.19'), plain('2000', '380', '0.19')],
        '0.05',
      );
      expect(result.error).toBeUndefined();
      expect(result.allocated_discount.toString()).toBe('0.05');
      // 0,05 × 1190/3570 = 0,0166… ⇒ 0,01; 0,05 × 2380/3570 = 0,0333… ⇒ 0,03;
      // el centavo que falta va a la línea de 2.380.
      expect(result.lines[0].order_discount_share.toString()).toBe('0.01');
      expect(result.lines[1].order_discount_share.toString()).toBe('0.04');
      expect(result.lines[1].base.plus(result.lines[1].tax_total).toString()).toBe(
        '2379.96',
      );
    });

    it('bruto inalcanzable por la tarifa: el centavo va a la cuota y la línea cierra exacto', () => {
      // 1.189,99 no es b + trunc(0,19·b) para ningún b: 999,99 da 1.189,98.
      const result = projectOrderInvoiceLines(
        [plain('1000', '190', '0.19')],
        '0.01',
      );
      expect(result.error).toBeUndefined();
      expect(result.lines[0].base.toString()).toBe('999.99');
      expect(result.lines[0].tax_total.toString()).toBe('190');
      expect(result.lines[0].discount.toString()).toBe('0.01');
      expect(result.allocated_discount.toString()).toBe('0.01');
    });

    it('cada línea descontada cierra al centavo: base + impuesto = bruto − su parte', () => {
      const items = [
        plain('100000', '19000', '0.19'),
        plain('33333', '6333.27', '0.19'),
      ];
      const result = projectOrderInvoiceLines(items, '12345.67');
      expect(result.error).toBeUndefined();
      const grossAfter = result.lines.reduce(
        (a, l) => a + Math.round(Number(l.base.plus(l.tax_total)) * 100),
        0,
      );
      expect(grossAfter).toBe(Math.round((119000 + 39666.27 - 12345.67) * 100));
      for (const line of result.lines) {
        const trunc = Math.floor(Number(line.base) * 0.19 * 100) / 100;
        expect(Math.abs(Number(line.tax_total) - trunc)).toBeLessThanOrEqual(0.01);
      }
    });

    it('línea con impuesto escalar y SIN filas (F-090) no absorbe descuento', () => {
      const result = projectOrderInvoiceLines(
        [
          { quantity: 1, total_price: '1000', tax_amount_item: '190', order_item_taxes: [] },
          plain('1000', '190', '0.19'),
        ],
        '100',
      );
      expect(result.error).toBeUndefined();
      expect(result.lines[0].reason).toBe('unchanged');
      expect(result.lines[1].order_discount_share.toString()).toBe('100');
    });

    it('descuento mayor que el bruto elegible ⇒ discount_exceeds_lines', () => {
      const result = projectOrderInvoiceLines(
        [plain('1000', '190', '0.19')],
        '1190.01',
      );
      expect(result.error).toEqual({
        code: 'discount_exceeds_lines',
        discount: '1190.01',
        eligible_gross: '1190.00',
      });
    });
  });
});
