import { Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import {
  createPrismaMock,
  mockRequestContext,
  type PrismaMock,
} from '../../../testing/prisma-mock';
import { buildOrder, buildOrderItem } from '../../../testing/money-fixtures';

/**
 * `createFromOrder` — vencimiento y medio de una factura a crédito.
 * Antes la fila nacía sin `due_date` y el XML llevaba `PaymentDueDate =
 * issue_date` en facturas «a crédito». Contado no cambia.
 */
describe('InvoicingService.createFromOrder — crédito: due_date y medio de pago', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  let prisma: PrismaMock;
  let service: InvoicingService;

  beforeEach(() => {
    mockRequestContext({ store_id: 105, organization_id: 1, user_id: 7 });
    prisma = createPrismaMock({
      orders: ['findFirst'],
      invoices: ['findFirst', 'create'],
      invoice_items: ['findMany'],
      invoice_taxes: ['createMany'],
      accounts_receivable: ['findFirst'],
      order_installments: ['findFirst'],
    });
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.accounts_receivable.findFirst.mockResolvedValue(null);
    prisma.order_installments.findFirst.mockResolvedValue(null);
    prisma.invoices.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 7001,
        invoice_number: null,
      }),
    );
    prisma.invoice_taxes.createMany.mockResolvedValue({ count: 0 });
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 501 }]);

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
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const create = async (
    order: Record<string, unknown>,
    opts?: { due_date?: Date; payment_means_code?: string },
  ) => {
    prisma.orders.findFirst.mockResolvedValue(
      buildOrder({
        order_items: [
          buildOrderItem({
            quantity: 1,
            unit_price: money('17129.63'),
            total_price: money('17129.63'),
            tax_rate: money('0.08'),
            tax_amount_item: money('1370.37'),
            order_item_taxes: [
              {
                tax_rate_id: 7,
                tax_name: 'INC 8%',
                tax_rate: money('0.08'),
                tax_amount: money('1370.37'),
                tax_type: 'inc',
                is_inclusive: true,
              },
            ],
          }),
        ],
        ...order,
      }),
    );
    await service.createFromOrder(9001, opts);
    return prisma.invoices.create.mock.calls[0][0].data;
  };

  // Fechas de calendario relativas a hoy: un plazo fijo se vuelve «vencido» solo.
  const daysFromToday = (days: number) =>
    new Date(`${new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const DUE = daysFromToday(45);

  it('crédito con opts: persiste due_date y el medio declarado, forma 2', async () => {
    const data = await create(
      { payment_form: '2' },
      { due_date: DUE, payment_means_code: '47' },
    );
    expect(data.payment_form).toBe('2');
    expect(data.due_date).toEqual(DUE);
    expect(data.payment_means_code).toBe('47');
  });

  it('crédito sin medio declarado: el medio queda en el resuelto (sin definir)', async () => {
    const data = await create({ payment_form: '2' }, { due_date: DUE });
    expect(data.due_date).toEqual(DUE);
    expect(data.payment_means_code).toBe('1');
  });

  it('crédito sin opts: toma el vencimiento de la cuenta por cobrar de la orden', async () => {
    const ar_due = daysFromToday(30);
    prisma.accounts_receivable.findFirst.mockResolvedValue({ due_date: ar_due });
    const data = await create({ payment_form: '2' });
    expect(data.due_date).toEqual(ar_due);
  });

  it('crédito sin opts ni cartera: cae a la primera cuota', async () => {
    const inst = daysFromToday(20);
    prisma.order_installments.findFirst.mockResolvedValue({ due_date: inst });
    const data = await create({ payment_form: '2' });
    expect(data.due_date).toEqual(inst);
  });

  it('crédito sin opts con cartera ya vencida: no declara un vencimiento anterior a la emisión', async () => {
    prisma.accounts_receivable.findFirst.mockResolvedValue({ due_date: daysFromToday(-10) });
    const data = await create({ payment_form: '2' });
    expect(data).not.toHaveProperty('due_date');
  });

  it('crédito sin ninguna fuente: no escribe due_date', async () => {
    const data = await create({ payment_form: '2' });
    expect(data).not.toHaveProperty('due_date');
  });

  it('contado: los opts no se aplican y no se consulta cartera (comportamiento previo)', async () => {
    const data = await create(
      {
        payment_form: '1',
        payments: [
          {
            state: 'succeeded',
            amount: money(59.5),
            store_payment_method: { system_payment_method: { dian_code: '10' } },
          },
        ],
      },
      { due_date: DUE, payment_means_code: '47' },
    );
    expect(data.payment_form).toBe('1');
    expect(data.payment_means_code).toBe('10');
    expect(data).not.toHaveProperty('due_date');
    expect(prisma.accounts_receivable.findFirst).not.toHaveBeenCalled();
  });
});
