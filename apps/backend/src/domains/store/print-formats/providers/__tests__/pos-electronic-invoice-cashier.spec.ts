/**
 * The "Cajero" line of the POS electronic invoice must name the staff user who
 * created the order (`orders.created_by_user_id`), never the order customer
 * (`orders.users` is the customer relation).
 */
import { PosElectronicInvoiceDataProvider } from '../pos-electronic-invoice.provider';

jest.mock('../../services/fiscal-issuer-identity', () => ({
  resolveFiscalIssuerForPrint: () => ({
    legal_name: 'Emisor S.A.S.',
    nit_display: '901.555.333-2',
    fiscal_qualities: '',
    tax_responsibilities: [],
  }),
  resolveFiscalQualitiesLine: () => '',
}));
jest.mock('../../../../../common/utils/store-timezone.util', () => ({
  ...jest.requireActual('../../../../../common/utils/store-timezone.util'),
  resolveStoreTimezone: async () => 'America/Bogota',
}));
jest.mock('../../services/print-vat-breakdown.resolver', () => ({
  resolvePrintsVatBreakdownForPrint: () => false,
}));

const INVOICE: any = {
  id: 7,
  order_id: 19078,
  store_id: 1,
  customer_name: 'Distribuciones El Cedro S.A.S.',
  customer_tax_id: '900123456',
  store: { name: 'T', addresses: [] },
  organization: {},
  customer: { legal_name: 'Distribuciones El Cedro S.A.S.', addresses: [] },
  resolution: {},
  invoice_items: [],
  invoice_taxes: [],
};

function buildProvider(order: any) {
  const prisma: any = {
    invoices: { findFirst: jest.fn().mockResolvedValue(INVOICE) },
    orders: { findFirst: jest.fn().mockResolvedValue(order) },
    order_financial_accounts: { findFirst: jest.fn() },
  };
  const provider = new PosElectronicInvoiceDataProvider(prisma, {} as any);
  return { provider, prisma };
}

describe('PosElectronicInvoiceDataProvider cashier', () => {
  it('prints the order creator as cashier, not the customer', async () => {
    const { provider, prisma } = buildProvider({
      users: { first_name: null, last_name: null },
      users_orders_created_by: { first_name: 'Laura', last_name: 'Gómez' },
      table_sessions: [],
    });

    const out = await provider.fetchDocumentData(1, 7);

    expect(out.document.cashier_name).toBe('Laura Gómez');
    expect(out.customer?.name).toBe('Distribuciones El Cedro S.A.S.');
    const include = prisma.orders.findFirst.mock.calls[0][0].include;
    expect(include.users).toBeUndefined();
    expect(include.users_orders_created_by).toBeDefined();
  });

  it('omits the cashier when the order has no creator', async () => {
    const { provider } = buildProvider({
      users: { first_name: 'Ana', last_name: 'Ruiz' },
      users_orders_created_by: null,
      table_sessions: [],
    });

    const out = await provider.fetchDocumentData(1, 7);

    expect(out.document.cashier_name).toBeUndefined();
  });
});
