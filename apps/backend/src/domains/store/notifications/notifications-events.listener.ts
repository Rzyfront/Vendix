import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EmailService } from '../../../email/email.service';
import { S3Service } from '../../../common/services/s3.service';
import { EmailAttachment } from '../../../email/interfaces/email.interface';
import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailText,
  InvoiceEmailData,
} from '../../../email/templates/invoice-email.template';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  PaymentReceivedEvent,
  NewCustomerEvent,
} from './interfaces/notification-events.interface';

@Injectable()
export class NotificationsEventsListener {
  private readonly logger = new Logger(NotificationsEventsListener.name);

  constructor(
    private readonly notifications_service: NotificationsService,
    private readonly global_prisma: GlobalPrismaService,
    private readonly email_service: EmailService,
    private readonly s3_service: S3Service,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent) {
    const customer_text = event.customer_name
      ? ` de ${event.customer_name}`
      : '';

    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_order',
      'Nueva Orden',
      `Orden #${event.order_number}${customer_text} por $${event.grand_total} ${event.currency}`,
      { order_id: event.order_id, order_number: event.order_number },
    );
  }

  @OnEvent('order.status_changed')
  async handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'order_status_change',
      'Estado de Orden Actualizado',
      `Orden #${event.order_number}: ${event.old_state} → ${event.new_state}`,
      { order_id: event.order_id, order_number: event.order_number },
    );
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(event: PaymentReceivedEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'payment_received',
      'Pago Recibido',
      `Pago de $${event.amount} ${event.currency} para orden #${event.order_number}`,
      { order_id: event.order_id, payment_method: event.payment_method },
    );
  }

  @OnEvent('customer.created')
  async handleNewCustomer(event: NewCustomerEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_customer',
      'Nuevo Cliente',
      `${event.first_name} ${event.last_name} se registró`,
      { customer_id: event.customer_id, email: event.email },
    );
  }

  @OnEvent('stock.low')
  async handleLowStock(event: {
    store_id: number;
    product_id: number;
    product_name: string;
    quantity: number;
    threshold: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'low_stock',
      'Stock Bajo',
      `${event.product_name} tiene solo ${event.quantity} unidades (umbral: ${event.threshold})`,
      { product_id: event.product_id, quantity: event.quantity },
    );
  }

  // ===== LAYAWAY EVENTS =====

  @OnEvent('layaway.created')
  async handleLayawayCreated(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    total_amount: number;
  }) {
    const customer = await this.global_prisma.users.findUnique({
      where: { id: event.customer_id },
      select: { first_name: true, last_name: true },
    });
    const customer_name = customer
      ? `${customer.first_name} ${customer.last_name}`
      : 'Cliente';

    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_completed', // reuse type for "created" since there's no specific one — actually use a valid type
      'Nuevo Plan Separé',
      `Plan ${event.plan_number} creado para ${customer_name} por $${event.total_amount}`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  @OnEvent('layaway.payment_received')
  async handleLayawayPaymentReceived(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    payment_id: number;
    amount: number;
    customer_id: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_payment_received',
      'Pago de Plan Separé Recibido',
      `Pago de $${event.amount} recibido para plan ${event.plan_number}`,
      { plan_id: event.plan_id, payment_id: event.payment_id },
    );
  }

  @OnEvent('layaway.completed')
  async handleLayawayCompleted(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    total_amount: any;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_completed',
      'Plan Separé Completado',
      `El plan ${event.plan_number} ha sido completado. Total: $${event.total_amount}`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  @OnEvent('layaway.cancelled')
  async handleLayawayCancelled(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    customer_id: number;
    paid_amount: any;
    cancellation_reason: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_cancelled',
      'Plan Separé Cancelado',
      `El plan ${event.plan_number} ha sido cancelado. Monto pagado: $${event.paid_amount}`,
      { plan_id: event.plan_id, reason: event.cancellation_reason },
    );
  }

  @OnEvent('layaway.overdue')
  async handleLayawayOverdue(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    overdue_count: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_overdue',
      'Cuota de Plan Separé Vencida',
      `El plan ${event.plan_number} tiene ${event.overdue_count} cuota(s) vencida(s)`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  // ===== CREDIT INSTALLMENT EVENTS =====

  @OnEvent('installment_payment.received')
  async handleInstallmentPaymentReceived(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    installment_id: number;
    installment_number: number;
    payment_id: number;
    amount: number;
    customer_id: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'installment_paid',
      'Pago de Cuota Recibido',
      `Pago de $${event.amount} recibido - Cuota #${event.installment_number} - Crédito ${event.credit_number}`,
      { credit_id: event.credit_id, installment_id: event.installment_id, payment_id: event.payment_id },
    );
  }

  @OnEvent('credit.completed')
  async handleCreditCompleted(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    customer_id: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'credit_completed',
      'Crédito Completado',
      `Crédito ${event.credit_number} pagado en su totalidad`,
      { credit_id: event.credit_id, credit_number: event.credit_number },
    );
  }

  @OnEvent('installment.reminder')
  async handleInstallmentReminder(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    installment_id: number;
    installment_number: number;
    customer_id: number;
    amount: number;
    due_date: Date;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'installment_reminder',
      'Recordatorio de Cuota',
      `Cuota #${event.installment_number} vence en 3 días ($${event.amount}) - Crédito ${event.credit_number}`,
      { credit_id: event.credit_id, installment_id: event.installment_id, due_date: event.due_date },
    );
  }

  @OnEvent('installment.overdue')
  async handleInstallmentOverdue(event: {
    store_id: number;
    credit_id: number;
    credit_number: string;
    installment_id: number;
    installment_number: number;
    customer_id: number;
    amount: number;
    due_date: Date;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'installment_overdue',
      'Cuota Vencida',
      `Cuota #${event.installment_number} vencida - Crédito ${event.credit_number} ($${event.amount})`,
      { credit_id: event.credit_id, installment_id: event.installment_id, due_date: event.due_date },
    );
  }

  @OnEvent('layaway.payment_reminder')
  async handleLayawayPaymentReminder(event: {
    store_id: number;
    plan_id: number;
    plan_number: string;
    due_date: string;
    amount: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'layaway_payment_reminder',
      'Recordatorio de Cuota',
      `Cuota de $${event.amount} del plan ${event.plan_number} vence el ${event.due_date}`,
      { plan_id: event.plan_id, plan_number: event.plan_number },
    );
  }

  // ===== INVOICE EMAIL EVENTS =====

  @OnEvent('invoice.pdf.generated')
  async handleInvoicePdfGenerated(payload: {
    invoice_id: number;
    pdf_key: string;
  }) {
    try {
      // 1. Load invoice with customer and organization data
      const invoice = await this.global_prisma.invoices.findUnique({
        where: { id: payload.invoice_id },
        include: {
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              legal_name: true,
              tax_id: true,
              phone: true,
              email: true,
              addresses: { take: 1 },
            },
          },
          invoice_items: true,
        },
      });

      if (!invoice) {
        this.logger.warn(
          `Invoice #${payload.invoice_id} not found for email sending`,
        );
        return;
      }

      // 2. Check if email was already sent
      if (invoice.email_sent_at) {
        this.logger.log(
          `Email already sent for invoice #${invoice.invoice_number}, skipping`,
        );
        return;
      }

      // 3. Determine customer email
      const customer = invoice.customer as any;
      const customer_email = customer?.email;

      if (!customer_email) {
        this.logger.log(
          `No customer email for invoice #${invoice.invoice_number}, skipping email`,
        );
        return;
      }

      // 4. Build organization data
      const org = invoice.organization as any;
      const address = org?.addresses?.[0];
      const store_address = address
        ? [address.address_line1, address.city, address.state_province]
            .filter(Boolean)
            .join(', ')
        : undefined;

      const customer_name =
        invoice.customer_name ||
        (customer
          ? `${customer.first_name} ${customer.last_name}`
          : 'Consumidor Final');

      // 5. Build email data
      const email_data: InvoiceEmailData = {
        invoice_number: invoice.invoice_number,
        invoice_type: invoice.invoice_type,
        customer_name,
        issue_date: this.formatDate(invoice.issue_date),
        due_date: invoice.due_date
          ? this.formatDate(invoice.due_date)
          : undefined,
        items: (invoice.invoice_items || []).map((item: any) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          tax_amount: Number(item.tax_amount),
          total_amount: Number(item.total_amount),
        })),
        subtotal: Number(invoice.subtotal_amount),
        discount: Number(invoice.discount_amount),
        tax: Number(invoice.tax_amount),
        withholding: Number(invoice.withholding_amount),
        total: Number(invoice.total_amount),
        currency: invoice.currency || 'COP',
        cufe: invoice.cufe || undefined,
        notes: invoice.notes || undefined,
        store_name: org?.legal_name || org?.name || 'N/A',
        store_email: org?.email || undefined,
        store_phone: org?.phone || undefined,
        store_address,
        store_nit: org?.tax_id || undefined,
      };

      const html = generateInvoiceEmailHtml(email_data);
      const text = generateInvoiceEmailText(email_data);
      const subject = `${email_data.store_name} - Factura ${invoice.invoice_number}`;

      // 6. Download PDF from S3 for attachment
      const attachments: EmailAttachment[] = [];

      try {
        const pdf_buffer = await this.s3_service.downloadImage(payload.pdf_key);
        attachments.push({
          filename: `Factura-${invoice.invoice_number}.pdf`,
          content: pdf_buffer,
          contentType: 'application/pdf',
        });
      } catch (error) {
        this.logger.error(
          `Failed to download PDF for invoice #${invoice.invoice_number}: ${error.message}`,
        );
        // Continue sending email without PDF attachment
      }

      // 7. Optionally attach XML if available
      if (invoice.xml_document) {
        try {
          const xml_buffer = Buffer.from(invoice.xml_document, 'utf-8');
          attachments.push({
            filename: `Factura-${invoice.invoice_number}.xml`,
            content: xml_buffer,
            contentType: 'application/xml',
          });
        } catch {
          this.logger.warn(
            `Failed to attach XML for invoice #${invoice.invoice_number}`,
          );
        }
      }

      // 8. Send email
      const result = attachments.length > 0
        ? await this.email_service.sendEmailWithAttachments(
            customer_email,
            subject,
            html,
            attachments,
            text,
          )
        : await this.email_service.sendEmail(
            customer_email,
            subject,
            html,
            text,
          );

      if (result.success) {
        // 9. Update invoice: mark email as sent
        await this.global_prisma.invoices.update({
          where: { id: payload.invoice_id },
          data: { email_sent_at: new Date() },
        });

        this.logger.log(
          `Invoice email sent successfully for #${invoice.invoice_number} to ${customer_email}`,
        );
      } else {
        this.logger.error(
          `Failed to send invoice email for #${invoice.invoice_number}: ${result.error}`,
        );
      }
    } catch (error) {
      // Never throw - email failures should not break any flow
      this.logger.error(
        `Error in handleInvoicePdfGenerated for invoice #${payload.invoice_id}: ${error.message}`,
      );
    }
  }

  // ===== BOOKING EVENTS =====

  @OnEvent('booking.created')
  async handleBookingCreated(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
    channel: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_created',
      'Nueva Reserva',
      `Reserva ${event.booking_number} - ${event.service_name} para ${event.customer_name} el ${event.date} a las ${event.start_time} (${event.channel})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.confirmed')
  async handleBookingConfirmed(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_confirmed',
      'Reserva Confirmada',
      `Reserva ${event.booking_number} confirmada - ${event.service_name} para ${event.customer_name} el ${event.date} a las ${event.start_time}`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.cancelled')
  async handleBookingCancelled(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_cancelled',
      'Reserva Cancelada',
      `Reserva ${event.booking_number} cancelada - ${event.service_name} de ${event.customer_name} (${event.date} ${event.start_time})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.no_show')
  async handleBookingNoShow(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_no_show',
      'No Show',
      `${event.customer_name} no asistió a ${event.service_name} - Reserva ${event.booking_number} (${event.date} ${event.start_time})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.reminder')
  async handleBookingReminder(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_reminder',
      'Recordatorio de Reserva',
      `Recordatorio: ${event.customer_name} tiene reserva de ${event.service_name} mañana a las ${event.start_time} (${event.booking_number})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.rescheduled')
  async handleBookingRescheduled(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    new_date: string;
    new_start_time: string;
    new_end_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_rescheduled',
      'Reserva Reprogramada',
      `Reserva ${event.booking_number} reprogramada al ${event.new_date} a las ${event.new_start_time}`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  @OnEvent('booking.completed')
  async handleBookingCompleted(event: {
    store_id: number;
    booking_id: number;
    booking_number: string;
    customer_name: string;
    service_name: string;
    date: string;
    start_time: string;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'booking_completed',
      'Reserva Completada',
      `Reserva ${event.booking_number} completada - ${event.service_name} de ${event.customer_name} (${event.date} ${event.start_time})`,
      { booking_id: event.booking_id, booking_number: event.booking_number },
    );
  }

  // ===== REVIEW EVENTS =====

  @OnEvent('review.created')
  async handleNewReview(event: {
    store_id: number;
    review_id: number;
    product_id: number;
    product_name: string;
    customer_name: string;
    rating: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_review',
      'Nueva Reseña',
      `${event.customer_name} dejó una reseña de ${'★'.repeat(event.rating)}${'☆'.repeat(5 - event.rating)} para ${event.product_name}`,
      { review_id: event.review_id, product_id: event.product_id },
    );
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private formatDate(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
