import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { ProviderResponse } from '../providers/invoice-provider.interface';

type FiscalDocumentType =
  | 'sales_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note';

@Injectable()
export class FiscalTransmissionLedgerService {
  constructor(private readonly prisma: StorePrismaService) {}

  async ensureInvoiceTransmission(params: {
    invoice: any;
    provider_data: unknown;
    dian_configuration_id?: number | null;
    user_id?: number | null;
  }) {
    const document_type = this.invoiceDocumentType(params.invoice.invoice_type);
    const accounting_entity_id = params.invoice.accounting_entity_id;
    if (!accounting_entity_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Invoice has no fiscal accounting entity.',
        { invoice_id: params.invoice.id },
      );
    }

    const idempotency_key = this.invoiceIdempotencyKey(params.invoice);
    const request_hash = this.hash(params.provider_data);
    const client = this.prisma.withoutScope();
    const existing = await client.fiscal_transmissions.findFirst({
      where: {
        accounting_entity_id,
        document_type,
        idempotency_key,
      },
    });

    if (existing) {
      if (existing.request_hash && existing.request_hash !== request_hash) {
        throw new VendixHttpException(
          ErrorCodes.FISCAL_IDEMPOTENCY_CONFLICT,
          'The fiscal retry payload does not match the original transmission.',
          {
            invoice_id: params.invoice.id,
            fiscal_transmission_id: existing.id,
          },
        );
      }

      if (['accepted', 'cancelled'].includes(existing.transmission_status)) {
        throw new VendixHttpException(
          ErrorCodes.FISCAL_IDEMPOTENCY_CONFLICT,
          'The fiscal transmission is already in a terminal state and cannot be resubmitted.',
          {
            invoice_id: params.invoice.id,
            fiscal_transmission_id: existing.id,
            transmission_status: existing.transmission_status,
          },
        );
      }

      return client.fiscal_transmissions.update({
        where: { id: existing.id },
        data: {
          transmission_status:
            existing.transmission_status === 'error' ? 'retrying' : 'queued',
          retry_count:
            existing.transmission_status === 'error'
              ? { increment: 1 }
              : existing.retry_count,
          last_retry_at:
            existing.transmission_status === 'error' ? new Date() : undefined,
          updated_at: new Date(),
        },
      });
    }

    return client.fiscal_transmissions.create({
      data: {
        organization_id: params.invoice.organization_id,
        store_id: params.invoice.store_id,
        accounting_entity_id,
        dian_configuration_id: params.dian_configuration_id ?? null,
        document_type,
        source_type: 'invoice',
        source_id: params.invoice.id,
        document_number: params.invoice.invoice_number,
        idempotency_key,
        request_hash,
        transmission_status: 'queued',
        dian_status: 'pending',
        accounting_status: 'blocked',
        created_by_user_id: params.user_id ?? null,
      },
    });
  }

  async findAcceptedInvoiceTransmission(invoice: any) {
    if (!invoice.accounting_entity_id) return null;
    return this.prisma.withoutScope().fiscal_transmissions.findFirst({
      where: {
        organization_id: invoice.organization_id,
        accounting_entity_id: invoice.accounting_entity_id,
        source_type: 'invoice',
        source_id: invoice.id,
        document_type: this.invoiceDocumentType(invoice.invoice_type),
        transmission_status: 'accepted',
        dian_status: 'accepted',
      },
      orderBy: { accepted_at: 'desc' },
    });
  }

  async markSubmitted(transmission_id: number): Promise<void> {
    const result = await this.prisma.withoutScope().fiscal_transmissions.updateMany({
      where: {
        id: transmission_id,
        transmission_status: { notIn: ['accepted', 'cancelled'] },
      },
      data: {
        transmission_status: 'submitted',
        sent_at: new Date(),
        updated_at: new Date(),
      },
    });

    if (result.count !== 1) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_IDEMPOTENCY_CONFLICT,
        'The fiscal transmission cannot be submitted from its current terminal state.',
        { fiscal_transmission_id: transmission_id },
      );
    }
  }

  async markAccepted(
    transmission_id: number,
    response: ProviderResponse,
  ): Promise<void> {
    const updated = await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmission_id },
      data: {
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        tracking_id: response.tracking_id,
        cufe: response.cufe,
        cude: response.cude,
        cuds: response.cuds,
        cune: response.cune,
        qr_code: response.qr_code,
        xml_document: response.xml_document,
        pdf_url: response.pdf_url,
        xml_hash: response.xml_document
          ? this.hash(response.xml_document)
          : undefined,
        provider_response: this.providerEvidence(response),
        accepted_at: new Date(),
        updated_at: new Date(),
      },
    });
    await this.createEvidence(updated, response);
  }

  async markRejected(
    transmission_id: number,
    response: ProviderResponse,
  ): Promise<void> {
    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmission_id },
      data: {
        transmission_status: 'rejected',
        dian_status: 'rejected',
        accounting_status: 'blocked',
        tracking_id: response.tracking_id,
        cufe: response.cufe,
        cude: response.cude,
        cuds: response.cuds,
        cune: response.cune,
        qr_code: response.qr_code,
        xml_document: response.xml_document,
        pdf_url: response.pdf_url,
        provider_response: this.providerEvidence(response),
        error_message: response.message,
        rejected_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  async markError(
    transmission_id: number,
    error: unknown,
    error_code = 'FISCAL_TRANSMISSION_ERROR',
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.withoutScope().fiscal_transmissions.updateMany({
      where: {
        id: transmission_id,
        transmission_status: { notIn: ['accepted', 'cancelled'] },
      },
      data: {
        transmission_status: 'error',
        dian_status: 'error',
        accounting_status: 'blocked',
        error_code,
        error_message: message,
        updated_at: new Date(),
      },
    });
  }

  private async createEvidence(transmission: any, response: ProviderResponse) {
    const data: any[] = [];
    if (response.xml_document) {
      data.push(this.evidence(transmission, 'xml_signed', response.xml_document));
    }
    if (response.pdf_url) {
      data.push(this.evidence(transmission, 'pdf', response.pdf_url));
    }
    if (response.qr_code) {
      data.push(this.evidence(transmission, 'qr', response.qr_code));
    }
    data.push(this.evidence(transmission, 'dian_response', response));

    await this.prisma.withoutScope().fiscal_evidences.createMany({
      data,
      skipDuplicates: true,
    });
  }

  private evidence(transmission: any, evidence_type: string, value: unknown) {
    return {
      organization_id: transmission.organization_id,
      store_id: transmission.store_id,
      accounting_entity_id: transmission.accounting_entity_id,
      fiscal_transmission_id: transmission.id,
      evidence_type,
      content_hash: this.hash(value),
      metadata: typeof value === 'string' ? { value } : (value as any),
      created_by_user_id: transmission.created_by_user_id,
    };
  }

  private invoiceDocumentType(invoice_type: string): FiscalDocumentType {
    if (invoice_type === 'purchase_invoice') return 'support_document';
    if (invoice_type === 'export_invoice') return 'sales_invoice';
    return invoice_type as FiscalDocumentType;
  }

  private invoiceIdempotencyKey(invoice: any): string {
    return `invoice:${invoice.id}:${invoice.invoice_type}:${invoice.invoice_number}`;
  }

  private providerEvidence(response: ProviderResponse) {
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

  private hash(value: unknown): string {
    const payload =
      typeof value === 'string' ? value : JSON.stringify(value ?? null);
    return createHash('sha256').update(payload).digest('hex');
  }
}
