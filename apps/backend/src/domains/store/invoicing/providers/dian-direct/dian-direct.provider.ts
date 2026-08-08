import { Injectable, Logger } from '@nestjs/common';
import * as zlib from 'zlib';
import {
  InvoiceProviderAdapter,
  ProviderInvoiceData,
  ProviderResponse,
  StatusResponse,
} from '../invoice-provider.interface';
import { DianSecretEnvelopeService } from '../../../../../common/services/dian-secret-envelope.service';
import { EncryptionService } from '../../../../../common/services/encryption.service';
import { S3Service } from '../../../../../common/services/s3.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { CufeCalculator } from '../../utils/cufe-calculator';
import {
  buildDianXmlFileName,
  buildDianZipFileName,
  consecutiveFromDocumentNumber,
  softwareCodeForOperationMode,
  DianDocumentKind,
} from '../../utils/dian-file-naming.util';
import {
  dianLineExtensionTotal,
  dianSum,
} from '../../utils/dian-money.util';
import { onlyDigits } from '../../../../../common/utils/nit.util';
import { resolveIssuerFiscalIdentity } from '../../utils/fiscal-issuer.util';
import { DianSoapClient, WsSecurityCredentials } from './dian-soap.client';
import { DianXmlSignerService } from './dian-xml-signer.service';
import { DianResponseParserService } from './dian-response-parser.service';
import { UblInvoiceBuilder } from './xml/ubl-invoice.builder';
import { UblCreditNoteBuilder } from './xml/ubl-credit-note.builder';
import { UblDebitNoteBuilder } from './xml/ubl-debit-note.builder';
import { UblSupportDocumentBuilder } from './xml/ubl-support-document.builder';
import { UblEquivalentDocumentBuilder } from './xml/ubl-equivalent-document.builder';
import { UblCommonBuilder } from './xml/ubl-common.builder';
import {
  UblApplicationResponseBuilder,
  DianEventParty,
} from './xml/ubl-application-response.builder';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_ID_TYPES,
} from './constants/dian-document-types';
import {
  DianConfigDecrypted,
  DianIssuerData,
  DianCustomerData,
} from './interfaces/dian-config.interface';
import {
  DianDocumentEventRequest,
  DianDocumentEventResult,
} from './interfaces/dian-event.interface';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  DEFAULT_STORE_TIMEZONE,
  localOffsetString,
} from '../../../../../common/utils/store-timezone.util';

