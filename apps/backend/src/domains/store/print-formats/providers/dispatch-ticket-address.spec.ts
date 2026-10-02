import { DispatchTicketDataProvider } from './dispatch-ticket.provider';

describe('DispatchTicketDataProvider address resolution', () => {
  const provider = new DispatchTicketDataProvider({} as any);
  const map = (order: any) =>
    (provider as any).mapOrderToDispatchTicket({
      id: 1,
      order_number: 'O-1',
      order_items: [],
      dispatch_notes: [],
      stores: {},
      ...order,
    });

  it('uses the shipping relation when snapshot is null', () => {
    const r = map({
      users: { id: 1, first_name: 'Ana' },
      addresses_orders_shipping_address_idToaddresses: {
        address_line1: 'Calle 1 #2-3',
        city: 'Bogotá',
      },
      shipping_address_snapshot: null,
    });
    expect(r.customer?.address_line1).toBe('Calle 1 #2-3');
  });

  it('builds customer block from alias + snapshot object', () => {
    const r = map({
      customer_alias: ' Don Pedro ',
      shipping_address_snapshot: {
        address_line1: 'Cra 5 #6-7',
        phone_number: '300',
      },
    });
    expect(r.customer?.name).toBe('Don Pedro');
    expect(r.customer?.address_line1).toBe('Cra 5 #6-7');
    expect(r.customer?.phone).toBe('300');
  });

  it('prints a plain string snapshot as line1', () => {
    const r = map({ shipping_address_snapshot: 'Av 9 #1-1' });
    expect(r.customer?.address_line1).toBe('Av 9 #1-1');
  });

  it('parses JSON string snapshot', () => {
    const r = map({
      shipping_address_snapshot: JSON.stringify({ address_line1: 'X 1' }),
    });
    expect(r.customer?.address_line1).toBe('X 1');
  });

  it('returns undefined customer with no user and no address', () => {
    expect(map({}).customer).toBeUndefined();
  });
});
