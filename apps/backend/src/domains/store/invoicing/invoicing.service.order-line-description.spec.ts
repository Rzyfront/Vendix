import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import {
  InvoicingService,
  resolveOrderInvoiceLineDescription,
  INVOICE_LINE_DESCRIPTION_MAX_LENGTH,
} from './invoicing.service';
import { UblCommonBuilder } from './providers/dian-direct/xml/ubl-common.builder';
import { UBL_NAMESPACES } from './providers/dian-direct/xml/xml-namespaces';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — NOMBRE-PRIMERO en la línea fiscal.
 *
 * El POS persiste la descripción de marketing del catálogo en
 * `order_items.description`, y `createFromOrder` la leía ANTES que el nombre:
 * la DIAN recibía la descripción como `cac:Item/cbc:Description`. La cadena
 * ahora cae por nombre snapshot → nombre vivo → variante → descripción, y
 * solo la descripción se recorta al techo FAZ02 de 300 caracteres (los
 * nombres son `VARCHAR(255)` y nunca lo alcanzan). Los esperados son
 * LITERALES, nunca otro consumidor del mismo helper.
 */
describe('resolveOrderInvoiceLineDescription — matriz de prioridad', () => {
  it('nombre + descripción ⇒ declara el nombre (el defecto que se cierra)', () => {
    expect(
      resolveOrderInvoiceLineDescription({
        product_name: 'Café Pergamino 500g',
        description: 'Café de origen Huila, notas de panela y cacao, tostión media',
        products: { name: 'Café Pergamino 500g' },
        product_variants: null,
      }),
    ).toBe('Café Pergamino 500g');
  });

  it('sin ningún nombre ⇒ usa la descripción como respaldo', () => {
    expect(
      resolveOrderInvoiceLineDescription({
        product_name: null,
        description: 'Bolsa de café sin nombre en el snapshot',
        products: null,
        product_variants: null,
      }),
    ).toBe('Bolsa de café sin nombre en el snapshot');
  });

  it('nombre snapshot en blanco ⇒ cae al nombre vivo del producto', () => {
    expect(
      resolveOrderInvoiceLineDescription({
        product_name: '   ',
        description: 'Descripción de respaldo',
        products: { name: 'Panela Orgánica x12' },
        product_variants: null,
      }),
    ).toBe('Panela Orgánica x12');
  });

  it('sin snapshot ni vivo ⇒ usa el nombre de la variante', () => {
    expect(
      resolveOrderInvoiceLineDescription({
        product_name: '',
        description: 'Descripción de respaldo',
        products: null,
        product_variants: { name: 'Talla M' },
      }),
    ).toBe('Talla M');
  });

  it('descripción de respaldo >300 ⇒ se recorta a 300 exactos (FAZ02)', () => {
    const long = 'x'.repeat(350);
    const resolved = resolveOrderInvoiceLineDescription({
      product_name: null,
      description: long,
      products: null,
      product_variants: null,
    });
    expect(resolved).toHaveLength(INVOICE_LINE_DESCRIPTION_MAX_LENGTH);
    expect(resolved).toBe('x'.repeat(300));
  });

  it('todo vacío ⇒ cae al literal histórico', () => {
    expect(
      resolveOrderInvoiceLineDescription({
        product_name: '  ',
        description: '',
        products: null,
        product_variants: null,
      }),
    ).toBe('Product');
    expect(resolveOrderInvoiceLineDescription(null)).toBe('Product');
    expect(resolveOrderInvoiceLineDescription(undefined)).toBe('Product');
  });
});

describe('InvoicingService.createFromOrder — la factura persiste y emite el nombre', () => {
  const ORDER_ID = 9001;
  const money = (value: number | string) => new Prisma.Decimal(value);

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
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('línea POS con nombre + descripción de catálogo ⇒ persiste el nombre y el XML lo declara', async () => {
    prisma.orders.findFirst.mockResolvedValue(
      buildOrder({
        order_items: [
          buildOrderItem({
            product_name: 'Café Pergamino 500g',
            description:
              'Café de origen Huila, notas de panela y cacao, tostión media',
            products: { name: 'Café Pergamino 500g' },
            product_variants: null,
            quantity: 1,
            unit_price: money(18500),
            total_price: money(18500),
            tax_rate: money(0),
            tax_amount_item: money(0),
            order_item_taxes: [],
          }),
        ],
      }),
    );
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 501 }]);

    await service.createFromOrder(ORDER_ID);
    const data = prisma.invoices.create.mock.calls[0][0].data;
    const [line] = data.invoice_items.create;
    expect(line.description).toBe('Café Pergamino 500g');

    // El builder real declara ese mismo texto en `cbc:Description`.
    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      UBL_NAMESPACES.INVOICE,
      'Invoice',
      {
        'xmlns:cac': UBL_NAMESPACES.CAC,
        'xmlns:cbc': UBL_NAMESPACES.CBC,
        'xmlns:ext': UBL_NAMESPACES.EXT,
      },
    );
    UblCommonBuilder.buildDocumentLines(
      root,
      [
        {
          description: String(line.description),
          quantity: '1',
          unit_price: '18500.00',
          discount_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '18500.00',
        },
      ],
      [],
      'COP',
      { line_element: 'InvoiceLine', quantity_element: 'InvoicedQuantity' },
    );
    expect(root.end({ prettyPrint: true })).toContain(
      '<cbc:Description>Café Pergamino 500g</cbc:Description>',
    );
  });
});
