import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
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
import { UblCommonBuilder } from './xml/ubl-common.builder';
import {
  DianConfigDecrypted,
  DianIssuerData,
  DianCustomerData,
} from './interfaces/dian-config.interface';

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
      // Build issuer data from org
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

      // Calculate CUFE
      const cufe = CufeCalculator.generate({
        invoice_number: invoice_data.invoice_number,
        issue_date: invoice_data.issue_date,
        issue_time:
          new Date().toISOString().split('T')[1].split('.')[0] + '-05:00',
        total_before_tax: invoice_data.subtotal_amount,
        tax_iva: iva_amount,
        tax_inc: inc_amount,
        tax_ica: ica_amount,
        total_amount: invoice_data.total_amount,
        issuer_nit: config.nit,
        customer_nit: invoice_data.customer_tax_id || '222222222222',
        technical_key: invoice_data.technical_key || config.software_pin,
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
        issue_time:
          new Date().toISOString().split('T')[1].split('.')[0] + '-05:00',
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

      const xml = UblCreditNoteBuilder.build({
        credit_note_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        original_invoice_number: credit_note_data.order_reference,
        original_invoice_cufe: undefined, // TODO: retrieve from original invoice
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
        cufe: parsed.document_key || cude,
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
  private async loadConfig(): Promise<DianConfigDecrypted> {
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
        configuration_type: 'invoicing',
        enablement_status: { in: ['testing', 'enabled'] },
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });

    if (!config) {
      throw new Error(
        `No active DIAN configuration for fiscal entity ${accounting_entity.id}`,
      );
    }

    return {
      id: config.id,
      organization_id: config.organization_id,
      store_id: config.store_id,
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

  /**
   * Loads issuer data from the organization.
   */
  private async loadIssuerData(
    config: DianConfigDecrypted,
  ): Promise<DianIssuerData> {
    const org = await this.prisma.organizations.findUnique({
      where: { id: config.organization_id },
      include: {
        addresses: { take: 1 },
      },
    });

    if (!org) {
      throw new Error(`Organization ${config.organization_id} not found`);
    }

    const address = org.addresses?.[0];

    return {
      nit: config.nit,
      nit_dv: config.nit_dv || '0',
      legal_name: org.legal_name || org.name,
      trade_name: org.name,
      address_line: address?.address_line1 || 'N/A',
      city_code: address?.postal_code || '11001',
      city_name: address?.city || 'Bogotá',
      department_code: '11',
      department_name: address?.state_province || 'Bogotá',
      country_code: address?.country_code || 'CO',
      postal_code: address?.postal_code || '110111',
      phone: org.phone || undefined,
      email: org.email,
      tax_regime: '48', // Default: Responsable IVA
      tax_scheme: 'O-15', // Default: Autorretenedor
    };
  }

  /**
   * Builds customer data from invoice data.
   */
  private buildCustomerData(
    invoice_data: ProviderInvoiceData,
  ): DianCustomerData {
    return {
      document_type: invoice_data.customer_document_type || '13', // CC default
      document_number: invoice_data.customer_tax_id || '222222222222',
      legal_name: invoice_data.customer_name || 'Consumidor Final',
      email: invoice_data.customer_email,
      phone: invoice_data.customer_phone,
      tax_regime: invoice_data.customer_regime || '49', // No responsable
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
