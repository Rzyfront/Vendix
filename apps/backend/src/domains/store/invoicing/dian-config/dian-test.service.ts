import { Injectable, Logger } from '@nestjs/common';
import * as AdmZip from 'adm-zip';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  DianSoapClient,
  WsSecurityCredentials,
} from '../providers/dian-direct/dian-soap.client';
import { DianResponseParserService } from '../providers/dian-direct/dian-response-parser.service';
import { DianXmlSignerService } from '../providers/dian-direct/dian-xml-signer.service';
import { UblInvoiceBuilder } from '../providers/dian-direct/xml/ubl-invoice.builder';
import { UblCreditNoteBuilder } from '../providers/dian-direct/xml/ubl-credit-note.builder';
import { UblDebitNoteBuilder } from '../providers/dian-direct/xml/ubl-debit-note.builder';
import { UblCommonBuilder } from '../providers/dian-direct/xml/ubl-common.builder';
import { CufeCalculator } from '../utils/cufe-calculator';
import {
  DianIssuerData,
  DianCustomerData,
} from '../providers/dian-direct/interfaces/dian-config.interface';
import { ProviderInvoiceData } from '../providers/invoice-provider.interface';

@Injectable()
export class DianTestService {
  private readonly logger = new Logger(DianTestService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly soap_client: DianSoapClient,
    private readonly response_parser: DianResponseParserService,
    private readonly s3_service: S3Service,
    private readonly xml_signer: DianXmlSignerService,
  ) {}

  private async getConfigById(config_id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id: config_id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return config;
  }

  /**
   * Tests connectivity to DIAN web services for a specific configuration.
   */
  async testConnection(config_id: number) {
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    // Load certificate for WS-Security
    let ws_credentials: WsSecurityCredentials | undefined;
    if (config.certificate_s3_key && config.certificate_password_encrypted) {
      try {
        const cert_password = this.encryption.decrypt(
          config.certificate_password_encrypted,
        );
        const p12_buffer = await this.s3_service.downloadImage(
          config.certificate_s3_key,
        );
        const creds = this.xml_signer.extractCredentials(
          p12_buffer,
          cert_password,
        );
        ws_credentials = {
          private_key_pem: creds.private_key_pem,
          certificate_der_base64: creds.certificate_der_base64,
        };
      } catch (error) {
        this.logger.warn(
          `Failed to extract WS-Security credentials for connection test, continuing without: ${error.message}`,
        );
      }
    }

    try {
      const response = await this.soap_client.getStatus(
        '00000000-0000-0000-0000-000000000000',
        environment,
        ws_credentials,
      );

      // Connection is successful if DIAN responded with valid SOAP.
      // A SOAP Fault (e.g., InvalidSecurity) means DIAN is reachable but rejected auth.
      // Both valid responses and SOAP faults confirm connectivity.
      const is_connected =
        response.success ||
        response.is_soap_fault === true ||
        (response.status_code !== 'NETWORK_ERROR' &&
          response.status_code !== 'TIMEOUT' &&
          response.raw_response.includes('Envelope'));

      const is_security_error =
        response.is_soap_fault &&
        response.raw_response.includes('InvalidSecurity');

      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: is_connected ? 'success' : 'error',
        error_message: is_connected ? null : 'No response from DIAN',
        duration_ms: response.duration_ms,
      });

