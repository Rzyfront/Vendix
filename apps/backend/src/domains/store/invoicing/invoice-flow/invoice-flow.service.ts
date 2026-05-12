import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { ProviderInvoiceData } from '../providers/invoice-provider.interface';
import { InvoiceProviderResolver } from '../providers/invoice-provider-resolver.service';
import { InvoiceRetryQueueService } from '../services/invoice-retry-queue.service';

type InvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['validated', 'cancelled'],
  validated: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected'],
  accepted: ['voided'],
  rejected: ['sent', 'voided'],
  cancelled: [],
  voided: [],
};

const INVOICE_INCLUDE = {
  invoice_items: true,
  invoice_taxes: true,
  resolution: true,
  customer: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class InvoiceFlowService {
  private readonly logger = new Logger(InvoiceFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly resolver: InvoiceProviderResolver,
    private readonly event_emitter: EventEmitter2,
    private readonly retry_queue: InvoiceRetryQueueService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getInvoice(id: number) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id },
      include: INVOICE_INCLUDE,
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_001);
    }

    return invoice;
  }

  private validateTransition(
    currentStatus: string,
    targetStatus: InvoiceStatus,
  ): void {
    const valid_targets =
      VALID_TRANSITIONS[currentStatus as InvoiceStatus] || [];
    if (!valid_targets.includes(targetStatus)) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_001,
        `Invalid state transition: cannot change from '${currentStatus}' to '${targetStatus}'. ` +
          `Valid transitions from '${currentStatus}': [${valid_targets.join(', ') || 'none (terminal state)'}]`,
      );
    }
  }

  async validate(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'validated');

    // Basic validation checks
    if (!invoice.invoice_items || invoice.invoice_items.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'Invoice must have at least one item',
      );
    }

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: { status: 'validated' },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.validated', {
      invoice_id: id,
      invoice_number: updated.invoice_number,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
      subtotal_amount: Number(updated.subtotal_amount),
      tax_amount: Number(updated.tax_amount),
      total_amount: Number(updated.total_amount),
      user_id: this.getContext().user_id,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) validated`);
    return updated;
  }

  async send(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'sent');

    // Build provider data from invoice
    const provider_data: ProviderInvoiceData = {
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
      issue_date: invoice.issue_date.toISOString().split('T')[0],
      due_date: invoice.due_date
        ? invoice.due_date.toISOString().split('T')[0]
        : undefined,
      customer_name: invoice.customer_name || undefined,
      customer_tax_id: invoice.customer_tax_id || undefined,
      customer_address: invoice.customer_address,
      subtotal_amount: invoice.subtotal_amount.toString(),
      discount_amount: invoice.discount_amount.toString(),
      tax_amount: invoice.tax_amount.toString(),
      withholding_amount: invoice.withholding_amount.toString(),
      total_amount: invoice.total_amount.toString(),
      currency: invoice.currency || undefined,
      items: (invoice.invoice_items || []).map((item: any) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit_price: item.unit_price.toString(),
        discount_amount: item.discount_amount.toString(),
        tax_amount: item.tax_amount.toString(),
        total_amount: item.total_amount.toString(),
      })),
      taxes: (invoice.invoice_taxes || []).map((tax: any) => ({
        tax_name: tax.tax_name,
        tax_rate: tax.tax_rate.toString(),
        taxable_amount: tax.taxable_amount.toString(),
        tax_amount: tax.tax_amount.toString(),
      })),
      resolution_number: invoice.resolution?.resolution_number,
      technical_key: invoice.resolution?.technical_key || undefined,
      notes: invoice.notes || undefined,
    };

    // Resolve the correct provider for this store at runtime
    const provider = await this.resolver.resolve();

    // Send to provider
    let provider_response;
    try {
      if (
        invoice.invoice_type === 'credit_note' ||
        invoice.invoice_type === 'debit_note'
      ) {
        provider_response = await provider.sendCreditNote(provider_data);
      } else {
        provider_response = await provider.sendInvoice(provider_data);
      }
    } catch (error) {
      this.logger.error(
        `Failed to send invoice #${id} to provider: ${error.message}`,
      );

      // Enqueue for retry if it's a transient error (network, timeout, SOAP fault)
      // Don't retry certificate expiry or validation errors
      const is_transient = this.isTransientError(error);
      if (is_transient) {
        this.retry_queue
          .enqueue(id, invoice.organization_id, invoice.store_id, error.message)
          .catch((e) =>
            this.logger.error(
              `Failed to enqueue invoice #${id} for retry: ${e.message}`,
            ),
          );
      }

      throw new VendixHttpException(ErrorCodes.INVOICING_PROVIDER_001);
    }

    // Update invoice with provider response
    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'sent',
        send_status: 'sent_ok',
        sent_at: new Date(),
        cufe: provider_response.cufe,
        qr_code: provider_response.qr_code,
        xml_document: provider_response.xml_document,
        pdf_url: provider_response.pdf_url,
        provider_response: provider_response.provider_data,
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.sent', {
      invoice_id: id,
      invoice_number: updated.invoice_number,
      tracking_id: provider_response.tracking_id,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
      subtotal_amount: Number(updated.subtotal_amount),
      tax_amount: Number(updated.tax_amount),
      total_amount: Number(updated.total_amount),
      user_id: this.getContext().user_id,
    });

    this.logger.log(
      `Invoice #${id} (${updated.invoice_number}) sent to provider`,
    );
    return updated;
  }

  async accept(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'accepted');

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'accepted',
        accepted_at: new Date(),
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.accepted', {
      invoice_id: id,
      invoice_number: updated.invoice_number,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
      subtotal_amount: Number(updated.subtotal_amount),
      tax_amount: Number(updated.tax_amount),
      total_amount: Number(updated.total_amount),
      user_id: this.getContext().user_id,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) accepted`);
    return updated;
  }

  async reject(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'rejected');

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'rejected',
        send_status: 'sent_error',
      },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) rejected`);
    return updated;
  }

  async cancel(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'cancelled');

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: { status: 'cancelled' },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) cancelled`);
    return updated;
  }

  async void(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'voided');

    // If already sent to provider, cancel there too
    if (invoice.status === 'accepted' || invoice.status === 'rejected') {
      try {
        const provider = await this.resolver.resolve();
        await provider.cancelInvoice(invoice.invoice_number, 'Voided by user');
      } catch (error) {
        this.logger.warn(
          `Failed to cancel invoice #${id} at provider: ${error.message}`,
        );
      }
    }

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: { status: 'voided' },
      include: INVOICE_INCLUDE,
    });

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) voided`);
    return updated;
  }

  getValidTransitions(currentStatus: string): InvoiceStatus[] {
    return VALID_TRANSITIONS[currentStatus as InvoiceStatus] || [];
  }

  /**
   * Determines if an error is transient (network, timeout, SOAP fault)
   * and therefore eligible for retry.
   * Non-transient: certificate expiry, validation errors, missing config.
   */
  private isTransientError(error: any): boolean {
    const message = (error.message || '').toLowerCase();

    // Non-retryable patterns
    const non_retryable = [
      'certificado',
      'certificate',
      'expiró',
      'expired',
      'no active dian configuration',
      'store context required',
      'invalid state transition',
      'must have at least one item',
    ];

    if (non_retryable.some((pattern) => message.includes(pattern))) {
      return false;
    }

    // Retryable patterns
    const retryable = [
      'econnrefused',
      'econnreset',
      'etimedout',
      'enotfound',
      'socket hang up',
      'timeout',
      'network',
      'soap',
      '503',
      '502',
      '500',
      'service unavailable',
      'bad gateway',
    ];

    return retryable.some((pattern) => message.includes(pattern));
  }
}
