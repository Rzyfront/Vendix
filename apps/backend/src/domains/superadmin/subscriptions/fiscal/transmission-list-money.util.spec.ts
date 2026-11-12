import { withListMoneyFields } from './transmission-list-money.util';

describe('withListMoneyFields (Facturación > Facturas list)', () => {
  it('platform invoice: takes total, balance and due date from its collection', () => {
    const row = { id: 7, source_type: 'platform_invoice', subscription_invoice: null };
    expect(
      withListMoneyFields(row, {
        total: '260000.00',
        amount_paid: '0.00',
        balance_due: '260000.00',
        due_date: '2026-12-12',
        collection_status: 'pending',
      }),
    ).toEqual({
      ...row,
      total: '260000.00',
      amount_paid: '0.00',
      balance_due: '260000.00',
      due_date: '2026-12-12',
      collection_status: 'pending',
    });
  });

  it('subscription invoice: total, balance (total − paid) and due date from the SaaS invoice', () => {
    const row = {
      id: 8,
      source_type: 'subscription_invoice',
      subscription_invoice: {
        total: '49000',
        amount_paid: '20000',
        due_at: new Date('2026-11-20T05:00:00.000Z'),
      },
    };
    expect(withListMoneyFields(row, undefined)).toEqual({
      ...row,
      total: '49000.00',
      amount_paid: '20000.00',
      balance_due: '29000.00',
      due_date: '2026-11-20',
    });
  });

  it('paid subscription invoice never shows a negative balance', () => {
    const row = {
      id: 9,
      source_type: 'subscription_invoice',
      subscription_invoice: { total: '100', amount_paid: '150', due_at: null },
    };
    expect(withListMoneyFields(row, undefined)).toMatchObject({
      balance_due: '0.00',
      due_date: null,
    });
  });

  it('row without collection nor SaaS invoice is returned unchanged', () => {
    const row = { id: 10, source_type: 'platform_invoice', subscription_invoice: null };
    expect(withListMoneyFields(row, undefined)).toBe(row);
  });
});
