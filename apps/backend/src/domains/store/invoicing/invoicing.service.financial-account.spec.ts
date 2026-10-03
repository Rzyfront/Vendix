import { Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';

jest.mock('./utils/split-invoice-projection.util', () => ({
  projectFinancialAccountInvoice: jest.fn(() => ({
    subtotal: 100,
    discount: 0,
    tax: 0,
    total: 100,
    items: [],
  })),
}));

/**
 * Facturas de cuenta (reparto financiero): no son «la factura de la orden» y
 * solo se emiten con la cuenta cobrada completa. Instancia armada por
 * prototipo: el camino solo toca Prisma y los helpers privados que se
 * sustituyen aquí.
 */
describe('InvoicingService · facturas de cuenta', () => {
  const dec = (v: number) => new Prisma.Decimal(v);

  const build = (opts: { paid: number; role?: string; existing?: any }) => {
    const created = { id: 99, invoice_items: [] };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order_financial_accounts: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          state: 'active',
          customer_id: null,
          customer_alias: null,
          split: { state: 'active' },
        }),
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn().mockResolvedValue(created),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 99, invoice_number: null }),
      },
      invoice_taxes: { create: jest.fn() },
    };
    const payments = opts.paid
      ? [{ state: 'succeeded', amount: dec(opts.paid) }]
      : [];
    const prisma: any = {
      order_financial_accounts: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          state: 'active',
          split_id: 1,
          role: opts.role ?? 'new',
          customer_id: null,
          customer_alias: null,
          customer: null,
          grand_total: dec(100),
          shipping_cost: dec(0),
          payments,
          split: {
            state: 'active',
            original_payment_ids: [],
            source_order: { id: 10, order_number: 'O-1', active_financial_split_id: 1, currency: 'COP' },
            accounts: [],
          },
        }),
      },
      payments: { findMany: jest.fn().mockResolvedValue(payments) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = Object.create(InvoicingService.prototype) as any;
    service.prisma = prisma;
    service.event_emitter = { emit: jest.fn() };
    service.getContext = () => ({ store_id: 1, organization_id: 2, user_id: 3 });
    service.assertInvoicingAreaActive = jest.fn().mockResolvedValue(undefined);
    service.resolveAccountingEntityIdForContext = jest.fn().mockResolvedValue(77);
    service.assertCustomerResolvable = jest.fn();
    return { service, tx };
  };

  it('rechaza con SPLIT_ACCOUNT_UNPAID_INVOICE una cuenta no pagada', async () => {
    const { service, tx } = build({ paid: 40 });
    await expect(service.createFromFinancialAccount(5)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'SPLIT_ACCOUNT_UNPAID_INVOICE' }),
    });
    expect(tx.invoices.create).not.toHaveBeenCalled();
  });

  it('también rechaza la cuenta retenida si no está pagada', async () => {
    const { service, tx } = build({ paid: 0, role: 'paid_original' });
    await expect(service.createFromFinancialAccount(5)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'SPLIT_ACCOUNT_UNPAID_INVOICE' }),
    });
    expect(tx.invoices.create).not.toHaveBeenCalled();
  });

  it('crea la factura cuando la cuenta está cobrada completa', async () => {
    const { service, tx } = build({ paid: 100 });
    await service.createFromFinancialAccount(5);
    expect(tx.invoices.create).toHaveBeenCalledTimes(1);
  });

  it('el retorno idempotente de factura existente va antes de la regla de pago', async () => {
    const { service, tx } = build({ paid: 0, existing: { id: 3 } });
    await expect(service.createFromFinancialAccount(5)).resolves.toEqual({ id: 3 });
    expect(tx.invoices.create).not.toHaveBeenCalled();
  });

  it('assertNotAlreadyInvoiced excluye facturas de cuenta (financial_account_id null)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = Object.create(InvoicingService.prototype) as any;
    service.prisma = { invoices: { findFirst } };
    await service.assertNotAlreadyInvoiced({ order_id: 10 });
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      order_id: 10,
      financial_account_id: null,
    });
  });
});
