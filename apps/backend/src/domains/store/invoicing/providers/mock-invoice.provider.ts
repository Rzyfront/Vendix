import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InvoiceProviderAdapter,
  ProviderInvoiceData,
  ProviderResponse,
  StatusResponse,
} from './invoice-provider.interface';
import { CufeCalculator } from '../utils/cufe-calculator';

/**
 * Mock invoice provider for development and testing.
 * Logs all calls, returns simulated success responses with fake CUFE/QR data.
 */
@Injectable()
export class MockInvoiceProvider implements InvoiceProviderAdapter {
  private readonly logger = new Logger(MockInvoiceProvider.name);

  async sendInvoice(invoiceData: ProviderInvoiceData): Promise<ProviderResponse> {
    this.logger.log(
      `[MOCK] Sending invoice ${invoiceData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();
    const cufe = CufeCalculator.generate({
      invoice_number: invoiceData.invoice_number,
      issue_date: invoiceData.issue_date,
      issue_time: new Date().toISOString().split('T')[1].split('.')[0] + '-05:00',
      total_before_tax: invoiceData.subtotal_amount,
      tax_iva: invoiceData.tax_amount,
      total_amount: invoiceData.total_amount,
      issuer_nit: '000000000',
      customer_nit: invoiceData.customer_tax_id || '000000000',
      technical_key: invoiceData.technical_key || 'mock-technical-key',
      environment: '2',
    });

    const qr_code = CufeCalculator.generateQrUrl(cufe);

    this.logger.log(
      `[MOCK] Invoice ${invoiceData.invoice_number} sent successfully. Tracking: ${tracking_id}`,
    );

    return {
      success: true,
      tracking_id,
      cufe,
      qr_code,
      xml_document: `<mock-xml>${invoiceData.invoice_number}</mock-xml>`,
      pdf_url: `https://mock-provider.example.com/invoices/${tracking_id}.pdf`,
      message: 'Invoice accepted by mock provider',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async sendCreditNote(creditNoteData: ProviderInvoiceData): Promise<ProviderResponse> {
    this.logger.log(
      `[MOCK] Sending credit note ${creditNoteData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();

    return {
      success: true,
      tracking_id,
      cufe: `mock-cufe-cn-${tracking_id.substring(0, 8)}`,
      qr_code: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=mock-cn-${tracking_id.substring(0, 8)}`,
      message: 'Credit note accepted by mock provider',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async checkStatus(trackingId: string): Promise<StatusResponse> {
    this.logger.log(`[MOCK] Checking status for tracking ID: ${trackingId}`);

    return {
      tracking_id: trackingId,
      status: 'accepted',
      message: 'Document accepted by mock provider',
      cufe: `mock-cufe-${trackingId.substring(0, 8)}`,
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async cancelInvoice(invoiceId: string, reason: string): Promise<ProviderResponse> {
    this.logger.log(
      `[MOCK] Cancelling invoice ${invoiceId}. Reason: ${reason}`,
    );

    return {
      success: true,
      tracking_id: randomUUID(),
      message: `Invoice ${invoiceId} cancelled by mock provider. Reason: ${reason}`,
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }
}
