import { formatFiscalMoney } from './fiscal-document-print.mapper';
import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';

/**
 * F-007 — la tirilla POS con snapshot fiscal pinta la misma precisión que el
 * mapeador fiscal (`'$5.000,00'`, 2 decimales pineados).
 *
 * El override fiscal formateaba sin opciones (`$5.000`) mientras `money()`
 * del mapper pinea `minimum/maximumFractionDigits: 2`: mismo modelo, dos
 * precisiones. Ambos usan hoy el helper compartido `formatFiscalMoney`.
 */
describe('pos-sale-ticket — F-007 paridad decimal con el mapper fiscal', () => {
  const orderRow = {
    id: 7,
    order_number: 'POS-0007',
    created_at: new Date('2026-08-27T09:15:00.000Z'),
    state: 'finished',
    subtotal_amount: 4629.62,
    discount_amount: 0,
    tax_amount: 370.36,
    shipping_cost: 0,
    grand_total: 5000,
    order_items: [],
    users: null,
    stores: {
      name: 'Tienda Test',
      organizations: { tax_id: '900.000.000-1' },
      addresses: [],
    },
    table_sessions: [],
  };

  const invoiceRow = {
    id: 3,
    status: 'paid',
    subtotal_amount: 5000,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 5000,
    invoice_taxes: [],
  };

  const makeProvider = (invoice: any) =>
    new PosSaleTicketDataProvider({
      orders: { findFirst: jest.fn().mockResolvedValue(orderRow) },
      invoices: { findFirst: jest.fn().mockResolvedValue(invoice) },
    } as any);

  it('el helper compartido pinea 2 decimales (`$5.000,00`)', () => {
    expect(formatFiscalMoney(5000)).toBe('$5.000,00');
    expect(formatFiscalMoney(0)).toBe('$0,00');
  });

  it('tirilla con factura EMITIDA: pinta igual que el mapper fiscal', async () => {
    const data = await makeProvider(invoiceRow).fetchDocumentData(10, 7);

    expect(data.totals.grand_total).toBe(5000);
    expect(data.totals.grand_total_formatted).toBe('$5.000,00');
    expect(data.totals.subtotal_formatted).toBe(formatFiscalMoney(5000));
    expect(data.totals.tax_total_formatted).toBe(formatFiscalMoney(0));
    expect(data.totals.discount_total_formatted).toBe(formatFiscalMoney(0));
  });

  it('tirilla con factura en BORRADOR: no aplica el override (sigue pre-fiscal)', async () => {
    const data = await makeProvider({ ...invoiceRow, status: 'draft' }).fetchDocumentData(10, 7);

    // Los números siguen siendo los de la orden, no los del borrador.
    expect(data.totals.grand_total).toBe(5000);
    expect(data.totals.subtotal).toBe(4629.62);
  });
});
