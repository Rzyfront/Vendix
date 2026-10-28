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
 * `createFromOrder` and the holder rule: the acquirer comes from the shared
 * `buildDeclaredAcquirer`, and `force_final_consumer` (bulk invoicing opt-in)
 * declares Consumidor final WITHOUT touching the customer link or copying the
 * customer's fiscal snapshot.
 */
describe('InvoicingService.createFromOrder — titular y force_final_consumer', () => {
  const ORDER_ID = 9002;
  const money = (value: number | string) => new Prisma.Decimal(value);

  let prisma: PrismaMock;
  let service: InvoicingService;

  beforeEach(() => {
    mockRequestContext({ store_id: 105, organization_id: 1, user_id: 7 });

    prisma = createPrismaMock({
      orders: ['findFirst'],
      users: ['findFirst'],
      invoices: ['findFirst', 'create'],
      invoice_items: ['findMany'],
      invoice_taxes: ['createMany'],
      accounts_receivable: ['findFirst'],
      order_installments: ['findFirst'],
    });
    prisma.accounts_receivable.findFirst.mockResolvedValue(null);
    prisma.order_installments.findFirst.mockResolvedValue(null);
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

  const customer = {
    id: 5,
    first_name: 'Juan',
    last_name: '',
    legal_name: null,
    email: 'juan@x.co',
    phone: '300',
    document_type: 'CC',
    document_number: '1020304050',
    verification_digit: '7',
    tax_regime: null,
    person_type: 'NATURAL',
    fiscal_responsibilities: ['O-13'],
    ciiu_code: null,
    is_withholding_agent: false,
  };

  const draft = async (opts?: { force_final_consumer?: boolean }, users: any = customer) => {
    const items = [
      buildOrderItem({
        quantity: 1,
        unit_price: money('1000'),
        total_price: money('1000'),
        tax_rate: money('0'),
        tax_amount_item: money('0'),
        order_item_taxes: [],
      }),
    ];
    prisma.orders.findFirst.mockResolvedValue(
      buildOrder({ order_items: items, users, customer_id: users ? 5 : null }),
    );
    prisma.invoice_items.findMany.mockResolvedValue([{ id: 501 }]);
    await service.createFromOrder(ORDER_ID, opts);
    return prisma.invoices.create.mock.calls[0][0].data;
  };

  it('sin la opción: cliente incompleto sigue cayendo a Consumidor final con su snapshot (comportamiento previo)', async () => {
    const data = await draft();
    expect(data.customer_tax_id).toBe('222222222222');
    expect(data.customer_id).toBe(5);
    expect(data.customer_verification_digit).toBe('7');
    expect(data.customer_person_type).toBe('NATURAL');
  });

  it('cliente completo: factura nominativa', async () => {
    const data = await draft(undefined, { ...customer, last_name: 'Pérez' });
    expect(data.customer_tax_id).toBe('1020304050');
    expect(data.customer_name).toBe('Juan Pérez');
    expect(data.customer_document_type).toBe('CC');
  });

  it('force_final_consumer: CF aunque el cliente esté completo, sin DV ni responsabilidades, conservando el vínculo', async () => {
    const data = await draft({ force_final_consumer: true }, { ...customer, last_name: 'Pérez' });
    expect(data.customer_tax_id).toBe('222222222222');
    expect(data.customer_name).toBe('Consumidor Final');
    expect(data.customer_document_type).toBe('13');
    expect(data.customer_id).toBe(5);
    expect(data.customer_verification_digit).toBeNull();
    expect(data.customer_fiscal_responsibilities).toBeUndefined();
    expect(data.customer_person_type).toBeUndefined();
  });

  describe('getHolderCheck (GET holder-check)', () => {
    it('cliente completo: nominativo sin issue; consulta acotada a la organización', async () => {
      prisma.users.findFirst.mockResolvedValue({ ...customer, last_name: 'Pérez' });
      const r = await service.getHolderCheck(5);
      expect(prisma.users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5, organization_id: 1 } }),
      );
      expect(r).toMatchObject({
        rail: 'nominative',
        holder: { name: 'Juan Pérez', document_type: 'CC', document_number: '1020304050' },
        holder_issue: null,
        cf_overridable: false,
      });
    });

    it('cliente incompleto: issue, rail CF y sobrescribible', async () => {
      prisma.users.findFirst.mockResolvedValue(customer);
      const r = await service.getHolderCheck(5);
      expect(r.rail).toBe('final_consumer');
      expect(r.holder_issue).toMatchObject({ code: 'missing_name', missing_fields: ['last_name'] });
      expect(r.cf_overridable).toBe(true);
    });

    it('document_type_required: no sobrescribible', async () => {
      prisma.users.findFirst.mockResolvedValue({ ...customer, document_type: null, document_number: '900123456', legal_name: 'ACME SAS', first_name: null, last_name: null });
      const r = await service.getHolderCheck(5);
      expect(r.holder_issue?.code).toBe('document_type_required');
      expect(r.cf_overridable).toBe(false);
    });

    it('cliente inexistente o de otra organización: INVOICING_CALC_004', async () => {
      prisma.users.findFirst.mockResolvedValue(null);
      const err: any = await service.getHolderCheck(99).catch((e) => e);
      expect(err.errorCode).toBe('INVOICING_CALC_004');
    });
  });
});
