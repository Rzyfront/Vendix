import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../../../../email/email.service';
import { CreditInstallmentReminderEvent } from '../jobs/credit-installment-reminders.job';
import { buildCreditReminderEmail } from './credit-reminder-email.util';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Recordatorio de cuota al cliente por correo (v1; WhatsApp queda para después). */
@Injectable()
export class CreditInstallmentReminderEmailListener {
  private readonly logger = new Logger(CreditInstallmentReminderEmailListener.name);

  constructor(private readonly email: EmailService) {}

  @OnEvent('credit_installment.reminder', { async: true })
  async handle(event: CreditInstallmentReminderEvent) {
    if (event.channel !== 'customer' || !event.customer_email) return;
    const { subject, lines } = buildCreditReminderEmail(event);
    const html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
    const text = lines.join('\n');
    try {
      await this.email.sendEmail(event.customer_email, subject, html, text);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el recordatorio de la cuota ${event.installment_number} de ${event.order_number}: ${(error as Error).message}`,
      );
    }
  }
}
