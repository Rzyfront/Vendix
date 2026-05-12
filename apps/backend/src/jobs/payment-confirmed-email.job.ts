import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EmailService } from '../email/email.service';
import { EmailTemplates } from '../email/templates/email-templates';

export interface PaymentConfirmedEmailData {
  invoiceId: number;
  paymentId: number;
  storeId: number;
}

/**
 * Async worker that sends the subscription payment confirmation email.
 *
 * Triggered by `payment.confirmed.email` jobs enqueued from
 * SubscriptionStateListener.onPaymentSucceeded.
 */
@Processor('email-notifications')
export class PaymentConfirmedEmailJob extends WorkerHost {
  private readonly logger = new Logger(PaymentConfirmedEmailJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(
    job: Job<PaymentConfirmedEmailData>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { invoiceId, storeId } = job.data;

    this.logger.log(
      `Processing payment confirmation email for invoice ${invoiceId} (job ${job.id})`,
    );

    try {
      const invoice = await this.prisma.subscription_invoices.findUnique({
        where: { id: invoiceId },
        include: {
          store_subscription: {
            include: { plan: true },
          },
        },
      });

      if (!invoice) {
        this.logger.warn(`Invoice ${invoiceId} not found`);
        return { success: false };
      }

      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
        include: { organizations: true },
      });

      if (!store?.organizations?.email) {
        this.logger.warn(`No organization email found for store ${storeId}`);
        return { success: false };
      }

      const template = EmailTemplates.getPaymentConfirmedTemplate({
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total.toFixed(2),
        currency: invoice.currency,
        planName:
          invoice.store_subscription?.plan?.name || 'Suscripción Vendix',
        periodStart: invoice.period_start
          ? new Date(invoice.period_start).toLocaleDateString('es-CO')
          : 'N/A',
        periodEnd: invoice.period_end
          ? new Date(invoice.period_end).toLocaleDateString('es-CO')
          : 'N/A',
        storeName: store.name,
        organizationName: store.organizations.name,
        paymentMethod: 'Wompi',
      });

      const result = await this.emailService.sendEmail(
        store.organizations.email,
        template.subject,
        template.html,
        template.text,
      );

      if (result.success) {
        this.logger.log(
          `Payment confirmation email sent to ${store.organizations.email} for invoice ${invoiceId}`,
        );
      } else {
        this.logger.error(
          `Failed to send payment confirmation email for invoice ${invoiceId}: ${result.error}`,
        );
      }

      return { success: result.success, sentTo: store.organizations.email };
    } catch (error: any) {
      this.logger.error(
        `Payment confirmation email job failed for invoice ${invoiceId}: ${error?.message ?? error}`,
      );
      throw error;
    }
  }
}
