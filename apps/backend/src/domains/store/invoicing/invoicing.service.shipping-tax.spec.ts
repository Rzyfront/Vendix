import { Prisma } from '@prisma/client';
import {
  InvoicingService,
  resolveInvoiceShippingTax,
} from './invoicing.service';
import { judgeDraftLineSnapshot } from './invoice-flow/invoice-flow.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { FiscalDocumentValidator } from './validators/fiscal-document.validator';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — impuesto opcional del envío, leído de la COPIA congelada
 * en la orden (`orders.shipping_tax_*`), nunca de la tarifa.
 *
 * Importes LITERALES calculados a mano (truncado DIAN al vender):
 * · 15.000 con IVA 19 % ⇒ base 12.605,04 + IVA 2.394,96
 * · 15.000 con INC 8 %  ⇒ base 13.888,89 + INC 1.111,11
 * El total de la factura es el MISMO de hoy: el impuesto va incluido.
 */
describe('InvoicingService.createFromOrder — impuesto del envío (copia de la orden)', () => {
  const ORDER_ID = 9001;
  const money = (value: number | string) => new Prisma.Decimal(value);

  const incRow = () => ({
    tax_rate_id: 68,
    tax_name: 'INC',
    tax_rate: money('0.08'),
    tax_amount: money('4000'),
    tax_type: 'inc',
    is_inclusive: true,
  });
  const ivaRow = () => ({
    tax_rate_id: 1,
    tax_name: 'IVA 19%',
    tax_rate: money('0.19'),
    tax_amount: money('9500'),
    tax_type: 'iva',
    is_inclusive: false,
  });

  const ivaShippingCopy = {
    shipping_tax_rate_id: 1,
    shipping_tax_name: 'IVA 19%',
    shipping_tax_type: 'iva',
    shipping_tax_rate: money('0.19000'),
    shipping_tax_amount: money('2394.96'),
  };
  const incShippingCopy = {
    shipping_tax_rate_id: 68,
    shipping_tax_name: 'INC',
    shipping_tax_type: 'inc',
    shipping_tax_rate: money('0.08000'),
    shipping_tax_amount: money('1111.11'),
  };
  const emptyShippingCopy = {
    shipping_tax_rate_id: null,
    shipping_tax_name: null,
    shipping_tax_type: null,
    shipping_tax_rate: null,
    shipping_tax_amount: money('0'),
  };

  let prisma: PrismaMock;
  let service: InvoicingService;

  beforeEach(() => {
    mockRequestContext({ store_id: 105, organization_id: 1, user_id: 7 });

    prisma = createPrismaMock({
      orders: ['findFirst'],
      invoices: ['findFirst', 'create'],
      invoice_items: ['findMany'],
      invoice_taxes: ['createMany'],
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

  const createDraft = async (
    order: Record<string, unknown>,
    opts: { persisted_items?: number } = {},
  ) => {
    prisma.orders.findFirst.mockResolvedValue(buildOrder(order));
    const lineCount =
      opts.persisted_items ??
      (order.order_items as unknown[]).length +
        (Number(order.shipping_cost || 0) > 0 ? 1 : 0);
    prisma.invoice_items.findMany.mockResolvedValue(
      Array.from({ length: lineCount }, (_, index) => ({ id: 501 + index })),
    );
    await service.createFromOrder(ORDER_ID);
    const data = prisma.invoices.create.mock.calls[0][0].data;
    const line_tax_rows = (prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data ?? []) as any[];
    return { data, line_tax_rows };
  };

  const incPlato = () =>
    buildOrderItem({
      quantity: 1,
      unit_price: money('50000'),
      total_price: money('50000'),
      tax_rate: money('0.08'),
      tax_amount_item: money('4000'),
      order_item_taxes: [incRow()],
    });
  const ivaProducto = () =>
    buildOrderItem({
      quantity: 1,
      unit_price: money('50000'),
      total_price: money('50000'),
      tax_rate: money('0.19'),
      tax_amount_item: money('9500'),
      order_item_taxes: [ivaRow()],
    });

  /** `checkTaxSubtotals` del prevalidador sobre las filas persistidas. */
  const taxSubtotalFindings = (rows: any[]) =>
    (new FiscalDocumentValidator() as any).checkTaxSubtotals(
      rows.map((row) => ({
        tax_name: row.tax_name,
        tax_type: row.tax_type,
        tax_rate: row.tax_rate,
        taxable_amount: row.taxable_amount,
        tax_amount: row.tax_amount,
      })),
    ) as Array<{ code: string; severity: string }>;

  const sumCents = (rows: any[], field: string) =>
    Math.round(rows.reduce((a, r) => a + Number(r[field]), 0) * 100);

  it('envío con IVA 19 % + plato INC: Envío en forma base con su fila IVA ligada; total idéntico', async () => {
    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(15000),
      ...ivaShippingCopy,
      order_items: [incPlato()],
    });

    const [product, shipping] = data.invoice_items.create;
    expect(product.total_amount.toString()).toBe('54000');
    expect(shipping).toMatchObject({ product_id: null, description: 'Envio' });
    expect(shipping.is_inclusive).toBe(false);
    expect(shipping.unit_price.toString()).toBe('12605.04');
    expect(shipping.tax_amount.toString()).toBe('2394.96');
    expect(shipping.total_amount.toString()).toBe('15000');

    expect(data.subtotal_amount.toString()).toBe('62605.04');
    expect(data.tax_amount.toString()).toBe('6394.96');
    expect(data.shipping_amount.toString()).toBe('12605.04');
    expect(data.total_amount.toString()).toBe('69000');

    // Split forzado: ninguna fila de cabecera suelta, todas ligadas.
    expect(data.invoice_taxes).toBeUndefined();
    expect(line_tax_rows).toHaveLength(2);
    const productRow = line_tax_rows.find((r) => r.invoice_item_id === 501);
    expect(productRow).toMatchObject({ tax_type: 'inc', tax_rate_id: 68 });
    const shippingRow = line_tax_rows.find((r) => r.invoice_item_id === 502);
    expect(shippingRow).toMatchObject({
      tax_rate_id: 1,
      tax_name: 'IVA 19%',
      tax_type: 'iva',
      is_inclusive: false,
    });
    expect(shippingRow.tax_rate.toString()).toBe('19');
    expect(shippingRow.taxable_amount.toString()).toBe('12605.04');
    expect(shippingRow.tax_amount.toString()).toBe('2394.96');

    // FAU06: Σ filas = impuesto de cabecera; FAU04: Σ bases = subtotal.
    expect(sumCents(line_tax_rows, 'tax_amount')).toBe(639496);
    expect(sumCents(line_tax_rows, 'taxable_amount')).toBe(6260504);

    // 12.605,04 × 19 % = 2.394,9576: difiere 1 ¢ del truncado de venta y el
    // prevalidador lo acepta (umbral estricto > 1 ¢).
    expect(taxSubtotalFindings(line_tax_rows)).toEqual([]);

    // El gate del borrador no bloquea ninguna línea.
    for (const [index, line] of data.invoice_items.create.entries()) {
      expect(
        judgeDraftLineSnapshot({ ...line, id: 501 + index }, line_tax_rows)
          .kind,
      ).not.toBe('block');
    }
  });

  it('envío con INC 8 % + plato INC 8 %: dos filas INC ligadas, cada una a su línea', async () => {
    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(15000),
      ...incShippingCopy,
      order_items: [incPlato()],
    });

    const [, shipping] = data.invoice_items.create;
    expect(shipping.unit_price.toString()).toBe('13888.89');
    expect(shipping.tax_amount.toString()).toBe('1111.11');
    expect(shipping.total_amount.toString()).toBe('15000');
    expect(data.subtotal_amount.toString()).toBe('63888.89');
    expect(data.tax_amount.toString()).toBe('5111.11');
    expect(data.shipping_amount.toString()).toBe('13888.89');
    expect(data.total_amount.toString()).toBe('69000');

    expect(data.invoice_taxes).toBeUndefined();
    expect(line_tax_rows).toHaveLength(2);
    expect(line_tax_rows.every((r) => r.tax_type === 'inc')).toBe(true);
    const shippingRow = line_tax_rows.find((r) => r.invoice_item_id === 502);
    expect(shippingRow.tax_rate.toString()).toBe('8');
    expect(shippingRow.taxable_amount.toString()).toBe('13888.89');
    expect(shippingRow.tax_amount.toString()).toBe('1111.11');
    expect(sumCents(line_tax_rows, 'tax_amount')).toBe(511111);
    expect(sumCents(line_tax_rows, 'taxable_amount')).toBe(6388889);
    expect(taxSubtotalFindings(line_tax_rows)).toEqual([]);
  });

  /**
   * Forma legacy de la línea Envío, literal. Si esta forma cambia, una orden
   * SIN copia de impuesto cambió su factura.
   */
  const legacyShippingLine = (gross: string) => ({
    product_id: null,
    product_variant_id: null,
    description: 'Envio',
    quantity: money(1),
    unit_price: money(gross),
    discount_amount: money(0),
    tax_amount: money(0),
    total_amount: money(gross),
    applied_price_tier_name: null,
    stock_units_consumed: null,
    serial_numbers_snapshot: null,
  });

  it('sin copia (shipping_tax_amount = 0): factura idéntica a la de hoy', async () => {
    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(15000),
      ...emptyShippingCopy,
      order_items: [ivaProducto()],
    });

    const [, shipping] = data.invoice_items.create;
    expect(shipping).toEqual(legacyShippingLine('15000'));
    expect(Object.keys(shipping)).not.toContain('is_inclusive');
    expect(data.subtotal_amount.toString()).toBe('65000');
    expect(data.tax_amount.toString()).toBe('9500');
    expect(data.shipping_amount.toString()).toBe('15000');
    expect(data.total_amount.toString()).toBe('74500');
    // Un solo tributo agregado ⇒ fila de cabecera, sin split (como hoy).
    expect(line_tax_rows).toHaveLength(0);
    expect(data.invoice_taxes.create).toHaveLength(1);
    expect(data.invoice_taxes.create[0].taxable_amount.toString()).toBe('50000');
    expect(data.invoice_taxes.create[0].tax_amount.toString()).toBe('9500');
  });

  it('orden anterior a la columna (sin campos shipping_tax_*): factura idéntica a la de hoy', async () => {
    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(15000),
      order_items: [ivaProducto()],
    });
    expect(data.invoice_items.create[1]).toEqual(legacyShippingLine('15000'));
    expect(data.shipping_amount.toString()).toBe('15000');
    expect(line_tax_rows).toHaveLength(0);
    expect((service as any).logger.warn).not.toHaveBeenCalled();
  });

  it('producto IVA 19 % + envío IVA 19 %: split forzado; sin alinear, la cabecera fusiona la base del envío', async () => {
    // Alineado: dos filas ligadas, una por línea.
    const aligned = await createDraft({
      shipping_cost: money(15000),
      ...ivaShippingCopy,
      order_items: [ivaProducto()],
    });
    expect(aligned.data.invoice_taxes).toBeUndefined();
    expect(aligned.line_tax_rows.map((r) => r.invoice_item_id)).toEqual([
      501, 502,
    ]);
    expect(aligned.data.tax_amount.toString()).toBe('11894.96');
    expect(aligned.data.total_amount.toString()).toBe('74500');

    // Respaldo de `persistLineTaxes` (ítems persistidos ≠ líneas calculadas):
    // UNA fila de cabecera IVA 19 % que ya incluye la base y el impuesto del
    // envío, así la cabecera sigue = Σ filas.
    prisma.invoices.create.mockClear();
    prisma.invoice_taxes.createMany.mockClear();
    const fallback = await createDraft(
      {
        shipping_cost: money(15000),
        ...ivaShippingCopy,
        order_items: [ivaProducto()],
      },
      { persisted_items: 1 },
    );
    expect(fallback.line_tax_rows).toHaveLength(1);
    expect(fallback.line_tax_rows[0].invoice_item_id).toBeUndefined();
    expect(fallback.line_tax_rows[0].taxable_amount.toString()).toBe(
      '62605.04',
    );
    expect(fallback.line_tax_rows[0].tax_amount.toString()).toBe('11894.96');
  });

  it.each([
    ['missing_rate', { shipping_tax_rate: null }],
    ['unsupported_tax_type', { shipping_tax_type: 'ica' }],
    ['amount_not_below_cost', { shipping_tax_amount: money('15000') }],
  ])(
    'copia incoherente (%s) ⇒ INVOICING_CALC_006 antes de crear el borrador, sin inventar tarifa',
    async (reason, override) => {
      prisma.orders.findFirst.mockResolvedValue(
        buildOrder({
          shipping_cost: money(15000),
          ...ivaShippingCopy,
          ...override,
          order_items: [ivaProducto()],
        }),
      );
      const error: any = await service
        .createFromOrder(ORDER_ID)
        .then(() => null, (e) => e);
      expect(error?.errorCode).toBe('INVOICING_CALC_006');
      expect(error.getResponse().details).toEqual({
        order_id: 9001,
        detail: `shipping_tax:${reason}`,
      });
      expect(prisma.invoices.create).not.toHaveBeenCalled();
      expect(prisma.invoice_taxes.createMany).not.toHaveBeenCalled();
    },
  );

  it('update() del borrador que reenvía la línea Envío con su fila conserva el impuesto', async () => {
    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(15000),
      ...ivaShippingCopy,
      order_items: [incPlato()],
    });
    const lines = data.invoice_items.create.map((line: any, index: number) => ({
      product_id: line.product_id,
      description: line.description,
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      discount_amount: Number(line.discount_amount),
      tax_amount: Number(line.tax_amount),
      is_inclusive: line.is_inclusive,
      taxes: line_tax_rows
        .filter((row) => row.invoice_item_id === 501 + index)
        .map((row) => ({
          tax_rate_id: row.tax_rate_id,
          tax_name: row.tax_name,
          tax_rate: Number(row.tax_rate),
          tax_type: row.tax_type,
          taxable_amount: Number(row.taxable_amount),
          tax_amount: Number(row.tax_amount),
          is_inclusive: row.is_inclusive,
        })),
    }));
    const calculated = (service as any).recalculateDocument(
      lines,
      lines.map(() => ({})),
      'invoice:update:7001',
    );
    expect(calculated.lines[1].line_extension_amount).toBe('12605.04');
    // HALLAZGO documentado: `update()` re-deriva la cuota de una línea
    // adicional como trunc(12.605,04 × 19 %) = 2.394,95 — 1 ¢ bajo la copia
    // (2.394,96), así que re-guardar a mano el borrador baja el total a
    // 68.999,99. `createFromOrder` no pasa por aquí; con INC 8 % (13.888,89 ×
    // 8 % = 1.111,1112) no hay diferencia.
    expect(calculated.lines[1].tax_amount).toBe('2394.95');
    expect(calculated.totals.total_amount).toBe('68999.99');
    expect(calculated.totals.total_before_tax).toBe('62605.04');
  });
});

