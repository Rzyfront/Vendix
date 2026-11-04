import { CreditInstallmentReminderEvent } from '../jobs/credit-installment-reminders.job';
import { buildCreditReminderEmail } from './credit-reminder-email.util';

function event(over: Partial<CreditInstallmentReminderEvent> = {}): CreditInstallmentReminderEvent {
  return {
    store_id: 1,
    store_name: 'Nike',
    installment_id: 10,
    installment_number: 2,
    installments_total: 3,
    order_id: 100,
    order_number: 'POS-1',
    channel: 'customer',
    days_before: 3,
    due_date: '2026-12-03',
    amount: 6666.66,
    installment_balance: 4000,
    credit_balance: 20000,
    customer_name: 'Ana Pérez',
    customer_email: 'ana@example.com',
    ...over,
  };
}

describe('buildCreditReminderEmail', () => {
  it('incluye cuota X de Y, fecha, valor pendiente de la cuota y saldo del crédito', () => {
    const { subject, lines } = buildCreditReminderEmail(event());

    expect(subject).toBe('Nike: recordatorio de tu cuota del 03/12/2026');
    expect(lines[0]).toBe('Hola Ana Pérez,');
    const body = lines.join('\n');
    expect(body).toContain('cuota 2 de 3 de tu compra POS-1 vence el 03/12/2026');
    expect(body).toContain('Valor a pagar: $4.000.');
    expect(body).toContain('Saldo pendiente del crédito: $20.000.');
  });

  it('el mismo día dice que vence hoy', () => {
    const { subject, lines } = buildCreditReminderEmail(event({ days_before: 0 }));

    expect(subject).toBe('Nike: tu cuota vence hoy');
    expect(lines.join('\n')).toContain('vence hoy (03/12/2026)');
  });

  it('sin nombre de cliente ni de tienda usa textos neutros', () => {
    const { subject, lines } = buildCreditReminderEmail(
      event({ customer_name: '', store_name: '' }),
    );

    expect(lines[0]).toBe('Hola,');
    expect(subject).toContain('la tienda');
  });
});
