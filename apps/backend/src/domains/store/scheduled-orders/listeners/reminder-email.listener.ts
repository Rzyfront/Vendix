import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../../../../email/email.service';
import { ScheduledOrderReminderEvent } from '../jobs/scheduled-order-reminders.job';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Recordatorio al cliente por email (v1; WhatsApp queda para después). */
@Injectable()
export class ScheduledOrderReminderEmailListener {
  private readonly logger = new Logger(ScheduledOrderReminderEmailListener.name);

  constructor(private readonly email: EmailService) {}

  @OnEvent('scheduled_order.reminder', { async: true })
  async handle(event: ScheduledOrderReminderEvent) {
    if (event.channel !== 'customer' || !event.customer_email) return;
    const store = escapeHtml(event.store_name || 'la tienda');
    const action = event.fulfillment_type === 'delivery' ? 'la entrega de tu pedido' : 'la recogida de tu pedido';
    const when = `${event.local_date}, entre ${event.local_start} y ${event.local_end}`;
    const subject = `Recordatorio: tu pedido ${event.order_number} en ${event.store_name || 'la tienda'}`;
    const greeting = event.customer_name ? `Hola ${escapeHtml(event.customer_name)},` : 'Hola,';
    const html = `<p>${greeting}</p><p>Te recordamos ${action} <strong>${escapeHtml(event.order_number)}</strong> en ${store}: ${escapeHtml(when)}.</p><p>¡Gracias por tu compra!</p>`;
    const text = `${greeting} Te recordamos ${action} ${event.order_number} en ${event.store_name || 'la tienda'}: ${when}.`;
    try {
      await this.email.sendEmail(event.customer_email, subject, html, text);
    } catch (error) {
      this.logger.warn(`No se pudo enviar el recordatorio del pedido ${event.order_number}: ${(error as Error).message}`);
    }
  }
}
