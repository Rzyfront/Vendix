import { Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import { judgeDraftLineSnapshot } from './invoice-flow/invoice-flow.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — el domicilio de un restaurante responsable de INC
 * (O-33) lleva el INC 8 % INCLUIDO (Oficio DIAN 904106/2022, art. 512-9 E.T.).
 *
 * Ejemplo del plan: plato base 50.000 + INC 4.000 (incluido), domicilio
 * 15.000 ⇒ subtotal 63.888,89 · impuesto 5.111,11 · shipping_amount 13.888,89
 * · total 69.000 — el MISMO total de hoy (50.000 + 4.000 + 15.000).
 *
 * Importes LITERALES calculados a mano.
 */
describe('InvoicingService.createFromOrder — INC del domicilio (restaurante O-33)', () => {
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

  let prisma: PrismaMock;
  let service: InvoicingService;
  let entityFindFirst: jest.Mock;

  beforeEach(() => {
    mockRequestContext({ store_id: 105, organization_id: 1, user_id: 7 });

    prisma = createPrismaMock({
      orders: ['findFirst'],
      invoices: ['findFirst', 'create'],
      invoice_items: ['findMany'],
      invoice_taxes: ['createMany'],
    });
    entityFindFirst = jest.fn();
    prisma.withoutScope = jest.fn(() => ({
      accounting_entities: { findFirst: entityFindFirst },
    }));
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

  const issuer = (tax_responsibilities: string[], fiscal_scope = 'STORE') => {
    const settings = { fiscal_data: { tax_responsibilities } };
    entityFindFirst.mockResolvedValue({
      fiscal_scope,
      store: { store_settings: { settings } },
      organization: { organization_settings: { settings } },
    });
  };

  const createDraft = async (order: Record<string, unknown>) => {
    prisma.orders.findFirst.mockResolvedValue(buildOrder(order));
    const lineCount = (order.order_items as unknown[]).length +
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

  const restaurantIncOrder = {
    shipping_cost: money(15000),
    stores: { industries: ['restaurant'] },
    order_items: [
      buildOrderItem({
        quantity: 1,
        unit_price: money('50000'),
        total_price: money('50000'),
        tax_rate: money('0.08'),
        tax_amount_item: money('4000'),
        order_item_taxes: [incRow()],
      }),
    ],
  };

  it('restaurante O-33: Envío en forma base con su INC ligado; total idéntico', async () => {
    issuer(['O-33', 'R-99-PN']);
    const { data, line_tax_rows } = await createDraft(restaurantIncOrder);

    const [product, shipping] = data.invoice_items.create;
    expect(product.total_amount.toString()).toBe('54000');
    expect(shipping).toMatchObject({ product_id: null, description: 'Envío' });
    expect(shipping.is_inclusive).toBe(false);
    expect(shipping.unit_price.toString()).toBe('13888.89');
    expect(shipping.tax_amount.toString()).toBe('1111.11');
    expect(shipping.total_amount.toString()).toBe('15000');

    expect(data.subtotal_amount.toString()).toBe('63888.89');
    expect(data.tax_amount.toString()).toBe('5111.11');
    expect(data.shipping_amount.toString()).toBe('13888.89');
    expect(data.total_amount.toString()).toBe('69000');

    // Split forzado: ninguna fila de cabecera suelta, todas ligadas.
    expect(data.invoice_taxes).toBeUndefined();
    expect(line_tax_rows).toHaveLength(2);
    const shippingRow = line_tax_rows.find((r) => r.invoice_item_id === 502);
    expect(shippingRow).toMatchObject({
      tax_rate_id: 68,
      tax_type: 'inc',
      is_inclusive: false,
    });
    expect(shippingRow.tax_rate.toString()).toBe('8');
    expect(shippingRow.taxable_amount.toString()).toBe('13888.89');
    expect(shippingRow.tax_amount.toString()).toBe('1111.11');

    // Σ filas = impuesto de cabecera; Σ bases = subtotal (FAU04).
    const sumTax = line_tax_rows.reduce((a, r) => a + Number(r.tax_amount), 0);
    const sumBase = line_tax_rows.reduce(
      (a, r) => a + Number(r.taxable_amount),
      0,
    );
    expect(Math.round(sumTax * 100)).toBe(511111);
    expect(Math.round(sumBase * 100)).toBe(6388889);

    // El gate del borrador no bloquea ninguna línea.
    for (const [index, line] of data.invoice_items.create.entries()) {
      expect(
        judgeDraftLineSnapshot({ ...line, id: 501 + index }, line_tax_rows)
          .kind,
      ).not.toBe('block');
    }
  });

  it('fiscal_scope ORGANIZATION lee la casilla 53 de organization_settings', async () => {
    const orgSettings = { fiscal_data: { tax_responsibilities: ['O-33'] } };
    entityFindFirst.mockResolvedValue({
      fiscal_scope: 'ORGANIZATION',
      store: { store_settings: { settings: { fiscal_data: {} } } },
      organization: { organization_settings: { settings: orgSettings } },
    });
    const { data } = await createDraft(restaurantIncOrder);
    expect(data.shipping_amount.toString()).toBe('13888.89');
  });

  /**
   * Forma legacy de la línea Envío, literal. Si esta forma cambia, una tienda
   * que NO cumple el predicado cambió su factura.
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

  it('tienda IVA (O-48, retail): factura idéntica a la de hoy y sin consulta nueva', async () => {
    issuer(['O-48']);
    const { data, line_tax_rows } = await createDraft({
      shipping_cost: money(15000),
      stores: { industries: ['retail'] },
      order_items: [
        buildOrderItem({
          quantity: 1,
          unit_price: money('50000'),
          total_price: money('50000'),
          tax_rate: money('0.19'),
          tax_amount_item: money('9500'),
          order_item_taxes: [ivaRow()],
        }),
      ],
    });

    expect(entityFindFirst).not.toHaveBeenCalled();
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

  it('restaurante con líneas INC pero emisor sin O-33 ⇒ Envío legacy', async () => {
    issuer(['O-48']);
    const { data, line_tax_rows } = await createDraft(restaurantIncOrder);
    expect(entityFindFirst).toHaveBeenCalledTimes(1);
    const [, shipping] = data.invoice_items.create;
    expect(shipping).toEqual(legacyShippingLine('15000'));
    expect(data.shipping_amount.toString()).toBe('15000');
    expect(data.subtotal_amount.toString()).toBe('65000');
    expect(data.tax_amount.toString()).toBe('4000');
    expect(data.total_amount.toString()).toBe('69000');
    // La línea de producto conserva su split (INC incluido) y el envío no
    // lleva fila.
    expect(line_tax_rows).toHaveLength(1);
    expect(line_tax_rows[0].invoice_item_id).toBe(501);
  });

  it('dos tarifas INC distintas ⇒ Envío legacy y warn', async () => {
    issuer(['O-33']);
    const { data } = await createDraft({
      ...restaurantIncOrder,
      order_items: [
        ...restaurantIncOrder.order_items,
        buildOrderItem({
          id: 2,
          total_price: money('10000'),
          unit_price: money('10000'),
          tax_amount_item: money('400'),
          order_item_taxes: [
            { ...incRow(), tax_rate_id: 70, tax_rate: money('0.04'), tax_amount: money('400') },
          ],
        }),
      ],
    });
    const shipping = data.invoice_items.create[2];
    expect(shipping).toEqual(legacyShippingLine('15000'));
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ambiguous_inc_rate'),
    );
  });

  it('update() del borrador que reenvía la línea Envío con su fila conserva el INC', async () => {
    issuer(['O-33']);
    const { data, line_tax_rows } = await createDraft(restaurantIncOrder);
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
    expect(calculated.lines[1].line_extension_amount).toBe('13888.89');
    expect(calculated.lines[1].tax_amount).toBe('1111.11');
    expect(calculated.lines[1].total_amount).toBe('15000.00');
    expect(calculated.totals.total_before_tax).toBe('63888.89');
    expect(calculated.totals.tax_amount).toBe('5111.11');
    expect(calculated.totals.total_amount).toBe('69000.00');
  });
});
