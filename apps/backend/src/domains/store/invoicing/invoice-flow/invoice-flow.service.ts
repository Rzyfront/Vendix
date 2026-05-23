import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  ProviderInvoiceData,
  ProviderResponse,
} from '../providers/invoice-provider.interface';
import { InvoiceProviderResolver } from '../providers/invoice-provider-resolver.service';
import { InvoiceRetryQueueService } from '../services/invoice-retry-queue.service';
import { FiscalTransmissionLedgerService } from '../services/fiscal-transmission-ledger.service';

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
  related_invoice: {
    select: {
      id: true,
      invoice_number: true,
      invoice_type: true,
      issue_date: true,
      accounting_entity_id: true,
      cufe: true,
      status: true,
    },
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
    private readonly fiscal_ledger: FiscalTransmissionLedgerService,
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

  private toProviderEvidence(response: ProviderResponse): Record<string, any> {
    return {
      success: response.success,
      tracking_id: response.tracking_id,
      cufe: response.cufe ?? null,
      cude: response.cude ?? null,
      cuds: response.cuds ?? null,
      cune: response.cune ?? null,
      qr_code: response.qr_code ?? null,
      xml_document: response.xml_document ?? null,
      pdf_url: response.pdf_url ?? null,
      message: response.message ?? null,
      provider_data: response.provider_data ?? null,
    };
  }

  private fiscalDocumentType(invoice_type: string) {
    if (invoice_type === 'purchase_invoice') return 'support_document';
    if (invoice_type === 'export_invoice') return 'sales_invoice';
    return invoice_type as any;
  }

  private configurationType(invoice_type: string) {
    return invoice_type === 'purchase_invoice' ||
      invoice_type === 'support_document' ||
      invoice_type === 'support_adjustment_note'
      ? 'support_document'
      : 'invoicing';
  }

  private assertSendImplemented(invoice_type: string): void {
    if (
      invoice_type === 'purchase_invoice' ||
      invoice_type === 'support_document' ||
      invoice_type === 'support_adjustment_note'
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_DOCUMENT_UNSUPPORTED,
        'Documento soporte and support adjustment require their own DIAN own-software flow and cannot be sent as invoices.',
        { invoice_type },
      );
    }
  }

  private formatIssueTime(value: Date): string {
    return `${value.toISOString().split('T')[1].split('.')[0]}-05:00`;
  }

  private async resolveTransmissionConfigId(invoice: any): Promise<number | null> {
    if (!invoice.accounting_entity_id) return null;
    const allowed_statuses = ['testing', 'test_set_passed', 'enabled'] as const;
    const config = await this.prisma.withoutScope().dian_configurations.findFirst({
      where: {
        organization_id: invoice.organization_id,
        accounting_entity_id: invoice.accounting_entity_id,
        configuration_type: this.configurationType(invoice.invoice_type),
        operation_mode: 'own_software',
        enablement_status: { in: [...allowed_statuses] },
      },
      select: { id: true },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    return config?.id ?? null;
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

    this.logger.log(`Invoice #${id} (${updated.invoice_number}) validated`);
    return updated;
  }

  async send(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'sent');
    this.assertSendImplemented(invoice.invoice_type);

    // Build provider data from invoice
    const provider_data: ProviderInvoiceData = {
      invoice_number: invoice.invoice_number,
      invoice_type: invoice.invoice_type,
      issue_date: invoice.issue_date.toISOString().split('T')[0],
      issue_time: this.formatIssueTime(invoice.issue_date),
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
      order_reference: invoice.related_invoice?.invoice_number,
      original_invoice_number: invoice.related_invoice?.invoice_number,
      original_invoice_cufe: invoice.related_invoice?.cufe || undefined,
      original_invoice_issue_date: invoice.related_invoice?.issue_date
        ? invoice.related_invoice.issue_date.toISOString().split('T')[0]
        : undefined,
    };

    if (
      (invoice.invoice_type === 'credit_note' ||
        invoice.invoice_type === 'debit_note') &&
      (!invoice.related_invoice ||
        invoice.related_invoice.status !== 'accepted' ||
        invoice.related_invoice.accounting_entity_id !==
          invoice.accounting_entity_id ||
        !invoice.related_invoice.cufe)
    ) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_SCOPE_INVALID,
        'Credit and debit notes require an accepted original invoice with fiscal key in the same accounting entity.',
        {
          invoice_id: id,
          related_invoice_id: invoice.related_invoice?.id,
          accounting_entity_id: invoice.accounting_entity_id,
        },
      );
    }

    // Resolve the correct provider for this store at runtime
    const provider = await this.resolver.resolve();
    const transmission = await this.fiscal_ledger.ensureInvoiceTransmission({
      invoice,
      provider_data,
      dian_configuration_id: await this.resolveTransmissionConfigId(invoice),
      user_id: this.getContext().user_id,
    });

    // Send to provider
    let provider_response: ProviderResponse;
    try {
      await this.fiscal_ledger.markSubmitted(transmission.id);
      if (invoice.invoice_type === 'credit_note') {
        provider_response = await provider.sendCreditNote(provider_data);
      } else if (invoice.invoice_type === 'debit_note') {
        if (!provider.sendDebitNote) {
          throw new Error(
            'Debit note submission is not implemented for the resolved fiscal provider.',
          );
        }
        provider_response = await provider.sendDebitNote(provider_data);
      } else {
        provider_response = await provider.sendInvoice(provider_data);
      }
    } catch (error) {
      this.logger.error(
        `Failed to send invoice #${id} to provider: ${error.message}`,
      );

      if (
        error instanceof VendixHttpException &&
        error.errorCode === ErrorCodes.FISCAL_IDEMPOTENCY_CONFLICT.code
      ) {
        throw error;
      }

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

      await this.fiscal_ledger.markError(transmission.id, error);
      throw new VendixHttpException(ErrorCodes.INVOICING_PROVIDER_001);
    }

    if (!provider_response.success) {
      const rejected_fiscal_key =
        provider_response.cufe ||
        provider_response.cude ||
        provider_response.cuds ||
        provider_response.cune;
      await this.fiscal_ledger.markRejected(transmission.id, provider_response);
      const rejected = await this.prisma.invoices.update({
        where: { id },
        data: {
          status: 'rejected',
          send_status: 'sent_error',
          transmission_status: 'rejected',
          dian_status: 'rejected',
          accounting_status: 'blocked',
          sent_at: new Date(),
          cufe: rejected_fiscal_key,
          qr_code: provider_response.qr_code,
          xml_document: provider_response.xml_document,
          pdf_url: provider_response.pdf_url,
          provider_response: this.toProviderEvidence(provider_response),
        },
        include: INVOICE_INCLUDE,
      });

      this.logger.warn(
        `Invoice #${id} (${rejected.invoice_number}) rejected by provider: ${provider_response.message || 'no provider message'}`,
      );

      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        provider_response.message || 'Invoice provider rejected the document',
        {
          invoice_id: id,
          tracking_id: provider_response.tracking_id,
        },
      );
    }

    const fiscal_key =
      provider_response.cufe ||
      provider_response.cude ||
      provider_response.cuds ||
      provider_response.cune;

    if (!provider_response.tracking_id || !fiscal_key) {
      await this.fiscal_ledger.markError(
        transmission.id,
        new Error('Provider response is missing fiscal acceptance evidence.'),
        'FISCAL_EVIDENCE_MISSING',
      );
      await this.prisma.invoices.update({
        where: { id },
        data: {
          send_status: 'sent_error',
          transmission_status: 'error',
          dian_status: 'error',
          accounting_status: 'blocked',
          provider_response: this.toProviderEvidence(provider_response),
        },
      });

      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'Provider response is missing fiscal acceptance evidence.',
        {
          invoice_id: id,
          tracking_id: provider_response.tracking_id,
        },
      );
    }

    await this.fiscal_ledger.markAccepted(transmission.id, provider_response);

    // Update invoice with provider response
    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'accepted',
        send_status: 'sent_ok',
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        fiscal_document_type: this.fiscalDocumentType(invoice.invoice_type),
        sent_at: new Date(),
        accepted_at: new Date(),
        cufe: fiscal_key,
        qr_code: provider_response.qr_code,
        xml_document: provider_response.xml_document,
        pdf_url: provider_response.pdf_url,
        provider_response: this.toProviderEvidence(provider_response),
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.accepted', {
      invoice_id: id,
      invoice_number: updated.invoice_number,
      tracking_id: provider_response.tracking_id,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
      accounting_entity_id: updated.accounting_entity_id,
      subtotal_amount: Number(updated.subtotal_amount),
      tax_amount: Number(updated.tax_amount),
      total_amount: Number(updated.total_amount),
      user_id: this.getContext().user_id,
    });

    this.logger.log(
      `Invoice #${id} (${updated.invoice_number}) accepted by provider`,
    );
    return updated;
  }

  async accept(id: number) {
    const invoice = await this.getInvoice(id);
    this.validateTransition(invoice.status, 'accepted');

    const accepted_transmission =
      await this.fiscal_ledger.findAcceptedInvoiceTransmission(invoice);
    if (!accepted_transmission) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'Invoice cannot be accepted without accepted DIAN ledger evidence.',
        { invoice_id: id },
      );
    }

    const fiscal_key =
      accepted_transmission.cufe ||
      accepted_transmission.cude ||
      accepted_transmission.cuds ||
      accepted_transmission.cune;
    if (!accepted_transmission.tracking_id || !fiscal_key) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROVIDER_004,
        'Accepted DIAN ledger evidence is missing tracking ID or fiscal key.',
        { invoice_id: id, fiscal_transmission_id: accepted_transmission.id },
      );
    }

    const updated = await this.prisma.invoices.update({
      where: { id },
      data: {
        status: 'accepted',
        send_status: 'sent_ok',
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        accepted_at: new Date(),
        cufe: fiscal_key,
      },
      include: INVOICE_INCLUDE,
    });

    this.event_emitter.emit('invoice.accepted', {
      invoice_id: id,
      invoice_number: updated.invoice_number,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
      accounting_entity_id: updated.accounting_entity_id,
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

    if (invoice.status === 'accepted') {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_STATUS_002,
        'Accepted DIAN documents cannot be voided directly. Use a credit note or adjustment document.',
        { invoice_id: id },
      );
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
