/**
 * Non-fiscal POS sale ticket: a NIT customer keeps its business name only in
 * `users.legal_name` (`JuridicaNameRule`), so the ticket must print it instead
 * of falling back to "Cliente".
 */
import { PosSaleTicketDataProvider } from '../pos-sale-ticket.provider';

function baseOrder(users: any): any {
  return {
    id: 1,
    order_number: 'POS-1',
    status: 'finished',
    discount_amount: 0,
    tax_amount: 0,
    shipping_cost: 0,
    grand_total: 10000,
    subtotal_amount: 10000,
    created_at: new Date('2026-09-24T10:00:00Z'),
    users,
    table_sessions: [],
    order_items: [],
    payments: [],
    stores: {
      id: 1,
      name: 'Tienda Demo',
      addresses: [],
      store_settings: { settings: {} },
      organizations: {
        id: 1,
        fiscal_scope: 'STORE',
        tax_id: '900123456',
        legal_name: 'Org Demo S.A.S.',
        addresses: [],
        organization_settings: { settings: {} },
      },
    },
  };
}

describe('pos-sale-ticket: customer name', () => {
  const provider = new PosSaleTicketDataProvider({} as any);
  const map = (order: any) =>
    (provider as any).mapOrderToStandardModel(order) as any;

  it('prints the legal_name of a NIT customer', () => {
    const out = map(
      baseOrder({
        id: 9,
        first_name: null,
        last_name: null,
        legal_name: 'Distribuciones El Cedro S.A.S.',
        document_number: '900123456',
        addresses: [],
      }),
    );
    expect(out.customer.name).toBe('Distribuciones El Cedro S.A.S.');
    expect(out.customer.tax_id).toBe('900123456');
  });

  it('keeps first + last name for a natural person', () => {
    const out = map(
      baseOrder({
        id: 9,
        first_name: 'Ana',
        last_name: 'Ruiz',
        legal_name: null,
        document_number: '123',
        addresses: [],
      }),
    );
    expect(out.customer.name).toBe('Ana Ruiz');
  });
});
