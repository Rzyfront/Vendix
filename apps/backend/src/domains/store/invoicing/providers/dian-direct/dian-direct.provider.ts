import { Injectable, Logger } from '@nestjs/common';
import * as zlib from 'zlib';
import {
  InvoiceProviderAdapter,
  ProviderInvoiceData,
  ProviderResponse,
  StatusResponse,
} from '../invoice-provider.interface';
import { EncryptionService } from '../../../../../common/services/encryption.service';
import { S3Service } from '../../../../../common/services/s3.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { CufeCalculator } from '../../utils/cufe-calculator';
import { DianSoapClient, WsSecurityCredentials } from './dian-soap.client';
import { DianXmlSignerService } from './dian-xml-signer.service';
import { DianResponseParserService } from './dian-response-parser.service';
import { UblInvoiceBuilder } from './xml/ubl-invoice.builder';
import { UblCreditNoteBuilder } from './xml/ubl-credit-note.builder';
import { UblDebitNoteBuilder } from './xml/ubl-debit-note.builder';
import { UblSupportDocumentBuilder } from './xml/ubl-support-document.builder';
import { UblCommonBuilder } from './xml/ubl-common.builder';
import { DIAN_ID_TYPES } from './constants/dian-document-types';
import {
  DianConfigDecrypted,
  DianIssuerData,
  DianCustomerData,
} from './interfaces/dian-config.interface';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

type DianConfigurationType = 'invoicing' | 'support_document' | 'payroll';

/**
 * DIAN Direct Provider — connects directly to DIAN web services
 * as "software propio" (own software).
 *
 * Flow:
 * 1. Load store's DIAN config (decrypting sensitive fields)
 * 2. Build UBL 2.1 XML
 * 3. Calculate CUFE/CUDE
 * 4. Sign XML with .p12 certificate
 * 5. ZIP + base64 encode
 * 6. Send via SOAP to DIAN
 * 7. Parse response + create audit log
 */
@Injectable()
export class DianDirectProvider implements InvoiceProviderAdapter {
  private readonly logger = new Logger(DianDirectProvider.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly s3_service: S3Service,
    private readonly soap_client: DianSoapClient,
    private readonly xml_signer: DianXmlSignerService,
    private readonly response_parser: DianResponseParserService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  async sendInvoice(
    invoice_data: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig();

    // Validate certificate is not expired before attempting to send
    this.validateCertificateExpiry(config);

    try {
      // Build issuer data from the fiscal accounting entity.
      const issuer = await this.loadIssuerData(config);

      // Build customer data
      const customer = this.buildCustomerData(invoice_data);

      // Generate software security code
      const software_security = {
        software_id: config.software_id,
        software_pin: config.software_pin,
        software_security_code: UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          config.software_pin,
          invoice_data.invoice_number,
        ),
      };

      // Extract IVA and ICA amounts from taxes for CUFE calculation
      const iva_taxes = invoice_data.taxes.filter(
        (t) =>
          t.tax_name.toUpperCase().includes('IVA') ||
          t.tax_name.toUpperCase().includes('VAT'),
      );
      const ica_taxes = invoice_data.taxes.filter((t) =>
        t.tax_name.toUpperCase().includes('ICA'),
      );
      const inc_taxes = invoice_data.taxes.filter(
        (t) =>
          t.tax_name.toUpperCase().includes('INC') ||
          t.tax_name.toUpperCase().includes('CONSUMO'),
      );

      const iva_amount = iva_taxes
        .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
        .toFixed(2);
      const ica_amount = ica_taxes
        .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
        .toFixed(2);
      const inc_amount = inc_taxes
        .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
        .toFixed(2);

      // La clave técnica (ClTec) entregada por la DIAN con la resolución de
      // numeración de habilitación alimenta el CUFE de la factura electrónica de
      // venta. Firmar con el software PIN produce un CUFE inválido que la DIAN
      // rechaza (y transmite un documento mal formado); por eso fallamos rápido y
      // explícito en lugar de caer al PIN.
      //
      // Alcance del assert: este método `sendInvoice` es la ÚNICA ruta que calcula
      // CUFE (factura de venta / exportación). Las notas crédito/débito (CUDE) y el
      // documento soporte / nota de ajuste (CUDS) viven en métodos separados y usan
      // `config.software_pin` por diseño del esquema DIAN (el CUDE/CUDS NO usan la
      // ClTec), por lo que este assert NO aplica a esos flujos y no los rompe.
      const technical_key = invoice_data.technical_key?.trim();
      if (!technical_key) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_PROVIDER_003,
          'La factura electrónica de venta requiere technical_key (ClTec) de la ' +
            'resolución de numeración; no se puede firmar con el software PIN.',
          {
            document_number: invoice_data.invoice_number,
            invoice_type: invoice_data.invoice_type,
          },
        );
      }