type DianConfigurationType =
  | 'invoicing'
  | 'support_document'
  | 'payroll'
  | 'equivalent_document';

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
    private readonly secret_envelope: DianSecretEnvelopeService,
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

      // dianSum, not float reduce + toFixed: the CUFE is a hash, so a cent of
      // float drift or a rounded half-cent changes it and the DIAN rejects the
      // document. Summing in Decimal space with truncation matches Anexo §11.2.
      const iva_amount = dianSum(iva_taxes.map((t) => t.tax_amount));
      const ica_amount = dianSum(ica_taxes.map((t) => t.tax_amount));
      const inc_amount = dianSum(inc_taxes.map((t) => t.tax_amount));

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

      // ValFac must be the SAME number the XML publishes as
      // `LegalMonetaryTotal/LineExtensionAmount`, because the DIAN recomputes the
      // CUFE from the XML. Both come from `dianLineExtensionTotal` so they cannot
      // drift: passing `subtotal_amount` here would hash the GROSS subtotal while
      // the document declares the NET one on any invoice carrying a discount.
      const line_extension_total = dianLineExtensionTotal(invoice_data.items);

      // Calculate CUFE
      const cufe = CufeCalculator.generate({
        invoice_number: invoice_data.invoice_number,
        issue_date: invoice_data.issue_date,
        issue_time: this.issueTime(invoice_data),
        total_before_tax: line_extension_total,
        tax_iva: iva_amount,
        tax_inc: inc_amount,
        tax_ica: ica_amount,
        total_amount: invoice_data.total_amount,
        // Anexo §11.2: NitOFE and NumAdq carry no dots, dashes or DV. A customer
        // document typed as `900.123.456-7` otherwise yields a CUFE the DIAN
        // cannot reproduce. `CufeCalculator` sanitizes defensively too; doing it
        // here keeps the XML and the hash reading the same string.
        issuer_nit: onlyDigits(config.nit),
        customer_nit: onlyDigits(invoice_data.customer_tax_id) || '222222222222',
        technical_key,
        environment: config.environment === 'production' ? '1' : '2',
      });

      // Build UBL XML. `invoice_type_code` carries contingency through: a
      // document expedited under DIAN unavailability must declare '04' on its
      // later transmission, keeping the same prefix and number (Anexo §12.2).
      const xml = UblInvoiceBuilder.build({
        invoice_data,
        issuer,
        customer,
        software_security,
        cufe,
        environment: config.environment,
        invoice_type_code: invoice_data.contingency_type
          ? DIAN_DOCUMENT_TYPES.CONTINGENCY_DIAN_INVOICE
          : undefined,
      });

      // Sign XML with certificate
      const signed_xml = await this.signXml(xml, config);

      // ZIP + base64
      const file_names = this.dianFileNames(
        'invoice',
        config,
        invoice_data.invoice_number,
        invoice_data.issue_date,
      );
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );

      // Load WS-Security credentials for SOAP envelope
      const ws_credentials = await this.loadWsCredentials(config);

      // Send to DIAN
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        file_names.zip,
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
          : dian_response.contingency_eligible
            ? `La DIAN no está disponible: ${dian_response.status_message}`
            : `Documento rechazado: ${parsed.errors.map((e) => e.message).join(', ')}`,
        // Carried up so the flow can tell "the DIAN is down" (→ contingency Type
        // 04) apart from "the document is invalid" (→ rejected). Without this the
        // flow marked an outage as a rejection and blocked the accounting entry.
        contingency_eligible: dian_response.contingency_eligible,
        failure_class: dian_response.failure_class,
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

      const cn_iva_amount = dianSum(cn_iva_taxes.map((t) => t.tax_amount));
      const cn_ica_amount = dianSum(cn_ica_taxes.map((t) => t.tax_amount));
      const cn_inc_amount = dianSum(cn_inc_taxes.map((t) => t.tax_amount));

      // Same rule as the invoice: the hashed base must equal the base the XML
      // declares, so both derive from `dianLineExtensionTotal`.
      const cn_line_extension_total = dianLineExtensionTotal(
        credit_note_data.items,
      );

      // For credit notes, generate CUDE (same algorithm as CUFE, ClTec replaced
      // by the software PIN per Anexo §11.4)
      const cude = CufeCalculator.generate({
        invoice_number: credit_note_data.invoice_number,
        issue_date: credit_note_data.issue_date,
        issue_time: this.issueTime(credit_note_data),
        total_before_tax: cn_line_extension_total,
        tax_iva: cn_iva_amount,
        tax_inc: cn_inc_amount,
        tax_ica: cn_ica_amount,
        total_amount: credit_note_data.total_amount,
        issuer_nit: onlyDigits(config.nit),
        customer_nit:
          onlyDigits(credit_note_data.customer_tax_id) || '222222222222',
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
      const file_names = this.dianFileNames(
        'credit_note',
        config,
        credit_note_data.invoice_number,
        credit_note_data.issue_date,
      );
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );

      // Load WS-Security credentials for SOAP envelope
      const ws_credentials = await this.loadWsCredentials(config);

      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        file_names.zip,
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
        total_before_tax: dianLineExtensionTotal(debit_note_data.items),
        tax_iva: dianSum(iva_taxes.map((t) => t.tax_amount)),
        tax_inc: dianSum(inc_taxes.map((t) => t.tax_amount)),
        tax_ica: dianSum(ica_taxes.map((t) => t.tax_amount)),
        total_amount: debit_note_data.total_amount,
        issuer_nit: onlyDigits(config.nit),
        customer_nit:
          onlyDigits(debit_note_data.customer_tax_id) || '222222222222',
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
      const file_names = this.dianFileNames(
        'debit_note',
        config,
        debit_note_data.invoice_number,
        debit_note_data.issue_date,
      );
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        file_names.zip,
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
        total_before_tax: dianLineExtensionTotal(support_document_data.items),
        tax_iva: taxes.iva,
        tax_inc: taxes.inc,
        tax_ica: taxes.ica,
        total_amount: support_document_data.total_amount,
        issuer_nit: onlyDigits(config.nit),
        customer_nit:
          onlyDigits(support_document_data.customer_tax_id) || '222222222222',
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
      const file_names = this.dianFileNames(
        'support_document',
        config,
        support_document_data.invoice_number,
        support_document_data.issue_date,
      );
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        file_names.zip,
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
        total_before_tax: dianLineExtensionTotal(support_adjustment_data.items),
        tax_iva: taxes.iva,
        tax_inc: taxes.inc,
        tax_ica: taxes.ica,
        total_amount: support_adjustment_data.total_amount,
        issuer_nit: onlyDigits(config.nit),
        customer_nit:
          onlyDigits(support_adjustment_data.customer_tax_id) ||
          '222222222222',
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
      const file_names = this.dianFileNames(
        'support_adjustment_note',
        config,
        support_adjustment_data.invoice_number,
        support_adjustment_data.issue_date,
      );
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        file_names.zip,
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

  /**
   * Transmits the **documento equivalente electrónico del tiquete POS**
   * (Res. 000165/2023, Anexo Técnico DE v1.0) or one of its adjustment notes.
   *
   * Three differences from `sendInvoice` that are the whole reason this is a
   * separate method rather than a flag:
   *
   * 1. **Configuration.** It loads `equivalent_document`, not `invoicing`. The
   *    DIAN habilita the software per document type with its own set de pruebas,
   *    so a store enabled for FEV is NOT thereby enabled to emit DE. Reusing the
   *    invoicing row would let an unauthorized emission look authorized.
   * 2. **Unique code.** CUDE with the **Software-PIN** in the 14th position
   *    (§14.1.2), never a CUFE with the ClTec. `sendInvoice` hard-fails without a
   *    `technical_key` precisely because that assert must not apply here.
   * 3. **Numbering.** Its own authorized range
   *    (`fiscal_document_type_enum.pos_equivalent_document`), so a POS ticket
   *    never burns a sales-invoice consecutive.
   *
   * The transport is identical (`SendBillSync`), which is why nothing below is
   * duplicated beyond what those three differences force.
   */
  async sendEquivalentDocument(
    document_data: ProviderInvoiceData,
    options: { document_type_code?: string } = {},
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig('equivalent_document');
    this.validateCertificateExpiry(config);

    const is_adjustment_note = !!options.document_type_code;
    const action = is_adjustment_note
      ? 'send_equivalent_adjustment_note'
      : 'send_equivalent_document';
    const document_type = is_adjustment_note
      ? 'equivalent_adjustment_note'
      : 'pos_equivalent_document';

    try {
      const issuer = await this.loadIssuerData(config);
      const customer = this.buildCustomerData(document_data);
      const software_security = this.buildSoftwareSecurity(
        config,
        document_data.invoice_number,
      );
      const taxes = this.calculateTaxAmounts(document_data);

      // ValFac must be the number the XML publishes as `LineExtensionAmount`, the
      // same invariant `sendInvoice` documents: the DIAN recomputes the key from
      // the XML, so hashing `subtotal_amount` would diverge on any discount.
      const cude = CufeCalculator.generateEquivalentDocumentCude({
        invoice_number: document_data.invoice_number,
        issue_date: document_data.issue_date,
        issue_time: this.issueTime(document_data),
        total_before_tax: dianLineExtensionTotal(document_data.items),
        tax_iva: taxes.iva,
        tax_inc: taxes.inc,
        tax_ica: taxes.ica,
        total_amount: document_data.total_amount,
        issuer_nit: onlyDigits(config.nit),
        customer_nit: onlyDigits(document_data.customer_tax_id) || '222222222222',
        environment: config.environment === 'production' ? '1' : '2',
        software_pin: config.software_pin,
      });

      const xml = UblEquivalentDocumentBuilder.build({
        invoice_data: document_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        document_type_code: options.document_type_code,
      });

      const signed_xml = await this.signXml(xml, config);
      const file_names = this.dianFileNames(
        'equivalent_document',
        config,
        document_data.invoice_number,
        document_data.issue_date,
      );
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );
      const ws_credentials = await this.loadWsCredentials(config);
      const dian_response = await this.soap_client.sendBillSync(
        zip_base64,
        file_names.zip,
        config.environment,
        ws_credentials,
      );
      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      await this.createAuditLog(config.id, {
        action,
        document_type,
        document_number: document_data.invoice_number,
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
          ? 'Documento equivalente aceptado por la DIAN'
          : dian_response.contingency_eligible
            ? `La DIAN no está disponible: ${dian_response.status_message}`
            : `Documento equivalente rechazado: ${parsed.errors.map((e) => e.message).join(', ')}`,
        // Same distinction the invoice path carries: an outage is not a rejection.
        // A POS ticket handed to the customer during a DIAN outage is valid and
        // owes a transmission, so it must not land in a terminal `rejected`.
        contingency_eligible: dian_response.contingency_eligible,
        failure_class: dian_response.failure_class,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_status_description: parsed.status_description,
          dian_errors: parsed.errors,
          environment: config.environment,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to send equivalent document to DIAN: ${error.message}`,
      );

      await this.createAuditLog(config.id, {
        action,
        document_type,
        document_number: document_data.invoice_number,
        status: 'error',
        error_message: error.message,
        duration_ms: Date.now() - start_time,
      });

      throw error;
    }
  }

  /**
   * Nota de ajuste al documento equivalente — '94' crédito (default) or '93'
   * débito (numeral 16.3). The DE has no credit/debit note of its own, so this is
   * the only way to correct one, and it rides the same builder to keep the two
   * from drifting apart.
   */
  async sendEquivalentAdjustmentNote(
    adjustment_data: ProviderInvoiceData,
  ): Promise<ProviderResponse> {
    const is_debit = adjustment_data.invoice_type === 'debit_note';
    return this.sendEquivalentDocument(adjustment_data, {
      document_type_code: is_debit
        ? DIAN_DOCUMENT_TYPES.EQUIVALENT_DEBIT_ADJUSTMENT_NOTE
        : DIAN_DOCUMENT_TYPES.EQUIVALENT_CREDIT_ADJUSTMENT_NOTE,
    });
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

  /**
   * Registers a RADIAN document event (`ApplicationResponse`) against an
   * already-accepted document.
   *
   * Differences from a document transmission that are easy to get wrong:
   * - The key is a CUDE derived from the EVENT fields, not from amounts
   *   (`CufeCalculator.generateEventCude`).
   * - The SOAP operation is `SendEventUpdateStatus`, not `SendBillSync`.
   * - There is no contingency scheme: Anexo §12 covers documents, not events, so
   *   a DIAN outage means "retry later", never "declare contingency".
   * - No numbering resolution applies, so `sts:InvoiceControl` is omitted.
   */
  async sendDocumentEvent(
    event: DianDocumentEventRequest,
  ): Promise<DianDocumentEventResult> {
    const start_time = Date.now();
    const config = await this.loadConfig();

    this.validateCertificateExpiry(config);

    const issuer = await this.loadIssuerData(config);

    const issuer_party: DianEventParty = {
      document_type: issuer.document_type || DIAN_ID_TYPES.NIT,
      document_number: onlyDigits(issuer.nit),
      document_dv: issuer.nit_dv,
      legal_name: issuer.legal_name,
    };
    const customer_party: DianEventParty = {
      ...event.customer,
      document_number: onlyDigits(event.customer.document_number),
    };

    // 030/031/032/033 travel adquiriente → emisor; 034 travels the other way.
    const sender =
      event.generated_by === 'issuer' ? issuer_party : customer_party;
    const receiver =
      event.generated_by === 'issuer' ? customer_party : issuer_party;

    const issue_time =
      event.issue_time ||
      `00:00:00${localOffsetString(
        new Date(`${event.issue_date}T12:00:00.000Z`),
        DEFAULT_STORE_TIMEZONE,
      )}`;

    // The CUDE always binds the emisor NIT and the adquiriente document of the
    // REFERENCED invoice, regardless of which side generated the event.
    // NitFE/DocAdq are the GENERATOR and the RECEIVER of the event — not the
    // emisor/adquiriente of the referenced invoice. On a 030 the buyer generates,
    // so NitFE is the buyer; getting this from the invoice instead of from the
    // event's own parties yields a key the DIAN cannot reproduce.
    const cude = CufeCalculator.generateEventCude({
      event_number: event.event_number,
      issue_date: event.issue_date,
      issue_time,
      event_code: event.event_code,
      issuer_nit: sender.document_number,
      customer_nit: receiver.document_number || '222222222222',
      referenced_document_number: event.referenced_document_number,
      referenced_document_type_code: event.referenced_document_type_code,
      software_pin: config.software_pin,
    });

    const xml = UblApplicationResponseBuilder.build({
      event_number: event.event_number,
      event_code: event.event_code,
      operation_code: event.operation_code,
      details: event.details,
      cude,
      issue_date: event.issue_date,
      issue_time,
      sender,
      receiver,
      referenced_document_number: event.referenced_document_number,
      referenced_document_key: event.referenced_document_key,
      referenced_document_date: event.referenced_document_date,
      referenced_document_type_code: event.referenced_document_type_code,
      software_security: this.buildSoftwareSecurity(config, event.event_number),
      environment: config.environment,
      description: event.description,
    });

    // El documento de un evento es un ApplicationResponse, así que su prefijo es
    // `ar` (Anexo Técnico 1.9, numeral 6.5.7). El nombre anterior, `ev<code><num>`,
    // no existe en ningún anexo. El año se deja por defecto —el evento se expide
    // ahora— porque no viaja una fecha de emisión propia en el payload.
    const file_names = this.dianFileNames(
      'application_response',
      config,
      String(event.event_number),
    );
    let signed_xml = xml;

    try {
      signed_xml = await this.signXml(xml, config);
      const zip_base64 = await this.compressToZipBase64(
        signed_xml,
        file_names.xml,
      );

      const ws_credentials = await this.loadWsCredentials(config);

      const dian_response = await this.soap_client.sendEventUpdateStatus(
        zip_base64,
        file_names.zip,
        config.environment,
        ws_credentials,
      );

      const parsed = this.response_parser.parseApplicationResponse(
        dian_response.raw_response,
      );

      await this.createAuditLog(config.id, {
        action: 'send_document_event',
        document_type: `event_${event.event_code}`,
        document_number: event.event_number,
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
        event_code: event.event_code,
        dian_configuration_id: config.id,
        cude,
        tracking_id: parsed.document_key || cude,
        status_code: parsed.status_code,
        message: parsed.is_valid
          ? `Evento ${event.event_code} registrado en RADIAN`
          : `Evento ${event.event_code} rechazado: ${parsed.errors
              .map((e) => e.message)
              .join(', ')}`,
        request_xml: signed_xml,
        response_xml: dian_response.raw_response,
        errors: parsed.errors.map((e) => ({
          code: e.code,
          message: e.message,
        })),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      this.logger.error(`Failed to send DIAN event: ${message}`);

      await this.createAuditLog(config.id, {
        action: 'send_document_event',
        document_type: `event_${event.event_code}`,
        document_number: event.event_number,
        request_xml: signed_xml,
        status: 'error',
        error_message: message,
        cufe: cude,
        duration_ms: Date.now() - start_time,
      });

      // Returned rather than rethrown: the caller persists the failed event row
      // so a retry reuses the same consecutive instead of burning a new one.
      return {
        success: false,
        event_code: event.event_code,
        dian_configuration_id: config.id,
        cude,
        message,
        request_xml: signed_xml,
        errors: [{ message }],
      };
    }
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
    return this.xml_signer.buildWsCredentials(
      p12_buffer,
      config.certificate_password || '',
      config.certificate_kms_key_id,
    );
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

    const software_pin = this.encryption.decrypt(config.software_pin_encrypted);
    const certificate_password = config.certificate_password_encrypted
      ? this.encryption.decrypt(config.certificate_password_encrypted)
      : null;

    // Only place the plaintext exists, so the only place a weaker envelope can be
    // retired. Awaited rather than fire-and-forget so the write stays inside the
    // request's tenant context (the scoped Prisma client reads it from ALS), and
    // it never throws — see DianSecretEnvelopeService.
    await this.secret_envelope.upgradeInPlace(
      config.id,
      config,
      { software_pin, certificate_password },
    );

    return {
      id: config.id,
      organization_id: config.organization_id,
      store_id: config.store_id,
      accounting_entity_id: config.accounting_entity_id,
      nit: config.nit,
      nit_dv: config.nit_dv,
      software_id: config.software_id,
      software_pin,
      certificate_s3_key: config.certificate_s3_key,
      certificate_password,
      certificate_kms_key_id: config.certificate_kms_key_id,
      certificate_expiry: config.certificate_expiry,
      environment: config.environment as 'test' | 'production',
      enablement_status: config.enablement_status,
      test_set_id: config.test_set_id,
      operation_mode: config.operation_mode,
    };
  }

  /**
   * Fallback when the caller did not resolve the emission time: midnight of the
   * issue date, with the offset that zone really had on that date. The previous
   * form built the time from a UTC instant and appended a literal `-05:00`,
   * which names a different instant while parsing perfectly.
   */
  private issueTime(document_data: ProviderInvoiceData): string {
    if (document_data.issue_time) return document_data.issue_time;
    // Probe at midday to stay clear of any offset transition boundary.
    const probe = new Date(`${document_data.issue_date}T12:00:00.000Z`);
    return `00:00:00${localOffsetString(probe, DEFAULT_STORE_TIMEZONE)}`;
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
    // Decimal-space sum with truncation: these three values are hashed into the
    // CUFE/CUDE/CUDS, so float drift or a rounded half-cent invalidates the key.
    const total = (taxes: typeof document_data.taxes) =>
      dianSum(taxes.map((tax) => tax.tax_amount));

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
   *
   * @deprecated Desde el paso 4 del plan de SSOT, `loadIssuerData` delega en
   *   `resolveIssuerFiscalIdentity` (ver `fiscal-issuer.util.ts`), que calcula
   *   el régimen vía `isVatResponsible` (RUT casilla 53) en vez de mapear por
   *   string. Conservada como `unused` para no romper extensiones que aún la
   *   referencien; se elimina en el paso 7 junto con el resto del kill switch.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    // Fuente única de la verdad fiscal: el resolvedor decide precedencias entre
    // `fiscal_data`, las columnas de la organización/tienda, la dirección y la
    // `dian_configurations`. Esta misma cascada la usa `dian-test.service.ts` y
    // los consumidores no-DIAN (paso 5 del plan), así que habilitación y
    // producción no pueden divergir sobre el mismo NIT. Antes esta función
    // duplicaba la cascada con tres defectos conocidos que el plan cierra:
    //   - `tax_scheme` por defecto era 'O-15' (autorretenedor) — afirma ante
    //     la DIAN una responsabilidad que el emisor puede no tener.
    //   - `tax_regime` se mapeaba por string ('COMUN'/'SIMPLIFICADO') sin
    //     consultar `isVatResponsible`, así que un `tax_regime: ''` daba '48'.
    //   - `department_name` caía a `municipality_code.slice(0,2)` (código
    //     numérico en `cbc:CountrySubentity`, campo de nombre).
    return resolveIssuerFiscalIdentity({
      nit: config.nit,
      fiscal_data: fiscalData,
      entity: { legal_name: entity.legal_name, name: entity.name },
      organization: organization
        ? {
            legal_name: organization.legal_name,
            name: organization.name,
            email: organization.email,
            phone: organization.phone,
            document_type: organization.document_type,
            person_type: organization.person_type,
          }
        : null,
      address: address
        ? {
            address_line1: address.address_line1,
            city: address.city,
            state_province: address.state_province,
            municipality_code: address.municipality_code,
            postal_code: address.postal_code,
            phone_number: address.phone_number,
          }
        : null,
      email: organization.email,
    });
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
      document_dv: invoice_data.customer_verification_digit,
      person_type: invoice_data.customer_person_type,
      tax_responsibilities: invoice_data.customer_tax_responsibilities?.length
        ? invoice_data.customer_tax_responsibilities
        : undefined,
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
    // Under HSM custody the container may legitimately hold no private key, so a
    // missing password is NOT a missing certificate. Requiring one would make the
    // stronger custody look unconfigured and silently ship unsigned XML in dev.
    const has_certificate =
      !!config.certificate_s3_key &&
      (!!config.certificate_password || !!config.certificate_kms_key_id);

    if (!has_certificate) {
      if (config.environment === 'production') {
        throw new Error(
          'A valid certificate is required to sign DIAN production documents.',
        );
      }
      this.logger.warn('No certificate configured — returning unsigned XML');
      return xml;
    }

    const p12_buffer = await this.s3_service.downloadImage(
      config.certificate_s3_key!,
    );
    return this.xml_signer.sign(
      xml,
      p12_buffer,
      config.certificate_password || '',
      config.certificate_kms_key_id,
    );
  }

  /**
   * Compresses XML to ZIP and encodes as base64.
   * Uses native zlib (deflate) — DIAN expects a ZIP file.
   */
  /**
   * Nombres del XML y del ZIP que se entregan a la DIAN, en un solo lugar.
   *
   * Antes cada método armaba `${invoice_number}.xml` / `.zip`, un formato que no
   * existe en ningún anexo. La DIAN no lo rechaza al recibir —`SendBillSync` y
   * `SendTestSetAsync` solo validan que el ZIP sea legible y que el UBL traiga
   * CUFE, número, fecha, NIT y versión—, pero su procesamiento posterior parsea
   * el nombre por posiciones fijas. Ver `dian-file-naming.util.ts` para el
   * defecto concreto que esto cerró.
   */
  private dianFileNames(
    kind: DianDocumentKind,
    config: DianConfigDecrypted,
    document_number: string,
    issue_date?: string,
  ): { xml: string; zip: string } {
    const parts = {
      nit: config.nit,
      consecutive: consecutiveFromDocumentNumber(document_number),
      software_code: softwareCodeForOperationMode(config.operation_mode),
      year: issue_date,
    };
    return {
      xml: buildDianXmlFileName(kind, parts),
      zip: buildDianZipFileName(parts),
    };
  }

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