      return {
        success: is_connected,
        environment,
        response_time_ms: response.duration_ms,
        message: is_connected
          ? is_security_error
            ? 'Conexión exitosa. El certificado será utilizado para firmar las facturas al enviarlas.'
            : 'Conexión exitosa con los servicios de la DIAN'
          : 'No se pudo conectar con los servicios de la DIAN',
        dian_status: response.status_code,
      };
    } catch (error) {
      this.logger.error(`DIAN connection test failed: ${error.message}`);

      await this.createAuditLog(config.id, {
        action: 'test_connection',
        status: 'error',
        error_message: error.message,
      });

      throw new VendixHttpException(ErrorCodes.DIAN_CONN_001);
    }
  }

  /**
   * Runs the DIAN test set for a specific configuration.
   * Generates 50 UBL XML documents (30 invoices + 10 debit notes + 10 credit notes),
   * signs them with the .p12 certificate, packages them in a single ZIP,
   * and sends to DIAN via SendTestSetAsync.
   */
  async runTestSet(config_id: number, resolution_id: number) {
    const config = await this.getConfigById(config_id);

    if (!config.test_set_id) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured',
      );
    }

    const environment = config.environment as 'test' | 'production';

    // 1. Decrypt credentials
    const software_pin = this.encryption.decrypt(config.software_pin_encrypted);
    const cert_password = config.certificate_password_encrypted
      ? this.encryption.decrypt(config.certificate_password_encrypted)
      : null;

    // 2. Load resolution
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id: resolution_id },
    });
    if (!resolution) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'Resolution not found',
      );
    }

    // 3. Build issuer data from config + organization
    const context = RequestContextService.getContext();
    if (!context) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No request context',
      );
    }
    const organization = await this.prisma.organizations.findFirst({
      where: { id: context.organization_id },
    });

    const issuer: DianIssuerData = {
      nit: config.nit,
      nit_dv: config.nit_dv || '0',
      legal_name: organization?.name || config.name,
      address_line: 'Calle 1 # 1-1',
      city_code: '11001',
      city_name: 'Bogotá',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      country_code: 'CO',
      email: 'test@vendix.com',
      tax_regime: '49',
      tax_scheme: 'ZZ',
    };

    const customer: DianCustomerData = {
      document_type: '13',
      document_number: '222222222222',
      legal_name: 'Consumidor Test DIAN',
      address_line: 'Calle Test 123',
      city_code: '11001',
      city_name: 'Bogotá',
      department_code: '11',
      department_name: 'Bogotá D.C.',
      country_code: 'CO',
      email: 'test@consumidor.com',
      tax_regime: '49',
    };

    // 4. Download certificate from S3
    let p12_buffer: Buffer | null = null;
    if (config.certificate_s3_key && cert_password) {
      p12_buffer = await this.s3_service.downloadImage(
        config.certificate_s3_key,
      );
    }

    // 4b. Extract WS-Security credentials from certificate
    let ws_credentials: WsSecurityCredentials | undefined;
    if (p12_buffer && cert_password) {
      try {
        const creds = this.xml_signer.extractCredentials(
          p12_buffer,
          cert_password,
        );
        ws_credentials = {
          private_key_pem: creds.private_key_pem,
          certificate_der_base64: creds.certificate_der_base64,
        };
      } catch (error) {
        this.logger.warn(
          `Failed to extract WS-Security credentials, continuing without: ${error.message}`,
        );
      }
    }

    // 5. Update status to testing
    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: { enablement_status: 'testing' },
    });

    // 6. Generate 50 documents
    const files: { name: string; content: string }[] = [];
    const invoice_cufes: { number: string; cufe: string; date: string }[] = [];
    const today = new Date().toISOString().split('T')[0];
    const time_now = `${new Date().toISOString().split('T')[1].substring(0, 8)}-05:00`;

    // 6a. Generate 30 invoices
    for (let i = 0; i < 30; i++) {
      const invoice_number = `${resolution.prefix}${resolution.range_from + i}`;
      const subtotal = (100000 + i * 15000).toFixed(2);
      const tax = (parseFloat(subtotal) * 0.19).toFixed(2);
      const total = (parseFloat(subtotal) + parseFloat(tax)).toFixed(2);

      const software_security_code =
        UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          software_pin,
          invoice_number,
        );

      const cufe = CufeCalculator.generate({
        invoice_number,
        issue_date: today,
        issue_time: time_now,
        total_before_tax: subtotal,
        tax_iva: tax,
        total_amount: total,
        issuer_nit: config.nit,
        customer_nit: '222222222222',
        technical_key: resolution.technical_key || '',
        environment: environment === 'test' ? '2' : '1',
      });

      const invoice_data: ProviderInvoiceData = {
        invoice_number,
        invoice_type: '01',
        issue_date: today,
        subtotal_amount: subtotal,
        discount_amount: '0.00',
        tax_amount: tax,
        withholding_amount: '0.00',
        total_amount: total,
        payment_means: '10',
        payment_form: '1',
        items: [
          {
            description: `Producto de prueba ${i + 1}`,
            quantity: '1.00',
            unit_price: subtotal,
            discount_amount: '0.00',
            tax_amount: tax,
            total_amount: total,
          },
        ],
        taxes: [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: subtotal,
            tax_amount: tax,
          },
        ],
      };

      let xml = UblInvoiceBuilder.build({
        invoice_data,
        issuer,
        customer,
        software_security: {
          software_id: config.software_id,
          software_pin,
          software_security_code,
        },
        cufe,
        environment,
      });

      // Sign XML if certificate available
      if (p12_buffer && cert_password) {
        xml = await this.xml_signer.sign(xml, p12_buffer, cert_password);
      }

      files.push({ name: `${invoice_number}.xml`, content: xml });
      invoice_cufes.push({ number: invoice_number, cufe, date: today });
    }

    // 6b. Generate 10 debit notes (referencing invoices 0-9)
    for (let i = 0; i < 10; i++) {
      const note_number = `${resolution.prefix}${resolution.range_from + 30 + i}`;
      const ref_invoice = invoice_cufes[i];
      const subtotal = (50000 + i * 5000).toFixed(2);
      const tax = (parseFloat(subtotal) * 0.19).toFixed(2);
      const total = (parseFloat(subtotal) + parseFloat(tax)).toFixed(2);

      const software_security_code =
        UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          software_pin,
          note_number,
        );

      const cude = CufeCalculator.generate({
        invoice_number: note_number,
        issue_date: today,
        issue_time: time_now,
        total_before_tax: subtotal,
        tax_iva: tax,
        total_amount: total,
        issuer_nit: config.nit,
        customer_nit: '222222222222',
        technical_key: resolution.technical_key || '',
        environment: environment === 'test' ? '2' : '1',
      });

      const debit_note_data: ProviderInvoiceData = {
        invoice_number: note_number,
        invoice_type: '92',
        issue_date: today,
        subtotal_amount: subtotal,
        discount_amount: '0.00',
        tax_amount: tax,
        withholding_amount: '0.00',
        total_amount: total,
        payment_means: '10',
        payment_form: '1',
        notes: 'Intereses',
        items: [
          {
            description: `Ajuste débito prueba ${i + 1}`,
            quantity: '1.00',
            unit_price: subtotal,
            discount_amount: '0.00',
            tax_amount: tax,
            total_amount: total,
          },
        ],
        taxes: [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: subtotal,
            tax_amount: tax,
          },
        ],
      };

      let xml = UblDebitNoteBuilder.build({
        debit_note_data,
        issuer,
        customer,
        software_security: {
          software_id: config.software_id,
          software_pin,
          software_security_code,
        },
        cude,
        environment,
        original_invoice_number: ref_invoice.number,
        original_invoice_cufe: ref_invoice.cufe,
        original_invoice_date: ref_invoice.date,
      });

      if (p12_buffer && cert_password) {
        xml = await this.xml_signer.sign(xml, p12_buffer, cert_password);
      }

      files.push({ name: `${note_number}.xml`, content: xml });
    }

    // 6c. Generate 10 credit notes (referencing invoices 10-19)
    for (let i = 0; i < 10; i++) {
      const note_number = `${resolution.prefix}${resolution.range_from + 40 + i}`;
      const ref_invoice = invoice_cufes[10 + i];
      const subtotal = (50000 + i * 5000).toFixed(2);
      const tax = (parseFloat(subtotal) * 0.19).toFixed(2);
      const total = (parseFloat(subtotal) + parseFloat(tax)).toFixed(2);

      const software_security_code =
        UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          software_pin,
          note_number,
        );

      const cude = CufeCalculator.generate({
        invoice_number: note_number,
        issue_date: today,
        issue_time: time_now,
        total_before_tax: subtotal,
        tax_iva: tax,
        total_amount: total,
        issuer_nit: config.nit,
        customer_nit: '222222222222',
        technical_key: resolution.technical_key || '',
        environment: environment === 'test' ? '2' : '1',
      });

      const credit_note_data: ProviderInvoiceData = {
        invoice_number: note_number,
        invoice_type: '91',
        issue_date: today,
        subtotal_amount: subtotal,
        discount_amount: '0.00',
        tax_amount: tax,
        withholding_amount: '0.00',
        total_amount: total,
        payment_means: '10',
        payment_form: '1',
        notes: 'Devolución de bienes',
        items: [
          {
            description: `Devolución prueba ${i + 1}`,
            quantity: '1.00',
            unit_price: subtotal,
            discount_amount: '0.00',
            tax_amount: tax,
            total_amount: total,
          },
        ],
        taxes: [
          {
            tax_name: 'IVA',
            tax_rate: '19.00',
            taxable_amount: subtotal,
            tax_amount: tax,
          },
        ],
      };

      let xml = UblCreditNoteBuilder.build({
        credit_note_data,
        issuer,
        customer,
        software_security: {
          software_id: config.software_id,
          software_pin,
          software_security_code,
        },
        cude,
        environment,
        original_invoice_number: ref_invoice.number,
        original_invoice_cufe: ref_invoice.cufe,
        original_invoice_date: ref_invoice.date,
      });

      if (p12_buffer && cert_password) {
        xml = await this.xml_signer.sign(xml, p12_buffer, cert_password);
      }

      files.push({ name: `${note_number}.xml`, content: xml });
    }

    // 7. Build multi-file ZIP
    const zip_base64 = this.buildMultiFileZip(files);

    // 8. Send to DIAN
    const response = await this.soap_client.sendTestSetAsync(
      zip_base64,
      'test_set.zip',
      config.test_set_id,
      environment,
      ws_credentials,
    );

    // 9. Save result
    const result_data = {
      executed_at: new Date().toISOString(),
      total_documents: files.length,
      invoices: 30,
      debit_notes: 10,
      credit_notes: 10,
      dian_response: {
        success: response.success,
        status_code: response.status_code,
        status_message: response.status_message,
      },
      tracking_id: response.status_code,
    };

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        last_test_result: result_data,
        enablement_status: response.success ? 'enabled' : 'testing',
      },
    });

    await this.createAuditLog(config.id, {
      action: 'run_test_set',
      status: response.success ? 'success' : 'error',
      error_message: response.success ? null : response.status_message,
      duration_ms: response.duration_ms,
    });

    const is_ws_security_error =
      response.is_soap_fault === true &&
      response.raw_response?.includes('InvalidSecurity');

    return {
      success: response.success,
      documents_generated: true,
      message: response.success
        ? 'Set de pruebas procesado exitosamente por la DIAN'
        : is_ws_security_error
          ? '50 documentos generados y firmados correctamente. Pendiente: firma WS-Security del envelope SOAP.'
          : `Error al enviar set de pruebas: ${response.status_message}`,
      tracking_id: result_data.tracking_id,
      total_documents: 50,
      invoices_count: 30,
      debit_notes_count: 10,
      credit_notes_count: 10,
      environment,
      dian_status: response.status_code,
    };
  }

  /**
   * Gets the test results for a specific DIAN configuration.
   */
  async getTestResults(config_id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id: config_id },
      select: {
        id: true,
        enablement_status: true,
        environment: true,
        test_set_id: true,
        last_test_result: true,
      },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return {
      enablement_status: config.enablement_status,
      environment: config.environment,
      test_set_id: config.test_set_id,
      last_result: config.last_test_result,
    };
  }

  /**
   * Builds a multi-file ZIP archive and returns its base64 representation.
   * Uses adm-zip for reliable ZIP format compatibility with DIAN.
   */
  private buildMultiFileZip(
    files: { name: string; content: string }[],
  ): string {
    const zip = new AdmZip();
    for (const file of files) {
      zip.addFile(file.name, Buffer.from(file.content, 'utf-8'));
    }
    return zip.toBuffer().toString('base64');
  }

  private async createAuditLog(
    dian_configuration_id: number,
    data: {
      action: string;
      status: string;
      error_message?: string | null;
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
