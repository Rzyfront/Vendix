import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';
import { PrintLayoutComposerService } from '../services/print-layout-composer.service';

/**
 * Propina en tirillas: orden sin factura => dentro del TOTAL (fila antes);
 * orden facturada => TOTAL fiscal sin propina + propina + total pagado.
 */
describe('tip-print — propina en la tirilla POS', () => {
  const orderRow = {
    id: 7,
    order_number: 'POS-0007',
    created_at: new Date('2026-08-27T09:15:00.000Z'),
    state: 'finished',
    subtotal_amount: 4629.62,
    discount_amount: 0,
    tax_amount: 370.38,
    shipping_cost: 0,
    tip_amount: 5000,
    grand_total: 10000,
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
  const makeProvider = (invoice: any, order: any = orderRow) =>
    new PosSaleTicketDataProvider({
      orders: { findFirst: jest.fn().mockResolvedValue(order) },
      invoices: { findFirst: jest.fn().mockResolvedValue(invoice) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any);
  const composer = new PrintLayoutComposerService({
    escapeHtml: (v: any) => String(v ?? ''),
  } as any);
  const render = (data: any) =>
    (composer as any).renderTotalsSection({ id: 'sec_totals' }, data, 'dummy');

  it('orden sin factura: propina dentro del TOTAL, fila antes del TOTAL', async () => {
    const data = await makeProvider(null).fetchDocumentData(10, 7);
    expect(data.totals.tip_amount).toBe(5000);
    expect(data.totals.tip_outside_total).toBeUndefined();
    expect(data.totals.grand_total).toBe(10000);
    const html = render(data);
    expect(html).toContain('Propina:');
    expect(html.indexOf('f_tip')).toBeLessThan(html.indexOf('f_tot'));
    expect(html).not.toContain('f_total_paid');
  });

  it('orden facturada: TOTAL fiscal sin propina, propina y total pagado debajo', async () => {
    const data = await makeProvider(invoiceRow).fetchDocumentData(10, 7);
    expect(data.totals.grand_total).toBe(5000);
    expect(data.totals.tip_outside_total).toBe(true);
    expect(data.totals.total_paid).toBe(10000);
    const html = render(data);
    expect(html).toContain('Propina voluntaria:');
    expect(html).toContain('Total pagado:');
    expect(html.indexOf('f_tot"')).toBeLessThan(html.indexOf('f_tip'));
    expect(html.indexOf('f_tip')).toBeLessThan(html.indexOf('f_total_paid'));
  });

  it('sin propina: no hay filas de propina', async () => {
    const data = await makeProvider(null, { ...orderRow, tip_amount: null }).fetchDocumentData(10, 7);
    expect(data.totals.tip_amount).toBeUndefined();
    const html = render(data);
    expect(html).not.toContain('f_tip');
  });
});