      // Calculate CUFE
      const cufe = CufeCalculator.generate({
        invoice_number: invoice_data.invoice_number,
        issue_date: invoice_data.issue_date,
        issue_time: this.issueTime(invoice_data),
        total_before_tax: invoice_data.subtotal_amount,
        tax_iva: iva_amount,
        tax_inc: inc_amount,
        tax_ica: ica_amount,
        total_amount: invoice_data.total_amount,
        issuer_nit: config.nit,
        customer_nit: invoice_data.customer_tax_id || '222222222222',
        technical_key,
        environment: config.environment === 'production' ? '1' : '2',
      });

      // Build UBL XML
      const xml = UblInvoiceBuilder.build({
        invoice_data,
        issuer,
        customer,
        software_security,
        cufe,
        environment: config.environment,
      });

      // Sign XML with certificate
      const signed_xml = await this.signXml(xml, config);

      // ZIP + base64
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        `${invoice_data.invoice_number}.xml`,
      );

      // Load WS-Security credentials for SOAP envelope
      const ws_credentials = await this.loadWsCredentials(config);

      // Send to DIAN
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        `${invoice_data.invoice_number}.zip`,
        config.environment,
        ws_credentials,
      );

      // Parse ApplicationResponse
      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      // Create audit log
      await this.createAuditLog(config.id, {
        action: 'send_invoice',
        document_type: 'invoice',
        document_number: invoice_data.invoice_number,
        request_xml: signed_xml,
        response_xml: dian_response.raw_response,
        status: parsed.is_valid ? 'success' : 'error',
        error_message: parsed.is_valid
          ? null
          : parsed.errors.map((e) => e.message).join('; '),
        cufe,
        duration_ms: Date.now() - start_time,
      });

      // Build QR URL
      const qr_code = CufeCalculator.generateQrUrl(parsed.document_key || cufe);

      return {
        success: parsed.is_valid,
        tracking_id: parsed.document_key || cufe,
        cufe: parsed.document_key || cufe,
        qr_code,
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Documento aceptado por la DIAN'
          : `Documento rechazado: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_status_description: parsed.status_description,
          dian_errors: parsed.errors,
          environment: config.environment,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to send invoice to DIAN: ${error.message}`);

      await this.createAuditLog(config.id, {
        action: 'send_invoice',
        document_type: 'invoice',
        document_number: invoice_data.invoice_number,
        status: 'error',
        error_message: error.message,
        duration_ms: Date.now() - start_time,
      });

      throw error;
    }
  }

  async sendCreditNote(
    credit_note_data: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig();

    // Validate certificate is not expired before attempting to send
    this.validateCertificateExpiry(config);

    try {
      const issuer = await this.loadIssuerData(config);
      const customer = this.buildCustomerData(credit_note_data);

      const software_security = {
        software_id: config.software_id,
        software_pin: config.software_pin,
        software_security_code: UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          config.software_pin,
          credit_note_data.invoice_number,
        ),
      };

      // Extract IVA and ICA amounts from taxes for CUDE calculation
      const cn_iva_taxes = credit_note_data.taxes.filter(
        (t) =>
          t.tax_name.toUpperCase().includes('IVA') ||
          t.tax_name.toUpperCase().includes('VAT'),
      );
      const cn_ica_taxes = credit_note_data.taxes.filter((t) =>
        t.tax_name.toUpperCase().includes('ICA'),
      );
      const cn_inc_taxes = credit_note_data.taxes.filter(
        (t) =>
          t.tax_name.toUpperCase().includes('INC') ||
          t.tax_name.toUpperCase().includes('CONSUMO'),
      );

      const cn_iva_amount = cn_iva_taxes
        .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
        .toFixed(2);
      const cn_ica_amount = cn_ica_taxes
        .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
        .toFixed(2);
      const cn_inc_amount = cn_inc_taxes
        .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
        .toFixed(2);

      // For credit notes, generate CUDE (same algorithm as CUFE)
      const cude = CufeCalculator.generate({
        invoice_number: credit_note_data.invoice_number,
        issue_date: credit_note_data.issue_date,
        issue_time: this.issueTime(credit_note_data),
        total_before_tax: credit_note_data.subtotal_amount,
        tax_iva: cn_iva_amount,
        tax_inc: cn_inc_amount,
        tax_ica: cn_ica_amount,
        total_amount: credit_note_data.total_amount,
        issuer_nit: config.nit,
        customer_nit: credit_note_data.customer_tax_id || '222222222222',
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });

      this.assertOriginalInvoiceReference(credit_note_data, 'credit note');

      const xml = UblCreditNoteBuilder.build({
        credit_note_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        original_invoice_number:
          credit_note_data.original_invoice_number ||
          credit_note_data.order_reference,
        original_invoice_cufe: credit_note_data.original_invoice_cufe,
        original_invoice_date: credit_note_data.original_invoice_issue_date,
      });

      const signed_xml = await this.signXml(xml, config);
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        `${credit_note_data.invoice_number}.xml`,
      );

      // Load WS-Security credentials for SOAP envelope
      const ws_credentials = await this.loadWsCredentials(config);

      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        `${credit_note_data.invoice_number}.zip`,
        config.environment,
        ws_credentials,
      );

      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      await this.createAuditLog(config.id, {
        action: 'send_credit_note',
        document_type: 'credit_note',
        document_number: credit_note_data.invoice_number,
        request_xml: signed_xml,
        response_xml: dian_response.raw_response,
        status: parsed.is_valid ? 'success' : 'error',
        error_message: parsed.is_valid
          ? null
          : parsed.errors.map((e) => e.message).join('; '),
        cufe: cude,
        duration_ms: Date.now() - start_time,
      });

      return {
        success: parsed.is_valid,
        tracking_id: parsed.document_key || cude,
        cude: parsed.document_key || cude,
        qr_code: CufeCalculator.generateQrUrl(parsed.document_key || cude),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Nota crédito aceptada por la DIAN'
          : `Nota crédito rechazada: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_errors: parsed.errors,
          environment: config.environment,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to send credit note to DIAN: ${error.message}`);

      await this.createAuditLog(config.id, {
        action: 'send_credit_note',
        document_type: 'credit_note',
        document_number: credit_note_data.invoice_number,
        status: 'error',
        error_message: error.message,
        duration_ms: Date.now() - start_time,
      });

      throw error;
    }
  }

  async sendDebitNote(
    debit_note_data: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig();
    this.validateCertificateExpiry(config);

    try {
      const issuer = await this.loadIssuerData(config);
      const customer = this.buildCustomerData(debit_note_data);
      const software_security = {
        software_id: config.software_id,
        software_pin: config.software_pin,
        software_security_code: UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          config.software_pin,
          debit_note_data.invoice_number,
        ),
      };

      const iva_taxes = debit_note_data.taxes.filter((t) =>
        t.tax_name.toUpperCase().includes('IVA'),
      );
      const ica_taxes = debit_note_data.taxes.filter((t) =>
        t.tax_name.toUpperCase().includes('ICA'),
      );
      const inc_taxes = debit_note_data.taxes.filter((t) =>
        t.tax_name.toUpperCase().includes('INC'),
      );

      const cude = CufeCalculator.generate({
        invoice_number: debit_note_data.invoice_number,
        issue_date: debit_note_data.issue_date,
        issue_time: this.issueTime(debit_note_data),
        total_before_tax: debit_note_data.subtotal_amount,
        tax_iva: iva_taxes
          .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
          .toFixed(2),
        tax_inc: inc_taxes
          .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
          .toFixed(2),
        tax_ica: ica_taxes
          .reduce((sum, t) => sum + parseFloat(t.tax_amount), 0)
          .toFixed(2),
        total_amount: debit_note_data.total_amount,
        issuer_nit: config.nit,
        customer_nit: debit_note_data.customer_tax_id || '222222222222',
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });

      this.assertOriginalInvoiceReference(debit_note_data, 'debit note');

      const xml = UblDebitNoteBuilder.build({
        debit_note_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        original_invoice_number:
          debit_note_data.original_invoice_number ||
          debit_note_data.order_reference,
        original_invoice_cufe: debit_note_data.original_invoice_cufe,
        original_invoice_date: debit_note_data.original_invoice_issue_date,
      });

      const signed_xml = await this.signXml(xml, config);
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        `${debit_note_data.invoice_number}.xml`,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        `${debit_note_data.invoice_number}.zip`,
        config.environment,
        ws_credentials,
      );
      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      await this.createAuditLog(config.id, {
        action: 'send_debit_note',
        document_type: 'debit_note',
        document_number: debit_note_data.invoice_number,
        request_xml: signed_xml,
        response_xml: dian_response.raw_response,
        status: parsed.is_valid ? 'success' : 'error',
        error_message: parsed.is_valid
          ? null
          : parsed.errors.map((e) => e.message).join('; '),
        cufe: cude,
        duration_ms: Date.now() - start_time,
      });

      return {
        success: parsed.is_valid,
        tracking_id: parsed.document_key || cude,
        cude: parsed.document_key || cude,
        qr_code: CufeCalculator.generateQrUrl(parsed.document_key || cude),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Nota débito aceptada por la DIAN'
          : `Nota débito rechazada: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_errors: parsed.errors,
          environment: config.environment,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to send debit note to DIAN: ${error.message}`);

      await this.createAuditLog(config.id, {
        action: 'send_debit_note',
        document_type: 'debit_note',
        document_number: debit_note_data.invoice_number,
        status: 'error',
        error_message: error.message,
        duration_ms: Date.now() - start_time,
      });

      throw error;
    }
  }

  async sendSupportDocument(
    support_document_data: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig('support_document');
    this.validateCertificateExpiry(config);

    try {
      const buyer = await this.loadIssuerData(config);
      const seller = this.buildCustomerData(support_document_data);
      const software_security = this.buildSoftwareSecurity(
        config,
        support_document_data.invoice_number,
      );
      const taxes = this.calculateTaxAmounts(support_document_data);
      const cuds = CufeCalculator.generate({
        invoice_number: support_document_data.invoice_number,
        issue_date: support_document_data.issue_date,
        issue_time: this.issueTime(support_document_data),
        total_before_tax: support_document_data.subtotal_amount,
        tax_iva: taxes.iva,
        tax_inc: taxes.inc,
        tax_ica: taxes.ica,
        total_amount: support_document_data.total_amount,
        issuer_nit: config.nit,
        customer_nit: support_document_data.customer_tax_id || '222222222222',
        technical_key:
          support_document_data.technical_key || config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });
      const xml = UblSupportDocumentBuilder.buildDocument({
        support_document_data,
        buyer,
        seller,
        software_security,
        cuds,
        environment: config.environment,
      });
      const signed_xml = await this.signXml(xml, config);
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        `${support_document_data.invoice_number}.xml`,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        `${support_document_data.invoice_number}.zip`,
        config.environment,
        ws_credentials,
      );
      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      await this.createAuditLog(config.id, {
        action: 'send_support_document',
        document_type: 'support_document',
        document_number: support_document_data.invoice_number,
        request_xml: signed_xml,
        response_xml: dian_response.raw_response,
        status: parsed.is_valid ? 'success' : 'error',
        error_message: parsed.is_valid
          ? null
          : parsed.errors.map((e) => e.message).join('; '),
        cufe: cuds,
        duration_ms: Date.now() - start_time,
      });

      return {
        success: parsed.is_valid,
        tracking_id: parsed.document_key || cuds,
        cuds: parsed.document_key || cuds,
        qr_code: CufeCalculator.generateQrUrl(parsed.document_key || cuds),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Documento soporte aceptado por la DIAN'
          : `Documento soporte rechazado: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_status_description: parsed.status_description,
          dian_errors: parsed.errors,
          environment: config.environment,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to send support document to DIAN: ${error.message}`,
      );

      await this.createAuditLog(config.id, {
        action: 'send_support_document',
        document_type: 'support_document',
        document_number: support_document_data.invoice_number,
        status: 'error',
        error_message: error.message,
        duration_ms: Date.now() - start_time,
      });

      throw error;
    }
  }

  async sendSupportAdjustmentNote(
    support_adjustment_data: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig('support_document');
    this.validateCertificateExpiry(config);

    try {
      const buyer = await this.loadIssuerData(config);
      const seller = this.buildCustomerData(support_adjustment_data);
      const software_security = this.buildSoftwareSecurity(
        config,
        support_adjustment_data.invoice_number,
      );
      const taxes = this.calculateTaxAmounts(support_adjustment_data);
      const cuds = CufeCalculator.generate({
        invoice_number: support_adjustment_data.invoice_number,
        issue_date: support_adjustment_data.issue_date,
        issue_time: this.issueTime(support_adjustment_data),
        total_before_tax: support_adjustment_data.subtotal_amount,
        tax_iva: taxes.iva,
        tax_inc: taxes.inc,
        tax_ica: taxes.ica,
        total_amount: support_adjustment_data.total_amount,
        issuer_nit: config.nit,
        customer_nit: support_adjustment_data.customer_tax_id || '222222222222',
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });

      this.assertOriginalSupportDocumentReference(support_adjustment_data);

      const xml = UblSupportDocumentBuilder.buildAdjustmentNote({
        support_adjustment_data,
        buyer,
        seller,
        software_security,
        cuds,
        environment: config.environment,
        original_support_document_number:
          support_adjustment_data.original_invoice_number ||
          support_adjustment_data.order_reference,
        original_support_document_cuds:
          support_adjustment_data.original_invoice_cufe,
        original_support_document_date:
          support_adjustment_data.original_invoice_issue_date,
      });
      const signed_xml = await this.signXml(xml, config);
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        `${support_adjustment_data.invoice_number}.xml`,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        `${support_adjustment_data.invoice_number}.zip`,
        config.environment,
        ws_credentials,
      );
      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      await this.createAuditLog(config.id, {
        action: 'send_support_adjustment_note',
        document_type: 'support_adjustment_note',
        document_number: support_adjustment_data.invoice_number,
        request_xml: signed_xml,
        response_xml: dian_response.raw_response,
        status: parsed.is_valid ? 'success' : 'error',
        error_message: parsed.is_valid
          ? null
          : parsed.errors.map((e) => e.message).join('; '),
        cufe: cuds,
        duration_ms: Date.now() - start_time,
      });

      return {
        success: parsed.is_valid,
        tracking_id: parsed.document_key || cuds,
        cuds: parsed.document_key || cuds,
        qr_code: CufeCalculator.generateQrUrl(parsed.document_key || cuds),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Nota de ajuste de documento soporte aceptada por la DIAN'
          : `Nota de ajuste de documento soporte rechazada: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_status_description: parsed.status_description,
          dian_errors: parsed.errors,
          environment: config.environment,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to send support adjustment note to DIAN: ${error.message}`,
      );

      await this.createAuditLog(config.id, {
        action: 'send_support_adjustment_note',
        document_type: 'support_adjustment_note',
        document_number: support_adjustment_data.invoice_number,
        status: 'error',
        error_message: error.message,
        duration_ms: Date.now() - start_time,
      });

      throw error;
    }
  }

  async checkStatus(tracking_id: string): Promise<StatusResponse> {
    const config = await this.loadConfig();

    // Load WS-Security credentials for SOAP envelope
    const ws_credentials = await this.loadWsCredentials(config);

    const dian_response = await this.soap_client.getStatus(
      tracking_id,
      config.environment,
      ws_credentials,
    );

    const parsed = this.response_parser.parseApplicationResponse(
      dian_response.raw_response,
    );

    return {
      tracking_id,
      status: parsed.is_valid ? 'accepted' : 'rejected',
      message: parsed.status_description,
      cufe: parsed.document_key,
      cude: parsed.document_key,
      provider_data: {
        dian_status_code: parsed.status_code,
        dian_errors: parsed.errors,
      },
    };
  }

  async cancelInvoice(
    invoice_id: string,
    reason: string,
  ): Promise<ProviderResponse> {
    // DIAN does not support direct cancellation — only via credit notes
    this.logger.warn(
      `DIAN does not support direct invoice cancellation. Invoice ${invoice_id} should be voided via credit note.`,
    );

    return {
      success: false,
      tracking_id: '',
      message:
        'La DIAN no soporta anulación directa de facturas. Use una nota crédito.',
      provider_data: { reason },
    };
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Validates that the DIAN certificate has not expired.
   * Throws a descriptive error if the certificate is expired.
   */
  private validateCertificateExpiry(config: DianConfigDecrypted): void {
    if (!config.certificate_expiry) return;

    const now = new Date();
    if (config.certificate_expiry < now) {
      const expired_date = config.certificate_expiry
        .toISOString()
        .split('T')[0];
      throw new Error(
        `El certificado digital DIAN (NIT: ${config.nit}) expiró el ${expired_date}. ` +
          `No es posible firmar ni enviar documentos electrónicos. ` +
          `Por favor renueve el certificado en la configuración DIAN.`,
      );
    }
  }

  /**
   * Extracts WS-Security credentials from the store's .p12 certificate.
   * Returns undefined if no certificate is configured (SOAP client falls back to no WS-Security).
   */
  private async loadWsCredentials(
    config: DianConfigDecrypted,
  ): Promise<WsSecurityCredentials | undefined> {
    if (!config.certificate_s3_key || !config.certificate_password) {
      return undefined;
    }
    const p12_buffer = await this.s3_service.downloadImage(
      config.certificate_s3_key,
    );
    const creds = this.xml_signer.extractCredentials(
      p12_buffer,
      config.certificate_password,
    );
    return {
      private_key_pem: creds.private_key_pem,
      certificate_der_base64: creds.certificate_der_base64,
    };
  }

  /**
   * Loads and decrypts the DIAN configuration for the current store.
   */
  private async loadConfig(
    configuration_type: DianConfigurationType = 'invoicing',
  ): Promise<DianConfigDecrypted> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new Error('Organization context required for DIAN operations');
    }
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id,
        store_id: context.store_id ?? null,
      });

    const config = await this.prisma.dian_configurations.findFirst({
      where: {
        accounting_entity_id: accounting_entity.id,
        configuration_type,
        operation_mode: 'own_software',
        enablement_status: { in: ['testing', 'test_set_passed', 'enabled'] },
        ...(process.env.NODE_ENV === 'production' && {
          environment: 'production',
        }),
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });

    if (!config) {
      throw new Error(
        `No active DIAN ${configuration_type} configuration for fiscal entity ${accounting_entity.id}`,
      );
    }

    return {
      id: config.id,
      organization_id: config.organization_id,
      store_id: config.store_id,
      accounting_entity_id: config.accounting_entity_id,
      nit: config.nit,
      nit_dv: config.nit_dv,
      software_id: config.software_id,
      software_pin: this.encryption.decrypt(config.software_pin_encrypted),
      certificate_s3_key: config.certificate_s3_key,
      certificate_password: config.certificate_password_encrypted
        ? this.encryption.decrypt(config.certificate_password_encrypted)
        : null,
      certificate_expiry: config.certificate_expiry,
      environment: config.environment as 'test' | 'production',
      enablement_status: config.enablement_status,
      test_set_id: config.test_set_id,
    };
  }

  private issueTime(document_data: ProviderInvoiceData): string {
    return (
      document_data.issue_time ||
      `${
        new Date(`${document_data.issue_date}T00:00:00.000Z`)
          .toISOString()
          .split('T')[1]
          .split('.')[0]
      }-05:00`
    );
  }

  private buildSoftwareSecurity(
    config: DianConfigDecrypted,
    document_number: string,
  ) {
    return {
      software_id: config.software_id,
      software_pin: config.software_pin,
      software_security_code: UblCommonBuilder.generateSoftwareSecurityCode(
        config.software_id,
        config.software_pin,
        document_number,
      ),
    };
  }

  private calculateTaxAmounts(document_data: ProviderInvoiceData): {
    iva: string;
    ica: string;
    inc: string;
  } {
    const filter = (tokens: string[]) =>
      document_data.taxes.filter((tax) => {
        const name = tax.tax_name.toUpperCase();
        return tokens.some((token) => name.includes(token));
      });
    const total = (taxes: typeof document_data.taxes) =>
      taxes
        .reduce((sum, tax) => sum + parseFloat(tax.tax_amount || '0'), 0)
        .toFixed(2);

    return {
      iva: total(filter(['IVA', 'VAT'])),
      ica: total(filter(['ICA'])),
      inc: total(filter(['INC', 'CONSUMO'])),
    };
  }

  private assertOriginalInvoiceReference(
    document_data: ProviderInvoiceData,
    document_label: string,
  ): void {
    const original_number =
      document_data.original_invoice_number || document_data.order_reference;
    if (!original_number || !document_data.original_invoice_cufe) {
      throw new Error(
        `DIAN ${document_label} requires the accepted original invoice number and CUFE.`,
      );
    }
  }

  private assertOriginalSupportDocumentReference(
    document_data: ProviderInvoiceData,
  ): void {
    const original_number =
      document_data.original_invoice_number || document_data.order_reference;
    if (!original_number || !document_data.original_invoice_cufe) {
      throw new Error(
        'DIAN support adjustment note requires the accepted original support document number and CUDS.',
      );
    }
  }

  /**
   * Maps the store/organization fiscal tax regime to its DIAN code.
   * '48' = responsable de IVA; '49' = no responsable de IVA.
   */
  private static mapTaxRegimeToDianCode(regime?: string): string {
    switch (regime) {
      case 'COMUN':
      case 'GRAN_CONTRIBUYENTE':
        return '48';
      case 'SIMPLIFICADO':
        return '49';
      default:
        return '48';
    }
  }

  /**
   * Loads issuer data from the fiscal accounting entity.
   */
  private async loadIssuerData(
    config: DianConfigDecrypted,
  ): Promise<DianIssuerData> {
    if (!config.accounting_entity_id) {
      throw new Error(
        'DIAN configuration is missing fiscal accounting entity.',
      );
    }

    const entity = await this.prisma
      .withoutScope()
      .accounting_entities.findFirst({
        where: {
          id: config.accounting_entity_id,
          organization_id: config.organization_id,
          is_active: true,
        },
        include: {
          organization: {
            include: {
              addresses: {
                orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                take: 1,
              },
              organization_settings: true,
            },
          },
          store: {
            include: {
              addresses: {
                orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                take: 1,
              },
              store_settings: true,
            },
          },
        },
      });

    if (!entity) {
      throw new Error(
        `Fiscal accounting entity ${config.accounting_entity_id} not found`,
      );
    }

    const organization = entity.organization;
    const store = entity.store;
    const address =
      entity.fiscal_scope === 'STORE'
        ? store?.addresses?.[0]
        : organization.addresses?.[0];

    const settings =
      entity.fiscal_scope === 'STORE'
        ? store?.store_settings?.settings
        : organization?.organization_settings?.settings;
    // Defensive access: settings is a Prisma Json column (untyped at runtime),
    // so we cast to `any` only to read the optional fiscal_data sub-object.
    const fiscalData = (settings as any)?.fiscal_data ?? {};

    if (!address?.municipality_code) {
      throw new Error(
        `Fiscal entity ${entity.id} requires a primary address with DIAN municipality_code.`,
      );
    }

    const legal_name =
      entity.legal_name ||
      (entity.fiscal_scope === 'STORE'
        ? store?.legal_name
        : organization.legal_name) ||
      entity.name;

    return {
      document_type: '31',
      nit: config.nit,
      nit_dv: config.nit_dv || '0',
      legal_name,
      trade_name: entity.name,
      address_line: address.address_line1,
      city_code: address.municipality_code,
      city_name: address.city,
      department_code: address.municipality_code.slice(0, 2),
      department_name:
        address.state_province || address.municipality_code.slice(0, 2),
      country_code: address.country_code,
      postal_code: address.postal_code || undefined,
      phone: address.phone_number || organization.phone || undefined,
      email: organization.email,
      tax_regime: DianDirectProvider.mapTaxRegimeToDianCode(
        fiscalData?.tax_regime,
      ),
      tax_scheme:
        typeof fiscalData?.tax_scheme === 'string' && fiscalData.tax_scheme
          ? fiscalData.tax_scheme
          : 'O-15',
    };
  }

  /**
   * Builds customer data from invoice data.
   */
  private buildCustomerData(
    invoice_data: ProviderInvoiceData,
  ): DianCustomerData {
    const address = this.normalizeAddress(invoice_data.customer_address);
    const document_type = this.normalizeDocumentType(
      invoice_data.customer_document_type,
    );
    return {
      document_type,
      document_number: invoice_data.customer_tax_id || '222222222222',
      legal_name: invoice_data.customer_name || 'Consumidor Final',
      address_line: address?.address_line,
      city_code: address?.city_code,
      city_name: address?.city_name,
      department_code: address?.department_code,
      department_name: address?.department_name,
      country_code: address?.country_code,
      postal_code: address?.postal_code,
      email: invoice_data.customer_email,
      phone: invoice_data.customer_phone,
      tax_regime: this.normalizePartyAccountType(
        invoice_data.customer_regime,
        document_type,
      ),
    };
  }

  private normalizeDocumentType(document_type?: string): string {
    if (!document_type) return '13';
    const normalized = document_type.trim().toUpperCase();
    return DIAN_ID_TYPES[normalized] || normalized;
  }

  private normalizePartyAccountType(
    value: string | undefined,
    document_type: string,
  ): string {
    const normalized = value?.trim().toLowerCase();
    if (normalized === '1' || normalized === '2') return normalized;
    if (
      normalized?.includes('no_responsable') ||
      normalized?.includes('no responsable')
    ) {
      return '2';
    }
    if (
      normalized?.includes('juridica') ||
      normalized?.includes('responsable') ||
      document_type === '31'
    ) {
      return '1';
    }
    return '2';
  }

  private normalizeAddress(address: any):
    | {
        address_line?: string;
        city_code?: string;
        city_name?: string;
        department_code?: string;
        department_name?: string;
        country_code?: string;
        postal_code?: string;
      }
    | undefined {
    if (!address || typeof address !== 'object') return undefined;
    const municipality_code =
      address.municipality_code ||
      address.city_code ||
      address.municipalityCode;
    return {
      address_line:
        address.address_line ||
        address.address_line1 ||
        address.line ||
        address.street,
      city_code: municipality_code,
      city_name: address.city_name || address.city,
      department_code:
        address.department_code ||
        address.state_code ||
        (municipality_code ? String(municipality_code).slice(0, 2) : undefined),
      department_name:
        address.department_name || address.state_province || address.state,
      country_code: address.country_code || 'CO',
      postal_code: address.postal_code,
    };
  }

  /**
   * Signs XML with the store's .p12 certificate.
   * Downloads from S3 if needed.
   */
  private async signXml(
    xml: string,
    config: DianConfigDecrypted,
  ): Promise<string> {
    if (!config.certificate_s3_key || !config.certificate_password) {
      if (config.environment === 'production') {
        throw new Error(
          'A valid certificate is required to sign DIAN production documents.',
        );
      }
      this.logger.warn('No certificate configured — returning unsigned XML');
      return xml;
    }

    const p12_buffer = await this.s3_service.downloadImage(
      config.certificate_s3_key,
    );
    return this.xml_signer.sign(xml, p12_buffer, config.certificate_password);
  }

  /**
   * Compresses XML to ZIP and encodes as base64.
   * Uses native zlib (deflate) — DIAN expects a ZIP file.
   */
  private async compressToZipBase64(
    xml_content: string,
    filename: string,
  ): Promise<string> {
    // Build a minimal ZIP file containing the XML
    const xml_buffer = Buffer.from(xml_content, 'utf-8');
    const compressed = zlib.deflateRawSync(xml_buffer);

    // Build ZIP structure manually (minimal valid ZIP)
    const zip = this.buildMinimalZip(filename, xml_buffer, compressed);

    return zip.toString('base64');
  }

  /**
   * Builds a minimal valid ZIP file with a single entry.
   * This avoids needing a ZIP library dependency.
   */
  private buildMinimalZip(
    filename: string,
    uncompressed: Buffer,
    compressed: Buffer,
  ): Buffer {
    const filename_buffer = Buffer.from(filename, 'utf-8');
    const crc = this.crc32(uncompressed);

    // Local file header
    const local_header = Buffer.alloc(30 + filename_buffer.length);
    local_header.writeUInt32LE(0x04034b50, 0); // signature
    local_header.writeUInt16LE(20, 4); // version needed
    local_header.writeUInt16LE(0, 6); // flags
    local_header.writeUInt16LE(8, 8); // compression: deflate
    local_header.writeUInt16LE(0, 10); // mod time
    local_header.writeUInt16LE(0, 12); // mod date
    local_header.writeUInt32LE(crc, 14); // crc32
    local_header.writeUInt32LE(compressed.length, 18); // compressed size
    local_header.writeUInt32LE(uncompressed.length, 22); // uncompressed size
    local_header.writeUInt16LE(filename_buffer.length, 26); // name length
    local_header.writeUInt16LE(0, 28); // extra length
    filename_buffer.copy(local_header, 30);

    // Central directory
    const central = Buffer.alloc(46 + filename_buffer.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // compression
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16); // crc32
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(filename_buffer.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(0, 42); // offset
    filename_buffer.copy(central, 46);

    const data_offset = local_header.length + compressed.length;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // signature
    eocd.writeUInt16LE(0, 4); // disk
    eocd.writeUInt16LE(0, 6); // disk with central
    eocd.writeUInt16LE(1, 8); // entries on disk
    eocd.writeUInt16LE(1, 10); // total entries
    eocd.writeUInt32LE(central.length, 12); // central size
    eocd.writeUInt32LE(data_offset, 16); // central offset
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([local_header, compressed, central, eocd]);
  }

  /**
   * CRC-32 implementation for ZIP.
   */
  private crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Creates an audit log entry for a DIAN operation.
   */
  private async createAuditLog(
    dian_configuration_id: number,
    data: {
      action: string;
      document_type?: string;
      document_number?: string;
      request_xml?: string;
      response_xml?: string;
      status: string;
      error_message?: string | null;
      cufe?: string;
      duration_ms?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.dian_audit_logs.create({
        data: {
          dian_configuration_id,
          ...data,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create DIAN audit log: ${error.message}`);
    }
  }
}
