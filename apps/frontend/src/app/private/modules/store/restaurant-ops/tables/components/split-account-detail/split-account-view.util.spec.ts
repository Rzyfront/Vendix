import type { SplitFinancialAccount } from '../../interfaces';
import { primaryAction } from './split-account-view.util';

const paidAccount = (over: Partial<SplitFinancialAccount> = {}) =>
  ({
    id: 1,
    role: 'payable',
    payment_state: 'paid',
    reserved_amount: '0',
    available_to_pay: '0',
    invoice_id: null,
    invoice: null,
    payments: [],
    lines: [],
    ...over,
  }) as unknown as SplitFinancialAccount;

describe('primaryAction (cuenta pagada)', () => {
  it('con FE viva y permiso ofrece Facturar', () => {
    expect(
      primaryAction(paidAccount(), {
        canPay: true,
        canInvoice: true,
        electronicInvoicingLive: true,
      })?.kind,
    ).toBe('invoice');
  });

  it('sin FE viva ofrece Imprimir ticket aunque tenga permiso de facturar', () => {
    const action = primaryAction(paidAccount(), {
      canPay: true,
      canInvoice: true,
      electronicInvoicingLive: false,
    });
    expect(action?.kind).toBe('print_ticket');
    expect(action?.label).toBe('Imprimir ticket');
  });

  it('una cuenta ya facturada conserva Ver factura', () => {
    const action = primaryAction(
      paidAccount({ invoice_id: 9, invoice: { invoice_number: 'FV-1' } as never }),
      { canPay: true, canInvoice: true, electronicInvoicingLive: false },
    );
    expect(action?.kind).toBe('view_invoice');
  });
});
