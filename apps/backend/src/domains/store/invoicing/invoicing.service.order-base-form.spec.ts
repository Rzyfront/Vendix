import { Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import {
  InvoiceFlowService,
  judgeDraftLineSnapshot,
} from './invoice-flow/invoice-flow.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { derivePartialNoteLinesViaKernel } from './credit-notes/credit-notes.service';
import { dianLineExtension, dianPriceAmount } from './utils/dian-money.util';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — FORMA BASE (incidente Pollo Arabe, store 105, INC 8 %
 * incluido).
 *
 * Los canales persisten la base YA despejada en `order_items.unit_price`
 * (18500 / 1.08 ⇒ 17129.63 + 1370.37). La factura proyectada copiaba esa base
 * a `invoice_items.unit_price` pero la marcaba `is_inclusive = true`, y el
 * contrato del schema lee ese flag como «impuesto DENTRO de `unit_price`»: el
 * gate del borrador despejaba otra vez (15860.77) y bloqueaba con
 * INVOICING_CALC_005, `update()` y la NC parcial facturaban/acreditaban de
 * menos. La proyección ahora persiste base + `is_inclusive = false` en línea
 * y en tributo, igual que `utils/split-invoice-projection.util.ts`.
 *
 * Los importes esperados son LITERALES calculados a mano, nunca contra otro
 * consumidor del mismo kernel.
 */
describe('InvoicingService.createFromOrder — forma base con impuesto incluido', () => {
  const ORDER_ID = 9001;
  const INC_ID = 7;
  const money = (value: number | string) => new Prisma.Decimal(value);

  /** Fila `order_item_taxes` INC 8 % tal como la persiste el POS. */
  const incRow = (tax_amount: number) => ({
    tax_rate_id: INC_ID,
    tax_name: 'INC 8%',
    tax_rate: money('0.08'),
    tax_amount: money(tax_amount),
    tax_type: 'inc',
    is_inclusive: true,
  });

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
    order_items: unknown[],
    order: Record<string, unknown> = {},
  ) => {
    prisma.orders.findFirst.mockResolvedValue(
      buildOrder({ ...order, order_items }),
    );
    prisma.invoice_items.findMany.mockResolvedValue(
      order_items.map((_, index) => ({ id: 501 + index })),
    );
    await service.createFromOrder(ORDER_ID);
    const data = prisma.invoices.create.mock.calls[0][0].data;
    const line_tax_rows = prisma.invoice_taxes.createMany.mock.calls[0]?.[0]
      ?.data as any[] | undefined;
    return { data, line_tax_rows: line_tax_rows ?? [] };
  };

  it('INC 8 % incluido ⇒ línea y tributo nacen is_inclusive=false con los MISMOS montos', async () => {
    const { data, line_tax_rows } = await createDraft([
      buildOrderItem({
        quantity: 1,
        unit_price: money('17129.63'),
        total_price: money('17129.63'),
        tax_rate: money('0.08'),
        tax_amount_item: money('1370.37'),
        order_item_taxes: [incRow(1370.37)],
      }),
    ]);

    const [line] = data.invoice_items.create;
    expect(line.is_inclusive).toBe(false);
    expect(line.unit_price.toString()).toBe('17129.63');
    expect(line.tax_amount.toString()).toBe('1370.37');
    expect(line.total_amount.toString()).toBe('18500');

    // Cabecera y CUFE (ValFac/ValImp/ValTot) no se mueven.
    expect(data.subtotal_amount.toString()).toBe('17129.63');
    expect(data.tax_amount.toString()).toBe('1370.37');
    expect(data.total_amount.toString()).toBe('18500');

    // El split por línea (incidente #81) se conserva: la inclusividad de
    // ORIGEN lo decide, pero la fila persistida ya es base.
    expect(data.invoice_taxes).toBeUndefined();
    expect(line_tax_rows).toHaveLength(1);
    expect(line_tax_rows[0]).toMatchObject({
      invoice_item_id: 501,
      tax_rate_id: INC_ID,
      tax_type: 'inc',
      is_inclusive: false,
    });
    expect(line_tax_rows[0].tax_rate.toString()).toBe('8');
    expect(line_tax_rows[0].taxable_amount.toString()).toBe('17129.63');
    expect(line_tax_rows[0].tax_amount.toString()).toBe('1370.37');

    // El gate del borrador ya no la juzga como bruto.
    expect(
      judgeDraftLineSnapshot({ ...line, id: 501 }, line_tax_rows).kind,
    ).toBe('skip');
  });

  it('el XML no cambia: importe y precio emitidos iguales a la forma anterior (qty 3 + descuento)', async () => {
    // 3 × 18.500 = 55.500 bruto (3 × 17129.63 + 3 × 1370.37). `order_items`
    // no tiene columna de descuento: el descuento es el de la ORDEN (1.080
    // sobre el bruto), que `projectOrderInvoiceLines` baja a la línea ⇒
    // bruto 54.420 = base 50388.89 + INC 4031.11, descuento de línea 1000.
    const { data, line_tax_rows } = await createDraft(
      [
        buildOrderItem({
          quantity: 3,
          unit_price: money('17129.63'),
          total_price: money('51388.89'),
          tax_rate: money('0.08'),
          tax_amount_item: money('1370.37'),
          order_item_taxes: [incRow(4111.11)],
        }),
      ],
      { discount_amount: money(1080) },
    );
    const [line] = data.invoice_items.create;
    expect(line.discount_amount.toString()).toBe('1000');
    expect(line.tax_amount.toString()).toBe('4031.11');
    expect(line.total_amount.toString()).toBe('54420');
    expect(data.total_amount.toString()).toBe('54420');

    const flow = new InvoiceFlowService(
      ...(Array.from({ length: 11 }, () => ({})) as [any, any, any, any, any, any, any, any, any, any, any]),
    );
    const emitted = (invoice: any) => {
      const overrides: Map<number, any> = (
        flow as any
      ).resolveInclusiveLineOverrides(invoice);
      const item = invoice.invoice_items[0];
      const effective = {
        quantity: item.quantity,
        unit_price: overrides.get(item.id)?.unit_price ?? item.unit_price,
        discount_amount:
          overrides.get(item.id)?.discount_amount ?? item.discount_amount,
      };
      return {
        line_extension: dianLineExtension(effective),
        price_amount: dianPriceAmount(effective),
      };
    };
    const now = emitted({
      invoice_items: [{ ...line, id: 501 }],
      invoice_taxes: line_tax_rows,
    });
    const before = emitted({
      invoice_items: [{ ...line, id: 501, is_inclusive: true }],
      invoice_taxes: line_tax_rows.map((row) => ({ ...row, is_inclusive: true })),
    });
    expect(now).toEqual(before);
    expect(now.line_extension).toBe('50388.89');
  });

  it('update() del borrador sin cambios: el motor conserva base, cuota y total', async () => {
    const { data, line_tax_rows } = await createDraft([
      buildOrderItem({
        quantity: 1,
        unit_price: money('17129.63'),
        total_price: money('17129.63'),
        tax_rate: money('0.08'),
        tax_amount_item: money('1370.37'),
        order_item_taxes: [incRow(1370.37)],
      }),
    ]);
    const [line] = data.invoice_items.create;
    const [row] = line_tax_rows;

    // `update()` recalcula EXCLUSIVAMENTE vía `recalculateDocument` con las
    // líneas del DTO: se le pasa el borrador tal cual (con y sin la base
    // declarada en la fila, que activa la rama de base fija del motor).
    for (const taxable_amount of [Number(row.taxable_amount), 0]) {
      const dto_item = {
        product_id: line.product_id,
        description: line.description,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        discount_amount: Number(line.discount_amount),
        tax_amount: Number(line.tax_amount),
        is_inclusive: line.is_inclusive,
        taxes: [
          {
            tax_rate_id: row.tax_rate_id,
            tax_name: row.tax_name,
            tax_rate: Number(row.tax_rate),
            tax_type: row.tax_type,
            taxable_amount,
            tax_amount: Number(row.tax_amount),
            is_inclusive: row.is_inclusive,
          },
        ],
      };
      const calculated = (service as any).recalculateDocument(
        [dto_item],
        [{}],
        'invoice:update:7001',
      );
      expect(calculated.lines[0].line_extension_amount).toBe('17129.63');
      expect(calculated.lines[0].tax_amount).toBe('1370.37');
      expect(calculated.lines[0].total_amount).toBe('18500.00');
      expect(calculated.totals.total_amount).toBe('18500.00');
    }
  });

  it('NC parcial de 1 unidad sobre la línea de 3: acredita 17129.63 + 1370.37', () => {
    const derived = derivePartialNoteLinesViaKernel(
      [
        {
          product_id: 100,
          product_variant_id: null,
          description: 'Plato',
          quantity: 1,
          unit_price: 17129.63,
          discount_amount: 0,
          tax_amount: 1370.37,
        },
      ],
      [
        {
          product_id: 100,
          product_variant_id: null,
          is_inclusive: false,
          tax_amount: money('4111.11'),
          price_unit_quantity: null,
        },
      ],
      [{ tax_rate_id: INC_ID, tax_name: 'INC 8%', tax_rate: 8, tax_type: 'inc' }],
      7001,
      'credit_note',
    );

    expect(derived.lines[0].is_inclusive).toBe(false);
    expect(derived.lines[0].base_amount.toString()).toBe('17129.63');
    expect(derived.lines[0].tax_amount.toString()).toBe('1370.37');
    expect(derived.lines[0].total_amount.toString()).toBe('18500');
    expect(derived.totals.total.toString()).toBe('18500');
  });
});
