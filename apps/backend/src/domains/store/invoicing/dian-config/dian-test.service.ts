import { Injectable, Logger } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DianSecretEnvelopeService } from '../../../../common/services/dian-secret-envelope.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  DianSoapClient,
  WsSecurityCredentials,
} from '../providers/dian-direct/dian-soap.client';
import { DianSendBillResponse } from '../providers/dian-direct/interfaces/dian-response.interface';
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
import {
  DEFAULT_STORE_TIMEZONE,
  localDateString,
  localTimeString,
  resolveStoreTimezone,
} from '../../../../common/utils/store-timezone.util';
import {
  buildDianXmlFileName,
  buildDianZipFileName,
  DianDocumentKind,
} from '../utils/dian-file-naming.util';
import { analyzeTestSetWait } from './test-set-wait.util';
import {
  buildTestSetCompositionView,
  describeComposition,
  resolveTestSetComposition,
  testSetSize,
} from './dian-test-set-composition';

/** One GetStatusZip poll attempt recorded in last_test_result for diagnostics. */
export interface TestSetPollAttempt {
  attempt: number;
  status_code: string;
  status_message: string;
  success: boolean;
}

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
    private readonly secret_envelope: DianSecretEnvelopeService,
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
   * Extracts WS-Security credentials (private key + DER cert) from the config's
   * stored .p12. Returns undefined and logs a warning if the certificate is
   * missing or cannot be opened, so callers degrade gracefully.
   */
  private async loadWsCredentials(config: {
    certificate_s3_key: string | null;
    certificate_password_encrypted: string | null;
    /** Non-exportable custody, when the entity has migrated its key to an HSM. */
    certificate_kms_key_id?: string | null;
  }): Promise<WsSecurityCredentials | undefined> {
    if (!config.certificate_s3_key || !config.certificate_password_encrypted) {
      return undefined;
    }
    try {
      const cert_password = this.encryption.decrypt(
        config.certificate_password_encrypted,
      );
      const p12_buffer = await this.s3_service.downloadImage(
        config.certificate_s3_key,
      );
      return this.xml_signer.buildWsCredentials(
        p12_buffer,
        cert_password,
        config.certificate_kms_key_id,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to extract WS-Security credentials, continuing without: ${error.message}`,
      );
      return undefined;
    }
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
        ws_credentials = this.xml_signer.buildWsCredentials(
          p12_buffer,
          cert_password,
          config.certificate_kms_key_id,
        );
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
   * Generates the UBL XML documents required by the tenant's mode of operation
   * (software propio: 2 FV + 1 NC + 1 ND; proveedor tecnológico: 6 FV + 2 NC + 2 ND),
   * signs them with the .p12 certificate, packages them in a single ZIP,
   * and sends to DIAN via SendTestSetAsync.
   */
  async runTestSet(config_id: number, resolution_id: number) {
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);

    if (!config.test_set_id) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No test set ID configured',
      );
    }

    // Guard against a second submission while DIAN still owes us a verdict for
    // the previous ZipKey. Re-sending consumes another block of resolution numbers and
    // DIAN rejects the batch as duplicated, which is unrecoverable from the UI.
    const previous_result = (config.last_test_result ?? {}) as Record<
      string,
      any
    >;
    if (previous_result.pending === true && previous_result.zip_key) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_002,
        `El set de pruebas ${previous_result.zip_key} aún está en validación en la DIAN. Consulta su estado antes de reenviar.`,
        { dian_configuration_id: config_id, zip_key: previous_result.zip_key },
      );
    }

    const environment = config.environment as 'test' | 'production';

    // 1. Decrypt credentials
    const software_pin = this.encryption.decrypt(config.software_pin_encrypted);
    const cert_password = config.certificate_password_encrypted
      ? this.encryption.decrypt(config.certificate_password_encrypted)
      : null;

    // Best moment to retire a weaker envelope: the habilitación flow holds the
    // plaintext and runs long before any production consecutive is at stake.
    await this.secret_envelope.upgradeInPlace(config.id, config, {
      software_pin,
      certificate_password: cert_password,
    });

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

    // The test set is a HABILITACIÓN artifact. Two provable guards keep it from
    // consuming production numbering, which can never be recovered:
    //
    // (a) A configuration already in `production` has nothing left to enable, and
    //     the resolutions attached to it are production ranges.
    // (b) A resolution that has already issued real `invoices` rows is a live
    //     range. Test sets never persist invoices, so a habilitación resolution
    //     stays at zero no matter how many times the set is re-sent — the
    //     condition therefore never blocks a legitimate retry.
    if (environment !== 'test') {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        'La configuración ya está en ambiente de producción: el set de pruebas solo se envía en ambiente de habilitación.',
        { dian_configuration_id: config_id, environment },
      );
    }
    // `invoices` está en `store_scoped_models`, así que el cliente scopeado exige
    // `store_id` en contexto y lanza 403 "store context required". La plataforma
    // corre este mismo flujo con `store_id: undefined` a propósito
    // (SubscriptionFiscalService.runInPlatformContext): su identidad fiscal es la
    // organización, no una tienda. Con el cliente scopeado, el guard hacía
    // inalcanzable la habilitación de plataforma en vez de protegerla.
    //
    // Contar sin scope es seguro aquí: `resolution_id` ya viene de la resolución
    // leída arriba CON scope, así que la fila está probada como propia del
    // llamador. El conteo no abre ninguna lectura que el scope no permitiera.
    const issued_invoices = await this.prisma.withoutScope().invoices.count({
      where: { resolution_id },
    });
    if (issued_invoices > 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_006,
        `La resolución ${resolution.prefix}${resolution.resolution_number} ya emitió ${issued_invoices} documento(s) reales, así que es una resolución de producción. Usa la resolución de habilitación que generó el portal DIAN.`,
        { resolution_id, issued_invoices },
      );
    }

    // Composition comes from the tenant's declared mode of operation. It used to
    // be a hardcoded 50 (30 FV + 10 ND + 10 NC) — the legacy 2019 habilitación
    // layout, which matches neither software propio (2+1+1) nor proveedor
    // tecnológico (6+2+2) under Res. 000165/2023, and burned 50 consecutives.
    const composition = resolveTestSetComposition(config.operation_mode);
    const TEST_SET_SIZE = testSetSize(composition);

    // The documents must consume FRESH numbers. Starting at `range_from`
    // (the old behaviour) meant a second run re-emitted the exact same numbers
    // and CUFEs, which DIAN rejects as duplicates. `current_number` is the last
    // number actually used, so the batch starts right after it.
    const next_number = Math.max(
      resolution.range_from,
      (resolution.current_number ?? 0) + 1,
    );
    if (next_number + TEST_SET_SIZE - 1 > resolution.range_to) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_003,
        `La resolución ${resolution.prefix}${resolution.resolution_number} solo tiene ${Math.max(0, resolution.range_to - next_number + 1)} números disponibles y el set de pruebas requiere ${TEST_SET_SIZE} (${describeComposition(composition)}).`,
        { resolution_id, next_number, range_to: resolution.range_to },
      );
    }

    // Reserve the block BEFORE building and signing the documents. Advancing
    // `current_number` afterwards would leave a window where the batch is
    // already in DIAN's hands but the numbers still look available, so a crash
    // or a retry would re-send numbering DIAN has — and DIAN rejects duplicated
    // numbering. Reserving first can only leave an unused gap in the range,
    // which is harmless; the reverse mistake is not recoverable.
    // `updateMany` (not `update`) so the guard on `current_number` makes the
    // reservation atomic: two concurrent runs cannot claim the same block.
    const reserved = await this.prisma.invoice_resolutions.updateMany({
      where: { id: resolution_id, current_number: resolution.current_number },
      data: { current_number: next_number + TEST_SET_SIZE - 1 },
    });
    if (reserved.count === 0) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_002,
        'Otro proceso está consumiendo la numeración de esta resolución. Espera a que termine y vuelve a intentarlo.',
        { dian_configuration_id: config_id, resolution_id },
      );
    }

    // 3. Resolve tenant context and the issuer's timezone up front: every date
    //    rendered into the XML below is a CIVIL date of the issuer, so it must be
    //    derived in their zone, never by serializing a UTC instant.
    const context = RequestContextService.getContext();
    if (!context) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No request context',
      );
    }
    const store_id = context.store_id;
    const timezone = store_id
      ? await resolveStoreTimezone(this.prisma, store_id)
      : DEFAULT_STORE_TIMEZONE;

    // DIAN InvoiceControl (sts:DianExtensions/InvoiceControl) — populated from the
    // numbering-resolution row so the AuthorizedInvoices range and authorization
    // period rendered in the XML are the real habilitación values, not empty.
    // The validity range is a civil date range: `toISOString()` would shift it a
    // day whenever the stored instant falls before the zone's UTC offset.
    const control = {
      invoice_authorization: resolution.resolution_number,
      authorization_start_date: localDateString(resolution.valid_from, timezone),
      authorization_end_date: localDateString(resolution.valid_to, timezone),
      prefix: resolution.prefix,
      range_from: String(resolution.range_from),
      range_to: String(resolution.range_to),
    };

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
    if (!config.certificate_s3_key || !cert_password) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_001,
        'DIAN test set requires the fiscal entity certificate before generating signed XML.',
        { dian_configuration_id: config_id },
      );
    }

    p12_buffer = await this.s3_service.downloadImage(
      config.certificate_s3_key,
    );

    // 4b. Extract WS-Security credentials from certificate
    let ws_credentials: WsSecurityCredentials | undefined;
    if (p12_buffer && cert_password) {
      try {
        ws_credentials = this.xml_signer.buildWsCredentials(
          p12_buffer,
          cert_password,
          config.certificate_kms_key_id,
        );
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

    // 6. Generate the documents
    const files: { name: string; content: string }[] = [];
    const invoice_cufes: { number: string; cufe: string; date: string }[] = [];
    // Evidence persisted alongside the batch. Without the document key there is
    // no way to ask DIAN about an individual document later, which is exactly
    // what left a stalled batch undiagnosable: the ZipKey only answers "did you
    // process my package?", never "does this document exist in your records?".
    const documents: {
      number: string;
      cufe: string;
      kind: DianDocumentKind;
      file_name: string;
      issue_date: string;
      issue_time: string;
    }[] = [];
    // Emission timestamp MUST be the issuer's civil wall clock, not UTC. The
    // previous code took the UTC clock and appended a literal `-05:00`, so every
    // document declared an instant five hours in the future — and between 00:00Z
    // and 05:00Z the date rolled a day ahead of Colombia as well. That value
    // feeds both the UBL and the CUFE, so a wrong clock invalidates the whole
    // document. Offset and time now come from the same conversion.
    const issued_at = new Date();
    const today = localDateString(issued_at, timezone);
    const time_now = localTimeString(issued_at, timezone);

    // Numbering blocks: invoices first, then debit notes, then credit notes.
    // Derived from the composition so the three loops cannot overlap when the
    // mode changes the counts.
    const debit_note_offset = composition.invoices;
    const credit_note_offset = composition.invoices + composition.debit_notes;

    // 6a. Generate the invoices required by the mode
    for (let i = 0; i < composition.invoices; i++) {
      const invoice_number = `${resolution.prefix}${next_number + i}`;
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
        issue_time: time_now,
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
        control,
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

      const invoice_file = buildDianXmlFileName(
        'invoice',
        config.nit,
        next_number + i,
      );
      files.push({ name: invoice_file, content: xml });
      invoice_cufes.push({ number: invoice_number, cufe, date: today });
      documents.push({
        number: invoice_number,
        cufe,
        kind: 'invoice',
        file_name: invoice_file,
        issue_date: today,
        issue_time: time_now,
      });
    }

    // 6b. Generate the debit notes, each referencing an invoice of this same set
    for (let i = 0; i < composition.debit_notes; i++) {
      const note_number = `${resolution.prefix}${next_number + debit_note_offset + i}`;
      // Modulo, not a fixed index: with 2 invoices and 1 note the old `[i]`
      // happened to work, but any mode with more notes than invoices would read
      // `undefined` and emit a note with no BillingReference.
      const ref_invoice = invoice_cufes[i % invoice_cufes.length];
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
        issue_time: time_now,
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
        control,
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

      const debit_file = buildDianXmlFileName(
        'debit_note',
        config.nit,
        next_number + debit_note_offset + i,
      );
      files.push({ name: debit_file, content: xml });
      documents.push({
        number: note_number,
        cufe: cude,
        kind: 'debit_note',
        file_name: debit_file,
        issue_date: today,
        issue_time: time_now,
      });
    }

    // 6c. Generate the credit notes, each referencing an invoice of this same set
    for (let i = 0; i < composition.credit_notes; i++) {
      const note_number = `${resolution.prefix}${next_number + credit_note_offset + i}`;
      // Offset by the debit notes so credit and debit notes do not both reference
      // the same invoice when the set is small.
      const ref_invoice =
        invoice_cufes[
          (composition.debit_notes + i) % invoice_cufes.length
        ];
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
        issue_time: time_now,
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
        control,
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

      const credit_file = buildDianXmlFileName(
        'credit_note',
        config.nit,
        next_number + credit_note_offset + i,
      );
      files.push({ name: credit_file, content: xml });
      documents.push({
        number: note_number,
        cufe: cude,
        kind: 'credit_note',
        file_name: credit_file,
        issue_date: today,
        issue_time: time_now,
      });
    }

    // 7. Build multi-file ZIP
    const zip_base64 = this.buildMultiFileZip(files);
    const zip_file_name = buildDianZipFileName(config.nit, next_number);

    // 8. Submit to DIAN. SendTestSetAsync is ASYNCHRONOUS: DIAN only returns a
    //    ZipKey acknowledgement here; the real validation verdict is obtained
    //    afterwards by polling GetStatusZip(ZipKey).
    const submit = await this.soap_client.sendTestSetAsync(
      zip_base64,
      zip_file_name,
      config.test_set_id,
      environment,
      ws_credentials,
    );

    const zip_key = submit.zip_key ?? null;

    // 9. Poll GetStatusZip for the verdict (bounded, so the synchronous HTTP
    //    request does not exceed the reverse-proxy timeout). If the set is still
    //    processing when the window closes, the persisted zip_key lets the
    //    GET :id/test-set-status endpoint re-poll without re-sending documents.
    const poll_history: TestSetPollAttempt[] = [];
    let verdict: DianSendBillResponse = submit;
    if (zip_key) {
      verdict = await this.pollTestSetStatus(
        zip_key,
        environment,
        ws_credentials,
        poll_history,
      );
    }

    const success = verdict.success;
    // A verdict is "still processing" ONLY when we never reached a terminal
    // state (no numeric StatusCode / fault / error list). A terminal non-success
    // (e.g. DIAN StatusCode 2 "set Rechazado") is a REJECTION, not pending.
    const terminal = zip_key ? this.isTerminalZipStatus(verdict) : true;
    const still_processing = !!zip_key && !success && !terminal;
    const rejected = !success && !still_processing;

    // 10. Persist result + raw evidence (DIAN's exact status XML for diagnosis).
    const result_data = {
      executed_at: new Date().toISOString(),
      total_documents: files.length,
      invoices: 30,
      debit_notes: 10,
      credit_notes: 10,
      zip_key,
      zip_file_name,
      resolution_id,
      number_from: next_number,
      number_to: next_number + TEST_SET_SIZE - 1,
      // The mode and composition the batch was built for. Without them, a
      // rejected set cannot be told apart from one sent with the wrong layout.
      operation_mode: config.operation_mode,
      composition,
      // Per-document evidence: number, document key, kind and the exact civil
      // timestamp used to derive the key. This is what makes GetStatus-by-CUFE
      // possible after the fact.
      timezone,
      issue_date: today,
      issue_time: time_now,
      documents,
      dian_response: {
        success: verdict.success,
        status_code: verdict.status_code,
        status_message: verdict.status_message,
        error_messages: verdict.error_messages ?? [],
        raw_response: verdict.raw_response?.slice(0, 12000),
      },
      poll_history,
      pending: still_processing,
      rejected,
      tracking_id: zip_key ?? verdict.status_code,
    };

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        last_test_result: result_data,
        enablement_status: success ? 'test_set_passed' : 'testing',
        enablement_evidence: success ? result_data : undefined,
      },
    });

    await this.createAuditLog(config.id, {
      action: 'run_test_set',
      // Tri-state: a batch DIAN has not judged yet is `pending`, not `error`.
      // Labelling it `error` made a perfectly healthy submission look broken.
      status: success ? 'success' : still_processing ? 'pending' : 'error',
      error_message: success
        ? null
        : still_processing
          ? `En validación en la DIAN (ZipKey ${zip_key}) tras ${poll_history.length} consultas.`
          : verdict.error_messages?.join(' | ') || verdict.status_message,
      // Total wall time of the whole operation (generate + sign + zip + send +
      // poll), not just the last SOAP round-trip, which made a ~35 s process
      // show up as "107ms" in the audit table.
      duration_ms: Date.now() - started_at,
    });

    const is_ws_security_error =
      submit.is_soap_fault === true &&
      submit.raw_response?.includes('InvalidSecurity');

    return {
      success,
      documents_generated: true,
      message: success
        ? 'Set de pruebas procesado y validado por la DIAN.'
        : is_ws_security_error
          ? '50 documentos generados y firmados. La DIAN rechazó la firma WS-Security del envelope SOAP.'
          : verdict.error_messages?.length
            ? `La DIAN reportó errores de validación: ${verdict.error_messages.join(' | ')}`
            : still_processing
              ? `Set recibido por la DIAN (ZipKey ${zip_key}); aún en proceso tras ${poll_history.length} consultas. Consulta GET :id/test-set-status en unos minutos.`
              : `Set de pruebas RECHAZADO por la DIAN: ${verdict.status_message}`,
      tracking_id: result_data.tracking_id,
      total_documents: 50,
      invoices_count: 30,
      debit_notes_count: 10,
      credit_notes_count: 10,
      environment,
      dian_status: verdict.status_code,
      error_messages: verdict.error_messages ?? [],
      zip_key,
      pending: still_processing,
      rejected,
      wait: analyzeTestSetWait(result_data),
      executed_at: result_data.executed_at,
      number_from: next_number,
      number_to: next_number + TEST_SET_SIZE - 1,
      enablement_status: success ? 'test_set_passed' : 'testing',
      response_time_ms: Date.now() - started_at,
    };
  }

  /**
   * Re-polls GetStatusZip for a previously submitted test set using the stored
   * ZipKey. Lets the caller resolve a verdict that was still "in process" when
   * run-test-set returned — WITHOUT re-sending the 50 documents (which would
   * burn resolution numbers). Updates last_test_result / enablement_status.
   */
  async checkTestSetStatus(config_id: number) {
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    const zip_key: string | null = previous.zip_key ?? null;

    if (!zip_key) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'No hay un ZipKey de set de pruebas registrado. Ejecuta primero run-test-set.',
      );
    }

    const ws_credentials = await this.loadWsCredentials(config);

    const poll_history: TestSetPollAttempt[] = [];
    const verdict = await this.pollTestSetStatus(
      zip_key,
      environment,
      ws_credentials,
      poll_history,
    );

    const success = verdict.success;
    // Terminal non-success (real StatusCode / fault / errors) == rejected, not pending.
    const still_processing = !success && !this.isTerminalZipStatus(verdict);
    const rejected = !success && !still_processing;

    const result_data = {
      ...previous,
      rechecked_at: new Date().toISOString(),
      zip_key,
      dian_response: {
        success: verdict.success,
        status_code: verdict.status_code,
        status_message: verdict.status_message,
        error_messages: verdict.error_messages ?? [],
        raw_response: verdict.raw_response?.slice(0, 12000),
      },
      poll_history,
      pending: still_processing,
      rejected,
    };

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: {
        last_test_result: result_data,
        // Only ever promote enablement_status; never demote a passed set.
        enablement_status: success
          ? 'test_set_passed'
          : config.enablement_status,
        // Only write evidence on success; leave the prior value untouched otherwise.
        ...(success && { enablement_evidence: result_data }),
      },
    });

    const wait = analyzeTestSetWait(result_data);

    await this.createAuditLog(config.id, {
      action: 'check_test_set_status',
      status: success ? 'success' : still_processing ? 'pending' : 'error',
      error_message: success
        ? null
        : still_processing
          ? wait.reason ?? `Aún en validación en la DIAN (ZipKey ${zip_key}).`
          : verdict.error_messages?.join(' | ') || verdict.status_message,
      duration_ms: Date.now() - started_at,
    });

    return {
      success,
      pending: still_processing,
      rejected,
      zip_key,
      dian_status: verdict.status_code,
      status_message: verdict.status_message,
      error_messages: verdict.error_messages ?? [],
      poll_history,
      // Echo the submission metadata so the UI can render the full picture from
      // a single re-poll response instead of a second GET.
      executed_at: previous.executed_at ?? null,
      rechecked_at: result_data.rechecked_at,
      total_documents: previous.total_documents ?? null,
      invoices_count: previous.invoices ?? null,
      debit_notes_count: previous.debit_notes ?? null,
      credit_notes_count: previous.credit_notes ?? null,
      environment,
      enablement_status: success ? 'test_set_passed' : config.enablement_status,
      // Bounded reading of the wait, so the UI can stop offering "vuelve a
      // consultar" once that has demonstrably stopped working.
      wait,
      message: success
        ? 'La DIAN validó el set de pruebas. La habilitación quedó aprobada.'
        : still_processing
          ? wait.stalled
            ? 'La DIAN recibió el lote pero no emite veredicto. Seguir consultando no lo va a resolver: diagnostica por documento o descarta el lote y reenvía.'
            : 'La DIAN sigue validando el set de pruebas. Vuelve a consultar en unos minutos.'
          : `La DIAN rechazó el set de pruebas: ${verdict.status_message}`,
    };
  }

  /**
   * Per-document diagnosis of a submitted batch.
   *
   * `GetStatusZip` answers "did you process my package?" and nothing else — a
   * queued batch and a batch DIAN silently discarded look identical. Asking
   * `GetStatus` for an individual document key answers a different question:
   * "does this document exist in your records?". That is what separates
   * "still queued" from "never classified", which is undecidable from the
   * ZipKey alone.
   *
   * Read-only: never re-sends documents and never consumes numbering.
   */
  async getTestSetDocumentStatus(config_id: number, sample_size = 3) {
    const started_at = Date.now();
    const config = await this.getConfigById(config_id);
    const environment = config.environment as 'test' | 'production';

    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    if (!previous.zip_key) {
      throw new VendixHttpException(ErrorCodes.DIAN_TEST_SET_004);
    }

    const persisted: any[] = Array.isArray(previous.documents)
      ? previous.documents
      : [];
    if (!persisted.length) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_TEST_SET_005,
        `El set ${previous.zip_key} se envió antes de que se persistieran las claves de documento, así que no puede consultarse por CUFE.`,
        { dian_configuration_id: config_id, zip_key: previous.zip_key },
      );
    }

    // One document per kind: the batch is homogeneous within a kind, so three
    // probes answer the question without hammering DIAN with fifty round-trips.
    const sample: any[] = [];
    for (const kind of ['invoice', 'debit_note', 'credit_note']) {
      const first = persisted.find((doc) => doc.kind === kind);
      if (first) sample.push(first);
    }
    const probes = (sample.length ? sample : persisted).slice(0, sample_size);

    const ws_credentials = await this.loadWsCredentials(config);

    const documents: Array<Record<string, any>> = [];
    for (const doc of probes) {
      const status = await this.soap_client.getStatus(
        doc.cufe,
        environment,
        ws_credentials,
      );
      // Tri-state, never a plain boolean: DIAN answering "no verdict" about a
      // document it DOES know is a different fact from not knowing it at all.
      const has_verdict =
        status.has_dian_verdict === true ||
        (status.error_messages?.length ?? 0) > 0;
      documents.push({
        number: doc.number,
        kind: doc.kind,
        cufe: doc.cufe,
        file_name: doc.file_name ?? null,
        registered: has_verdict || status.success === true,
        status_code: status.status_code,
        status_message: status.status_message,
        error_messages: status.error_messages ?? [],
      });
    }

    const registered_count = documents.filter((d) => d.registered).length;

    await this.createAuditLog(config.id, {
      action: 'diagnose_test_set_documents',
      status: registered_count > 0 ? 'success' : 'pending',
      error_message:
        registered_count > 0
          ? null
          : `Ninguno de los ${documents.length} documentos consultados está registrado en la DIAN (ZipKey ${previous.zip_key}).`,
      duration_ms: Date.now() - started_at,
    });

    return {
      zip_key: previous.zip_key,
      environment,
      total_documents: persisted.length,
      sampled: documents.length,
      registered_count,
      // The actionable reading, so the UI does not have to re-derive it.
      verdict:
        registered_count === 0
          ? 'not_registered'
          : registered_count < documents.length
            ? 'partially_registered'
            : 'registered',
      documents,
      response_time_ms: Date.now() - started_at,
    };
  }

  /**
   * Marks a batch DIAN never judged as abandoned, releasing the re-send guard.
   *
   * `DIAN_TEST_SET_002` exists to stop accidental double submissions, not to
   * leave a configuration permanently stuck: a batch that never gets a verdict
   * would otherwise require editing `last_test_result` by hand in the database.
   * The discarded ZipKey is preserved as history so the abandonment is auditable.
   */
  async abandonTestSet(config_id: number) {
    const config = await this.getConfigById(config_id);
    const previous = (config.last_test_result ?? {}) as Record<string, any>;
    const zip_key: string | null = previous.zip_key ?? null;

    if (!zip_key) {
      throw new VendixHttpException(ErrorCodes.DIAN_TEST_SET_004);
    }

    const abandoned_batches = Array.isArray(previous.abandoned_batches)
      ? previous.abandoned_batches
      : [];

    const result_data = {
      ...previous,
      pending: false,
      abandoned: true,
      abandoned_at: new Date().toISOString(),
      abandoned_batches: [
        ...abandoned_batches,
        {
          zip_key,
          executed_at: previous.executed_at ?? null,
          number_from: previous.number_from ?? null,
          number_to: previous.number_to ?? null,
        },
      ],
    };

    await this.prisma.dian_configurations.update({
      where: { id: config_id },
      data: { last_test_result: result_data, enablement_status: 'testing' },
    });

    await this.createAuditLog(config.id, {
      action: 'abandon_test_set',
      status: 'success',
      error_message: `Lote ${zip_key} descartado sin veredicto de la DIAN; la configuración queda libre para reenviar.`,
    });

    return {
      abandoned: true,
      zip_key,
      message:
        'El lote anterior quedó descartado. Puedes ejecutar un nuevo set de pruebas.',
    };
  }

  /**
   * Polls GetStatusZip until DIAN returns a terminal verdict or the bounded
   * attempts are exhausted. Records each attempt in `poll_history`.
   */
  private async pollTestSetStatus(
    zip_key: string,
    environment: 'test' | 'production',
    ws_credentials: WsSecurityCredentials | undefined,
    poll_history: TestSetPollAttempt[],
  ): Promise<DianSendBillResponse> {
    const max_attempts = 6;
    const delay_ms = 5_000;
    let last: DianSendBillResponse | null = null;

    for (let attempt = 1; attempt <= max_attempts; attempt++) {
      // Give DIAN a moment to process the batch before each poll.
      await this.sleep(delay_ms);

      const status = await this.soap_client.getStatusZip(
        zip_key,
        environment,
        ws_credentials,
      );
      last = status;

      poll_history.push({
        attempt,
        status_code: status.status_code,
        status_message: status.status_message,
        success: status.success,
      });

      this.logger.log(
        `[DIAN test-set] GetStatusZip ${attempt}/${max_attempts} ` +
          `zipKey=${zip_key} status=${status.status_code} success=${status.success}`,
      );

      if (this.isTerminalZipStatus(status)) {
        return status;
      }
    }

    return last as DianSendBillResponse;
  }

  /**
   * A GetStatusZip response is terminal (batch processed) when DIAN returns a
   * numeric <b:StatusCode>, a SOAP fault, or a populated ErrorMessageList.
   * Otherwise the batch is still being processed and we keep polling.
   */
  private isTerminalZipStatus(status: DianSendBillResponse): boolean {
    if (status.is_soap_fault === true) return true;
    if ((status.error_messages?.length ?? 0) > 0) return true;
    // The parser already distinguishes a populated <b:StatusCode> from the
    // self-closing/nil one DIAN returns while the batch is queued, so trust that
    // flag instead of re-scraping the raw XML here.
    if (typeof status.has_dian_verdict === 'boolean') {
      return status.has_dian_verdict;
    }
    return /<b:StatusCode\b[^>]*>\s*\d+\s*<\/b:StatusCode>/.test(
      status.raw_response || '',
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      // Derived on read, never stored: `pending` + `executed_at` are the facts,
      // and a persisted "stalled" flag would go stale the moment DIAN answers.
      wait: analyzeTestSetWait(config.last_test_result),
      // Cuántos documentos y consecutivos implica un envío en ESTE modo de
      // operación. Sin esto la UI imprimía 50, la composición de 2019.
      composition: buildTestSetCompositionView(config.operation_mode),
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