describe('resolveInvoiceShippingTax (puro)', () => {
  it('base = shipping_cost − shipping_tax_amount EXACTO, sin re-despejar', () => {
    const result = resolveInvoiceShippingTax({
      shipping_cost: '15000.00',
      shipping_tax_rate_id: 68,
      shipping_tax_name: 'INC',
      shipping_tax_type: 'inc',
      shipping_tax_rate: '0.08000',
      shipping_tax_amount: '1111.11',
    });
    expect(result.applies).toBe(true);
    if (!result.applies) return;
    expect(result.base.toString()).toBe('13888.89');
    expect(result.tax_row).toMatchObject({
      tax_rate_id: 68,
      tax_rate: 8,
      tax_type: 'inc',
      taxable_amount: 13888.89,
      tax_amount: 1111.11,
      is_inclusive: false,
    });
  });

  it('sin tipo ⇒ iva (misma lectura que contabilidad); tipo ajeno ⇒ no aplica', () => {
    const untyped = resolveInvoiceShippingTax({
      shipping_cost: 15000,
      shipping_tax_type: null,
      shipping_tax_rate: 0.19,
      shipping_tax_amount: 2394.96,
    });
    expect(untyped.applies && untyped.tax_row.tax_type).toBe('iva');
    expect(untyped.applies && untyped.tax_row.tax_name).toBe('IVA');

    expect(
      resolveInvoiceShippingTax({
        shipping_cost: 15000,
        shipping_tax_type: 'ica',
        shipping_tax_rate: 0.007,
        shipping_tax_amount: 100,
      }),
    ).toEqual({ applies: false, reason: 'unsupported_tax_type' });
  });

  it('impuesto ≥ costo ⇒ no aplica; impuesto 0 ⇒ none', () => {
    expect(
      resolveInvoiceShippingTax({
        shipping_cost: 1000,
        shipping_tax_type: 'iva',
        shipping_tax_rate: 0.19,
        shipping_tax_amount: 1000,
      }),
    ).toEqual({ applies: false, reason: 'amount_not_below_cost' });
    expect(
      resolveInvoiceShippingTax({ shipping_cost: 1000, shipping_tax_amount: 0 }),
    ).toEqual({ applies: false, reason: 'none' });
  });
});
