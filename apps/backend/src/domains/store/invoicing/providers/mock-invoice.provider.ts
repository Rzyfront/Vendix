import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InvoiceProviderAdapter,
  ProviderInvoiceData,
  ProviderResponse,
  StatusResponse,
} from './invoice-provider.interface';
import { CufeCalculator } from '../utils/cufe-calculator';
import {
  DEFAULT_STORE_TIMEZONE,
  localTimeString,
} from '../../../../common/utils/store-timezone.util';

/**
 * Mock invoice provider for development and testing.
 * Logs all calls, returns simulated success responses with fake CUFE/QR data.
 */
@Injectable()
export class MockInvoiceProvider implements InvoiceProviderAdapter {
  private readonly logger = new Logger(MockInvoiceProvider.name);

  private assertNonProduction(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Mock invoice provider is disabled in production. Configure DIAN own-software credentials and the customer certificate.',
      );
    }
  }

  /**
   * El mock SIEMPRE emite en habilitación: nunca puede transmitir a producción
   * (`assertNonProduction`), así que un documento suyo no existe en el catálogo
   * productivo. Hasta ahora publicaba URLs de producción escritas a mano, que en
   * dev producían un QR que no resuelve nada.
   */
  private static readonly MOCK_ENVIRONMENT = '2';

  /**
   * Contenido del QR con las once líneas del Anexo Técnico 1.9 §11.7, igual que
   * el proveedor real.
   *
   * NO es un detalle de fidelidad del mock: `invoices.qr_code` es lo que el
   * generador de PDF codifica tal cual. Si aquí se guardara solo la URL, el
   * camino de las once líneas no se ejercitaría nunca en desarrollo y el primer
   * sitio donde se descubriría un fallo sería una factura real.
   */
  private mockQrContent(
    data: ProviderInvoiceData,
    document_key: string,
    issue_time: string,
  ): string {
    return CufeCalculator.buildQrContent({
      invoice_number: data.invoice_number,
      issue_date: data.issue_date,
      issue_time,
      issuer_nit: data.issuer_nit || '000000000',
      customer_nit: data.customer_tax_id || '000000000',
      customer_document_type: data.customer_document_type,
      total_before_tax: data.subtotal_amount,
      tax_iva: data.tax_amount,
      total_amount: data.total_amount,
      document_key,
      environment: MockInvoiceProvider.MOCK_ENVIRONMENT,
    });
  }

  async sendInvoice(
    invoiceData: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
    this.logger.log(
      `[MOCK] Sending invoice ${invoiceData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();
    // La hora se resuelve UNA vez y alimenta hash y QR. Antes se llamaba a
    // `new Date()` por su cuenta ignorando `issue_time`: dos instantes distintos
    // para el mismo documento, que en el proveedor real es rechazo garantizado
    // de la DIAN.
    const issue_time =
      invoiceData.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    const cufe = CufeCalculator.generate({
      invoice_number: invoiceData.invoice_number,
      issue_date: invoiceData.issue_date,
      issue_time,
      total_before_tax: invoiceData.subtotal_amount,
      tax_iva: invoiceData.tax_amount,
      total_amount: invoiceData.total_amount,
      issuer_nit: invoiceData.issuer_nit || '000000000',
      customer_nit: invoiceData.customer_tax_id || '000000000',
      customer_document_type: invoiceData.customer_document_type,
      technical_key: invoiceData.technical_key || 'mock-technical-key',
      environment: MockInvoiceProvider.MOCK_ENVIRONMENT,
    });

    const qr_code = this.mockQrContent(invoiceData, cufe, issue_time);

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

  async sendCreditNote(
    creditNoteData: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
    this.logger.log(
      `[MOCK] Sending credit note ${creditNoteData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();
    const cude = `mock-cude-cn-${tracking_id.substring(0, 8)}`;

    return {
      success: true,
      tracking_id,
      cude,
      // Antes: URL de PRODUCCIÓN escrita a mano, y encima con una clave distinta
      // de la que devolvía el propio método.
      qr_code: CufeCalculator.resolveQrUrl(
        cude,
        MockInvoiceProvider.MOCK_ENVIRONMENT,
      ),
      message: 'Credit note accepted by mock provider',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async sendDebitNote(
    debitNoteData: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
    this.logger.log(
      `[MOCK] Sending debit note ${debitNoteData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();
    const cude = `mock-cude-dn-${tracking_id.substring(0, 8)}`;

    return {
      success: true,
      tracking_id,
      cude,
      qr_code: CufeCalculator.resolveQrUrl(
        cude,
        MockInvoiceProvider.MOCK_ENVIRONMENT,
      ),
      message: 'Debit note accepted by mock provider',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async sendSupportDocument(
    supportDocumentData: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
    this.logger.log(
      `[MOCK] Sending support document ${supportDocumentData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();
    const issue_time =
      supportDocumentData.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    const cuds = CufeCalculator.generate({
      invoice_number: supportDocumentData.invoice_number,
      issue_date: supportDocumentData.issue_date,
      issue_time,
      total_before_tax: supportDocumentData.subtotal_amount,
      tax_iva: supportDocumentData.tax_amount,
      total_amount: supportDocumentData.total_amount,
      issuer_nit: supportDocumentData.issuer_nit || '000000000',
      customer_nit: supportDocumentData.customer_tax_id || '000000000',
      customer_document_type: supportDocumentData.customer_document_type,
      technical_key: supportDocumentData.technical_key || 'mock-support-key',
      environment: MockInvoiceProvider.MOCK_ENVIRONMENT,
    });

    return {
      success: true,
      tracking_id,
      cuds,
      qr_code: this.mockQrContent(supportDocumentData, cuds, issue_time),
      xml_document: `<mock-support-document>${supportDocumentData.invoice_number}</mock-support-document>`,
      pdf_url: `https://mock-provider.example.com/support-documents/${tracking_id}.pdf`,
      message: 'Support document accepted by mock provider',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async sendSupportAdjustmentNote(
    supportAdjustmentData: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
    this.logger.log(
      `[MOCK] Sending support adjustment note ${supportAdjustmentData.invoice_number} to provider`,
    );

    const tracking_id = randomUUID();
    const cuds = `mock-cuds-aj-${tracking_id.substring(0, 8)}`;

    return {
      success: true,
      tracking_id,
      cuds,
      // Solo la URL: esta rama no calcula importes, y fabricar las once líneas
      // del §11.7 con ceros inventados sería peor que no tenerlas — el QR
      // declararía cifras que no son las del documento.
      qr_code: CufeCalculator.resolveQrUrl(
        cuds,
        MockInvoiceProvider.MOCK_ENVIRONMENT,
      ),
      message: 'Support adjustment note accepted by mock provider',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  /**
   * The mock stands in for a habilitated DE emitter in dev. It computes a real
   * CUDE shape (Software-PIN in the ClTec position) rather than a random string so
   * a dev flow that later verifies the key against the XML behaves like production.
   */
  async sendEquivalentDocument(
    documentData: ProviderInvoiceData,
    options: { document_type_code?: string } = {},
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
    this.logger.log(
      `[MOCK] Sending POS equivalent document ${documentData.invoice_number}` +
        `${options.document_type_code ? ` (tipo ${options.document_type_code})` : ''}`,
    );

    const tracking_id = randomUUID();
    const issue_time =
      documentData.issue_time ||
      localTimeString(new Date(), DEFAULT_STORE_TIMEZONE);
    const cude = CufeCalculator.generateEquivalentDocumentCude({
      invoice_number: documentData.invoice_number,
      issue_date: documentData.issue_date,
      issue_time,
      total_before_tax: documentData.subtotal_amount,
      tax_iva: documentData.tax_amount,
      total_amount: documentData.total_amount,
      issuer_nit: documentData.issuer_nit || '000000000',
      customer_nit: documentData.customer_tax_id || '222222222222',
      customer_document_type: documentData.customer_document_type,
      environment: MockInvoiceProvider.MOCK_ENVIRONMENT,
      software_pin: 'mock-software-pin',
    });

    return {
      success: true,
      tracking_id,
      cude,
      qr_code: this.mockQrContent(documentData, cude, issue_time),
      xml_document: `<mock-equivalent-document>${documentData.invoice_number}</mock-equivalent-document>`,
      message: 'Documento equivalente aceptado por el proveedor mock',
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async sendEquivalentAdjustmentNote(
    adjustmentData: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    return this.sendEquivalentDocument(adjustmentData, {
      document_type_code:
        adjustmentData.invoice_type === 'debit_note' ? '93' : '94',
    });
  }

  async checkStatus(trackingId: string): Promise<StatusResponse> {
    this.assertNonProduction();
    this.logger.log(`[MOCK] Checking status for tracking ID: ${trackingId}`);

    return {
      tracking_id: trackingId,
      status: 'accepted',
      message: 'Document accepted by mock provider',
      cufe: `mock-cufe-${trackingId.substring(0, 8)}`,
      provider_data: { mock: true, timestamp: new Date().toISOString() },
    };
  }

  async cancelInvoice(
    invoiceId: string,
    reason: string,
  ): Promise<ProviderResponse> {
    this.assertNonProduction();
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
