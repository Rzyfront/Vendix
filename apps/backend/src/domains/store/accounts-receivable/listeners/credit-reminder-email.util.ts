import { CreditInstallmentReminderEvent } from '../jobs/credit-installment-reminders.job';

export interface CreditReminderEmail {
  subject: string;
  /** Párrafos en texto plano; el listener los escapa y arma el HTML. */
  lines: string[];
}

/** `$6.666,66` — formato es-CO, sin decimales cuando son cero. */
export function formatReminderMoney(value: number): string {
  return `$${value.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
}

/** `2026-12-03` → `03/12/2026` (fecha civil, sin zona). */
export function formatReminderDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Texto del correo de recordatorio de cuota al cliente (S5): cuota X de Y,
 * fecha de vencimiento, valor de la cuota y saldo pendiente del crédito.
 */
export function buildCreditReminderEmail(event: CreditInstallmentReminderEvent): CreditReminderEmail {
  const store = event.store_name || 'la tienda';
  const due = formatReminderDate(event.due_date);
  const greeting = event.customer_name ? `Hola ${event.customer_name},` : 'Hola,';

  const isToday = event.days_before === 0;
  const when = isToday ? `vence hoy (${due})` : `vence el ${due}`;
  // Una cuota parcial muestra lo que falta de ella, no su valor original.
  const pending = event.installment_balance;

  const subject = isToday
    ? `${store}: tu cuota vence hoy`
    : `${store}: recordatorio de tu cuota del ${due}`;
  const lines = [
    greeting,
    `Te recordamos que la cuota ${event.installment_number} de ${event.installments_total} de tu compra ${event.order_number} ${when}.`,
    `Valor a pagar: ${formatReminderMoney(pending)}.`,
    `Saldo pendiente del crédito: ${formatReminderMoney(event.credit_balance)}.`,
    isToday
      ? `Si ya realizaste el pago, ignora este mensaje. Gracias por tu compra en ${store}.`
      : `Si ya realizaste el pago, ignora este mensaje. Gracias por confiar en ${store}.`,
  ];

  return { subject, lines };
}
