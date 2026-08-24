import { Injectable, Logger } from '@nestjs/common';
import * as zlib from 'zlib';
import { DOMParser } from '@xmldom/xmldom';
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
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
  TECHNICAL_KEY_LENGTHS,
  TECHNICAL_KEY_LENGTHS_LABEL,
} from '../../fiscal-document-requirements';
import {
  buildDianXmlFileName,
  buildDianZipFileName,
  consecutiveFromDocumentNumber,
  softwareCodeForOperationMode,
  DianDocumentKind,
} from '../../utils/dian-file-naming.util';
import {
  dianAmount,
  dianLineExtensionTotal,
  dianSum,
} from '../../utils/dian-money.util';
import { dianPartyId, onlyDigits } from '../../../../../common/utils/nit.util';
import { resolveIssuerFiscalIdentity } from '../../utils/fiscal-issuer.util';
import { DianSoapClient, WsSecurityCredentials } from './dian-soap.client';
import { DianXmlSignerService } from './dian-xml-signer.service';
import { DianResponseParserService } from './dian-response-parser.service';
import {
  certificateNitMatches,
  normalizeNitDigits,
} from '../../dian-config/certificates/nit-match.util';
import { UblInvoiceBuilder } from './xml/ubl-invoice.builder';
import { UblCreditNoteBuilder } from './xml/ubl-credit-note.builder';
import { UblDebitNoteBuilder } from './xml/ubl-debit-note.builder';
import { UblSupportDocumentBuilder } from './xml/ubl-support-document.builder';
import { UblEquivalentDocumentBuilder } from './xml/ubl-equivalent-document.builder';
import {
  UblCommonBuilder,
  DianDocumentExtras,
} from './xml/ubl-common.builder';
import {
  UblApplicationResponseBuilder,
  DianEventParty,
} from './xml/ubl-application-response.builder';
import {
  DIAN_DOCUMENT_TYPES,
  DIAN_ID_TYPES,
} from './constants/dian-document-types';
import { DIAN_TAX_CODES } from './constants/dian-tax-codes';
import { UBL_NAMESPACES } from './xml/xml-namespaces';
import {
  UblStructureValidator,
  summarizeUblViolations,
} from './xml/ubl-structure.validator';
import {
  DianTotalsValidator,
  summarizeDianTotalsViolations,
} from './xml/dian-totals.validator';
import {
  DianConfigDecrypted,
  DianIssuerData,
  DianCustomerData,
} from './interfaces/dian-config.interface';
import {
  AcquirerAddressCandidate,
  ResolvedAcquirerAddress,
  resolveAcquirerAddress,
} from './acquirer-address.resolver';
import {
  DianDocumentEventRequest,
  DianDocumentEventResult,
} from './interfaces/dian-event.interface';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  DIAN_FINAL_CONSUMER_NAME,
  DIAN_FINAL_CONSUMER_TYPE_CODE,
} from '../../validators/customer-fiscal-identity.validator';
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
 * `NumAdq` del consumidor final (Anexo Técnico 1.9 §11.2).
 *
 * Ya NO se declara acá: se re-exporta desde
 * `validators/customer-fiscal-identity.validator.ts`, que es donde vive el
 * contrato del adquiriente. Existía una copia local del literal y eso es
 * exactamente lo que permite que el validador y el emisor discrepen sobre qué
 * cuenta como «consumidor final». Un solo literal, un solo dueño.
 */
const DIAN_FINAL_CONSUMER_ID = DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER;

/**
 * Literal de tipo de documento del consumidor final ('CC'), DERIVADO del código
 * que fija el contrato (`DIAN_FINAL_CONSUMER_TYPE_CODE` = '13').
 *
 * `buildCustomerData` guarda el LITERAL y el builder lo traduce con
 * `DIAN_ID_TYPES`; escribir `'CC'` a mano acá dejaría dos sitios que tendrían que
 * moverse juntos. Derivándolo, si el contrato cambia el código, el literal sigue.
 */
const DIAN_FINAL_CONSUMER_TYPE_LITERAL =
  Object.keys(DIAN_ID_TYPES).find(
    (literal) => DIAN_ID_TYPES[literal] === DIAN_FINAL_CONSUMER_TYPE_CODE,
  ) ?? 'CC';

/**
 * Papel que juega en el documento la parte que `buildCustomerData` arma.
 *
 * No es cosmético: decide si «Consumidor Final» es una respuesta legítima.
 * - `adquiriente` — comprador de una factura, nota o documento equivalente. Un
 *   comprador de mostrador que no se identifica ES un caso válido y se declara
 *   con el `222222222222` oficial.
 * - `vendedor_documento_soporte` — el TERCERO NO OBLIGADO A FACTURAR de un
 *   documento soporte (o su nota de ajuste). Acá el `222222222222` no significa
 *   nada: el documento soporte existe precisamente para identificar a quién se le
 *   compró. Sin identificación no hay documento soporte que emitir.
 */
type DianCustomerRole = 'adquiriente' | 'vendedor_documento_soporte';

/** `Node.ELEMENT_NODE`. La constante DOM no existe en el runtime de Node. */
const XML_ELEMENT_NODE = 1;

/**
 * Los valores que ENTRARON al hash de la clave del documento, para contrastarlos
 * contra el XML que se va a transmitir. Nombres del Anexo §11.2, no del código:
 * el objetivo es poder leer una divergencia y saber qué campo de la fórmula la
 * produjo sin traducir mentalmente.
 */
interface DocumentKeyHashInputs {
  /** `NumFac` */
  invoice_number: string;
  /** `FecFac` */
  issue_date: string;
  /** `HorFac` */
  issue_time: string;
  /** `ValFac` */
  total_before_tax: string;
  /** `ValImp1` (esquema 01) */
  tax_iva: string;
  /** `ValImp2` (esquema 04) */
  tax_inc: string;
  /** `ValImp3` (esquema 03) */
  tax_ica: string;
  /** `ValTot` */
  total_amount: string;
  /** `NitOFE` */
  issuer_nit: string;
  /** Tipo de identificación con el que se normalizó `NitOFE`. */
  issuer_document_type: string;
  /** `NumAdq` */
  customer_nit: string;
  /** Tipo de identificación con el que se normalizó `NumAdq`. */
  customer_document_type: string;
}

interface DocumentKeyAssertionParams {
  /** Etiqueta legible del documento, para el mensaje de error. */
  document_label: string;
  /** XML ya construido, ANTES de firmar y de transmitir. */
  xml: string;
  /**
   * Grupo de totales que este tipo de documento emite. La nota débito publica
   * `cac:RequestedMonetaryTotal`; todos los demás, `cac:LegalMonetaryTotal`.
   */
  monetary_total_element: 'LegalMonetaryTotal' | 'RequestedMonetaryTotal';
  /**
   * El documento soporte invierte los papeles: quien firma es el ADQUIRIENTE, así
   * que el XML pone al vendedor no obligado en `cac:AccountingSupplierParty` y al
   * emisor del documento en `cac:AccountingCustomerParty`. El hash, en cambio,
   * sigue llamando `NitFE` al que genera el documento. Sin este interruptor la
   * aserción compararía emisor contra vendedor y abortaría toda emisión válida.
   */
  parties_swapped?: boolean;
  hashed: DocumentKeyHashInputs;
}

interface DocumentKeyDivergence {
  field: string;
  hashed_value: string;
  xml_value: string;
}

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

  /**
   * `DianDocumentExtras` amplía el parámetro con el tipo de operación (AIU),
   * la tasa de cambio y las retenciones. Todos sus campos son opcionales, así
   * que un `ProviderInvoiceData` pelado sigue siendo asignable: ningún llamador
   * existente cambia, y el contrato de `InvoiceProviderAdapter` se satisface.
   */
  async sendInvoice(
    invoice_data: ProviderInvoiceData & DianDocumentExtras,
  ): Promise<ProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadConfig();

    // Validate certificate is not expired before attempting to send
    this.validateCertificateExpiry(config);

    try {
      // Build issuer data from the fiscal accounting entity.
      const issuer = await this.loadIssuerData(config);

      // Build customer data
      const customer = await this.buildCustomerData(invoice_data, 'adquiriente', {
        issuer,
        config,
      });

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

      // ValImp1/2/3 por ESQUEMA DIAN, con el mismo criterio que el XML — ver
      // `calculateTaxAmounts`. Antes se clasificaba acá por `tax_name`, en el XML
      // por `tax_type`, y bastaba un impuesto con nombre libre para que el hash y
      // el documento repartieran los importes en casillas distintas.
      const taxes = this.calculateTaxAmounts(invoice_data);

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
      //
      // `normalizeTechnicalKey`, no `.trim()`: el CUFE hashea el LITERAL de la
      // ClTec. Un hexadecimal es el mismo VALOR en mayúscula o minúscula, pero no
      // la misma CADENA, y la DIAN la emite en minúscula (vector oficial §11.2).
      // Una fila guardada en mayúscula —legado, anterior a la validación del DTO—
      // produce un hash que la DIAN no reproduce: el mismo fallo que ya quemó un
      // consecutivo en producción, por otra puerta.
      const technical_key = normalizeTechnicalKey(invoice_data.technical_key);
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

      // Último control de forma antes de firmar y transmitir. La ClTec es la ÚNICA
      // entrada del hash que el XML NO transporta, así que la DIAN es el primer
      // sistema capaz de notar que está mal — y para entonces el consecutivo ya se
      // gastó y no se recupera. En producción se guardó una de 38 caracteres (dos
      // perdidos al copiarla del PDF): pasaba el "no está vacía" sin problema.
      //
      // Ni el mensaje ni `details` llevan el valor, solo su longitud: la ClTec es
      // un secreto fiscal y los errores viajan a logs y al cliente.
      if (!isWellFormedTechnicalKey(technical_key)) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_RESOLUTION_011,
          `La clave técnica (ClTec) de la resolución tiene ${technical_key.length} ` +
            `caracteres y la DIAN la emite con ${TECHNICAL_KEY_LENGTHS_LABEL} ` +
            `dígitos hexadecimales. No se transmite la factura ${invoice_data.invoice_number}: ` +
            `una ClTec incompleta produce un CUFE que la DIAN rechaza gastando el ` +
            `consecutivo autorizado. Corrígela en Facturación → Resoluciones, ` +
            `copiándola completa del PDF de la Autorización de Numeración.`,
          {
            document_number: invoice_data.invoice_number,
            technical_key_length: technical_key.length,
            expected_lengths: [...TECHNICAL_KEY_LENGTHS],
          },
        );
      }

      // ValFac must be the SAME number the XML publishes as
      // `LegalMonetaryTotal/LineExtensionAmount`, because the DIAN recomputes the
      // CUFE from the XML. Both come from `dianLineExtensionTotal` so they cannot
      // drift: passing `subtotal_amount` here would hash the GROSS subtotal while
      // the document declares the NET one on any invoice carrying a discount.
      const line_extension_total = dianLineExtensionTotal(invoice_data.items);

      // La hora se resuelve UNA vez y viaja al builder. Cada builder tiene su
      // propio respaldo cuando `issue_time` llega vacío —la hora de reloj de
      // AHORA— mientras el hash usa la medianoche de la fecha de emisión: dos
      // instantes distintos para el mismo documento, y un CUFE que la DIAN no
      // puede reproducir. Fijarla acá hace esa divergencia irrepresentable.
      const issue_time = this.issueTime(invoice_data);
      // Tipado con los extras: sin ellos el objeto los transportaba en runtime
      // pero el tipo los ocultaba, y el builder no podía leerlos sin un cast.
      const xml_invoice_data: ProviderInvoiceData & DianDocumentExtras = {
        ...invoice_data,
        issue_time,
      };

      const key_inputs = this.buildKeyInputs({
        document_data: invoice_data,
        issue_time,
        total_before_tax: line_extension_total,
        taxes,
        issuer,
        customer,
      });

      // Calculate CUFE
      const cufe = CufeCalculator.generate({
        ...key_inputs,
        technical_key,
        environment: config.environment === 'production' ? '1' : '2',
      });

      // Build UBL XML. `invoice_type_code` carries contingency through: a
      // document expedited under DIAN unavailability must declare '04' on its
      // later transmission, keeping the same prefix and number (Anexo §12.2).
      const xml = UblInvoiceBuilder.build({
        invoice_data: xml_invoice_data,
        issuer,
        customer,
        software_security,
        cufe,
        environment: config.environment,
        control: invoice_data.control,
        invoice_type_code: invoice_data.contingency_type
          ? DIAN_DOCUMENT_TYPES.CONTINGENCY_DIAN_INVOICE
          : undefined,
      });

      this.assertDocumentKeyMatchesXml({
        document_label: 'factura electrónica de venta',
        xml,
        monetary_total_element: 'LegalMonetaryTotal',
        hashed: key_inputs,
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

      // Contenido completo del QR (§11.7), no solo la URL: son las mismas cifras
      // e identificaciones que entraron al hash, así que la cara visible del
      // documento no puede mostrar algo distinto de lo que la DIAN validó.
      const qr_code = CufeCalculator.buildQrContent({
        ...key_inputs,
        document_key: parsed.document_key || cufe,
        environment: config.environment === 'production' ? '1' : '2',
      });

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
          // Escalón de la cascada del que salió la dirección declarada para el
          // adquiriente ('fiscal' | 'shipping' | 'store'). Sube para que la
          // pantalla de confirmación pueda decirle al usuario CON QUÉ domicilio
          // se emitió: un respaldo silencioso es lo que produjo el defecto que
          // esta cascada cierra.
          acquirer_address_source: customer.address_source ?? null,
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
      const customer = await this.buildCustomerData(
        credit_note_data,
        'adquiriente',
        { issuer, config },
      );

      const software_security = {
        software_id: config.software_id,
        software_pin: config.software_pin,
        software_security_code: UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          config.software_pin,
          credit_note_data.invoice_number,
        ),
      };

      const taxes = this.calculateTaxAmounts(credit_note_data);

      // Same rule as the invoice: the hashed base must equal the base the XML
      // declares, so both derive from `dianLineExtensionTotal`.
      const cn_line_extension_total = dianLineExtensionTotal(
        credit_note_data.items,
      );

      const issue_time = this.issueTime(credit_note_data);
      const xml_credit_note_data: ProviderInvoiceData = {
        ...credit_note_data,
        issue_time,
      };

      const key_inputs = this.buildKeyInputs({
        document_data: credit_note_data,
        issue_time,
        total_before_tax: cn_line_extension_total,
        taxes,
        issuer,
        customer,
      });

      // For credit notes, generate CUDE (same algorithm as CUFE, ClTec replaced
      // by the software PIN per Anexo §11.4)
      const cude = CufeCalculator.generate({
        ...key_inputs,
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });

      this.assertOriginalInvoiceReference(credit_note_data, 'credit note');

      const xml = UblCreditNoteBuilder.build({
        credit_note_data: xml_credit_note_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        control: credit_note_data.control,
        original_invoice_number:
          credit_note_data.original_invoice_number ||
          credit_note_data.order_reference,
        original_invoice_cufe: credit_note_data.original_invoice_cufe,
        original_invoice_date: credit_note_data.original_invoice_issue_date,
      });

      this.assertDocumentKeyMatchesXml({
        document_label: 'nota crédito',
        xml,
        monetary_total_element: 'LegalMonetaryTotal',
        hashed: key_inputs,
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
        qr_code: CufeCalculator.buildQrContent({
          ...key_inputs,
          document_key: parsed.document_key || cude,
          environment: config.environment === 'production' ? '1' : '2',
        }),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Nota crédito aceptada por la DIAN'
          : `Nota crédito rechazada: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_errors: parsed.errors,
          environment: config.environment,
          // Escalón de la cascada del que salió la dirección declarada para el
          // adquiriente ('fiscal' | 'shipping' | 'store'). Sube para que la
          // pantalla de confirmación pueda decirle al usuario CON QUÉ domicilio
          // se emitió: un respaldo silencioso es lo que produjo el defecto que
          // esta cascada cierra.
          acquirer_address_source: customer.address_source ?? null,
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
      const customer = await this.buildCustomerData(
        debit_note_data,
        'adquiriente',
        { issuer, config },
      );
      const software_security = {
        software_id: config.software_id,
        software_pin: config.software_pin,
        software_security_code: UblCommonBuilder.generateSoftwareSecurityCode(
          config.software_id,
          config.software_pin,
          debit_note_data.invoice_number,
        ),
      };

      const taxes = this.calculateTaxAmounts(debit_note_data);

      const issue_time = this.issueTime(debit_note_data);
      const xml_debit_note_data: ProviderInvoiceData = {
        ...debit_note_data,
        issue_time,
      };

      const key_inputs = this.buildKeyInputs({
        document_data: debit_note_data,
        issue_time,
        total_before_tax: dianLineExtensionTotal(debit_note_data.items),
        taxes,
        issuer,
        customer,
      });

      const cude = CufeCalculator.generate({
        ...key_inputs,
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });

      this.assertOriginalInvoiceReference(debit_note_data, 'debit note');

      const xml = UblDebitNoteBuilder.build({
        debit_note_data: xml_debit_note_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        control: debit_note_data.control,
        original_invoice_number:
          debit_note_data.original_invoice_number ||
          debit_note_data.order_reference,
        original_invoice_cufe: debit_note_data.original_invoice_cufe,
        original_invoice_date: debit_note_data.original_invoice_issue_date,
      });

      // `RequestedMonetaryTotal`, no `LegalMonetaryTotal`: la nota débito es el
      // único documento que publica sus totales bajo ese grupo (ver
      // `UblCommonBuilder.buildMonetaryTotal`).
      this.assertDocumentKeyMatchesXml({
        document_label: 'nota débito',
        xml,
        monetary_total_element: 'RequestedMonetaryTotal',
        hashed: key_inputs,
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
        qr_code: CufeCalculator.buildQrContent({
          ...key_inputs,
          document_key: parsed.document_key || cude,
          environment: config.environment === 'production' ? '1' : '2',
        }),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Nota débito aceptada por la DIAN'
          : `Nota débito rechazada: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_errors: parsed.errors,
          environment: config.environment,
          // Escalón de la cascada del que salió la dirección declarada para el
          // adquiriente ('fiscal' | 'shipping' | 'store'). Sube para que la
          // pantalla de confirmación pueda decirle al usuario CON QUÉ domicilio
          // se emitió: un respaldo silencioso es lo que produjo el defecto que
          // esta cascada cierra.
          acquirer_address_source: customer.address_source ?? null,
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
      // SIN respaldo de dirección a propósito: la contraparte de un documento
      // soporte es un TERCERO, y `buyer` es NUESTRA propia empresa. Ver el
      // JSDoc de `buildCustomerData`.
      const seller = await this.buildCustomerData(support_document_data);
      const software_security = this.buildSoftwareSecurity(
        config,
        support_document_data.invoice_number,
      );
      const taxes = this.calculateTaxAmounts(support_document_data);

      const issue_time = this.issueTime(support_document_data);
      const xml_support_document_data: ProviderInvoiceData = {
        ...support_document_data,
        issue_time,
      };

      // `NitFE` del documento soporte es el ADQUIRIENTE —quien lo expide— y
      // `NumAdq` el vendedor no obligado a facturar. Por eso `issuer` acá es el
      // comprador (`buyer`) y `customer` el vendedor (`seller`): los nombres del
      // hash y los del XML apuntan a partes opuestas en este único documento.
      const key_inputs = this.buildKeyInputs({
        document_data: support_document_data,
        issue_time,
        total_before_tax: dianLineExtensionTotal(support_document_data.items),
        taxes,
        issuer: buyer,
        customer: seller,
      });

      // 14º campo del CUDS = **Software-PIN**, SIEMPRE. El documento soporte tiene
      // rango autorizado propio pero NO clave técnica: así lo declara el contrato
      // único (`FISCAL_DOCUMENT_REQUIREMENTS.support_document`,
      // `accepts_technical_key: false`, `key_algorithm: 'CUDS'`), y así lo hace ya
      // su nota de ajuste unas líneas más abajo.
      //
      // Antes esto era `support_document_data.technical_key || config.software_pin`.
      // El `||` no era inofensivo: la fila de resolución del documento soporte SÍ
      // llegaba con ClTec sembrada, así que el documento se hasheaba con la clave
      // equivocada y la DIAN lo rechazaba sin explicar por qué —el XML no
      // transporta ese campo, de modo que nada aguas arriba podía notarlo—, con el
      // consecutivo autorizado ya consumido.
      const cuds = CufeCalculator.generate({
        ...key_inputs,
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });
      const xml = UblSupportDocumentBuilder.buildDocument({
        support_document_data: xml_support_document_data,
        buyer,
        seller,
        software_security,
        cuds,
        environment: config.environment,
      });

      this.assertDocumentKeyMatchesXml({
        document_label: 'documento soporte',
        xml,
        monetary_total_element: 'LegalMonetaryTotal',
        parties_swapped: true,
        hashed: key_inputs,
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
        qr_code: CufeCalculator.buildQrContent({
          ...key_inputs,
          document_key: parsed.document_key || cuds,
          environment: config.environment === 'production' ? '1' : '2',
        }),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Documento soporte aceptado por la DIAN'
          : `Documento soporte rechazado: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_status_description: parsed.status_description,
          dian_errors: parsed.errors,
          environment: config.environment,
          // Escalón de la cascada del que salió la dirección declarada para el
          // adquiriente ('fiscal' | 'shipping' | 'store'). Sube para que la
          // pantalla de confirmación pueda decirle al usuario CON QUÉ domicilio
          // se emitió: un respaldo silencioso es lo que produjo el defecto que
          // esta cascada cierra.
          acquirer_address_source: seller.address_source ?? null,
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
      // SIN respaldo de dirección — misma razón que en `sendSupportDocument`.
      const seller = await this.buildCustomerData(support_adjustment_data);
      const software_security = this.buildSoftwareSecurity(
        config,
        support_adjustment_data.invoice_number,
      );
      const taxes = this.calculateTaxAmounts(support_adjustment_data);

      const issue_time = this.issueTime(support_adjustment_data);
      const xml_support_adjustment_data: ProviderInvoiceData = {
        ...support_adjustment_data,
        issue_time,
      };

      // Mismos papeles invertidos que el documento soporte que ajusta.
      const key_inputs = this.buildKeyInputs({
        document_data: support_adjustment_data,
        issue_time,
        total_before_tax: dianLineExtensionTotal(support_adjustment_data.items),
        taxes,
        issuer: buyer,
        customer: seller,
      });

      const cuds = CufeCalculator.generate({
        ...key_inputs,
        technical_key: config.software_pin,
        environment: config.environment === 'production' ? '1' : '2',
      });

      this.assertOriginalSupportDocumentReference(support_adjustment_data);

      const xml = UblSupportDocumentBuilder.buildAdjustmentNote({
        support_adjustment_data: xml_support_adjustment_data,
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

      this.assertDocumentKeyMatchesXml({
        document_label: 'nota de ajuste de documento soporte',
        xml,
        monetary_total_element: 'LegalMonetaryTotal',
        parties_swapped: true,
        hashed: key_inputs,
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
        qr_code: CufeCalculator.buildQrContent({
          ...key_inputs,
          document_key: parsed.document_key || cuds,
          environment: config.environment === 'production' ? '1' : '2',
        }),
        xml_document: signed_xml,
        message: parsed.is_valid
          ? 'Nota de ajuste de documento soporte aceptada por la DIAN'
          : `Nota de ajuste de documento soporte rechazada: ${parsed.errors.map((e) => e.message).join(', ')}`,
        provider_data: {
          dian_status_code: parsed.status_code,
          dian_status_description: parsed.status_description,
          dian_errors: parsed.errors,
          environment: config.environment,
          // Escalón de la cascada del que salió la dirección declarada para el
          // adquiriente ('fiscal' | 'shipping' | 'store'). Sube para que la
          // pantalla de confirmación pueda decirle al usuario CON QUÉ domicilio
          // se emitió: un respaldo silencioso es lo que produjo el defecto que
          // esta cascada cierra.
          acquirer_address_source: seller.address_source ?? null,
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
      const customer = await this.buildCustomerData(
        document_data,
        'adquiriente',
        { issuer, config },
      );
      const software_security = this.buildSoftwareSecurity(
        config,
        document_data.invoice_number,
      );
      const taxes = this.calculateTaxAmounts(document_data);

      const issue_time = this.issueTime(document_data);
      const xml_document_data: ProviderInvoiceData = {
        ...document_data,
        issue_time,
      };

      // ValFac must be the number the XML publishes as `LineExtensionAmount`, the
      // same invariant `sendInvoice` documents: the DIAN recomputes the key from
      // the XML, so hashing `subtotal_amount` would diverge on any discount.
      const key_inputs = this.buildKeyInputs({
        document_data,
        issue_time,
        total_before_tax: dianLineExtensionTotal(document_data.items),
        taxes,
        issuer,
        customer,
      });

      const cude = CufeCalculator.generateEquivalentDocumentCude({
        ...key_inputs,
        environment: config.environment === 'production' ? '1' : '2',
        software_pin: config.software_pin,
      });

      const xml = UblEquivalentDocumentBuilder.build({
        invoice_data: xml_document_data,
        issuer,
        customer,
        software_security,
        cude,
        environment: config.environment,
        control: document_data.control,
        document_type_code: options.document_type_code,
      });

      this.assertDocumentKeyMatchesXml({
        document_label: is_adjustment_note
          ? 'nota de ajuste al documento equivalente'
          : 'documento equivalente electrónico',
        xml,
        monetary_total_element: 'LegalMonetaryTotal',
        hashed: key_inputs,
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
        qr_code: CufeCalculator.buildQrContent({
          ...key_inputs,
          document_key: parsed.document_key || cude,
          environment: config.environment === 'production' ? '1' : '2',
        }),
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
          // Escalón de la cascada del que salió la dirección declarada para el
          // adquiriente ('fiscal' | 'shipping' | 'store'). Sube para que la
          // pantalla de confirmación pueda decirle al usuario CON QUÉ domicilio
          // se emitió: un respaldo silencioso es lo que produjo el defecto que
          // esta cascada cierra.
          acquirer_address_source: customer.address_source ?? null,
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
      customer_nit: receiver.document_number || DIAN_FINAL_CONSUMER_ID,
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

    // QUI-679 review fix #7: tras una rotación de cert, las filas herederas
    // (creadas con el cert de la fuente original) quedan con `certificate_*`
    // congelados al momento de la copia. Si el firmador lee una de esas
    // filas para una emisión, firma con un cert VIEJO. La solución completa
    // exige un campo "active cert owner" y resolverlo en cada loadConfig;
    // mientras tanto, registramos el caso en logs para que el equipo de
    // plataforma pueda auditarlo y emitir el ticket de seguimiento.
    //
    // Comparamos el `certificate_uploaded_at` de la fila cargada con el de
    // cualquier hermana del MISMO `accounting_entity_id` que también tenga
    // cert: si una hermana es más reciente, el cert activo vive allí y
    // esta fila está stale.
    if (config.certificate_s3_key && config.certificate_uploaded_at) {
      const newer_sibling = await this.prisma.dian_configurations.findFirst({
        where: {
          accounting_entity_id: config.accounting_entity_id,
          certificate_s3_key: { not: null },
          certificate_uploaded_at: { gt: config.certificate_uploaded_at },
          id: { not: config.id },
        },
        orderBy: { certificate_uploaded_at: 'desc' },
        select: {
          id: true,
          configuration_type: true,
          certificate_uploaded_at: true,
        },
      });
      if (newer_sibling) {
        this.logger.warn(
          `QUI-679: loadConfig() is reading a stale cert for dian_configuration_id=${config.id} ` +
            `(${configuration_type}); sibling dian_configuration_id=${newer_sibling.id} ` +
            `(${newer_sibling.configuration_type}) has a newer cert uploaded at ` +
            `${newer_sibling.certificate_uploaded_at?.toISOString()}. ` +
            `This emission may sign with outdated material; rotation tracking is on the roadmap.`,
        );
      }
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

  /**
   * `ValImp1` / `ValImp2` / `ValImp3` del CUFE/CUDE/CUDS, agrupados por el MISMO
   * criterio con el que el XML reparte sus `cac:TaxSubtotal`.
   *
   * Antes esto clasificaba por el NOMBRE del impuesto (`tax_name.includes('IVA')`)
   * mientras `UblCommonBuilder.buildTaxTotals` clasificaba por `tax_type`. Dos
   * criterios sobre el mismo dato: un impuesto tipado `inc` pero llamado «IVA
   * consumo», o uno tipado `iva` llamado «Impuesto sobre las ventas», cae en una
   * casilla en el hash y en otra en el documento. La DIAN recomputa la clave desde
   * el XML, obtiene otro hash y rechaza — con el consecutivo ya gastado.
   *
   * Se DELEGA en `UblCommonBuilder.resolveTaxCodeFromTax` en lugar de reimplementar
   * su tabla (incluido su respaldo por nombre y su caída final a IVA): cualquier
   * copia, por fiel que nazca, es la misma divergencia esperando turno.
   *
   * La suma es en espacio Decimal con truncamiento (`dianSum`) porque estos tres
   * valores se hashean: un centavo de deriva de punto flotante, o un medio centavo
   * redondeado, invalida la clave.
   */
  private calculateTaxAmounts(document_data: ProviderInvoiceData): {
    iva: string;
    ica: string;
    inc: string;
  } {
    const totalForScheme = (scheme_code: string): string =>
      dianSum(
        document_data.taxes
          .filter(
            (tax) => UblCommonBuilder.resolveTaxCodeFromTax(tax) === scheme_code,
          )
          .map((tax) => tax.tax_amount),
      );

    return {
      iva: totalForScheme(DIAN_TAX_CODES.IVA),
      ica: totalForScheme(DIAN_TAX_CODES.ICA),
      inc: totalForScheme(DIAN_TAX_CODES.INC),
    };
  }

  /**
   * Arma, en un solo sitio, los valores que entran al hash de la clave del
   * documento — y que la aserción previa a la transmisión vuelve a leer desde el
   * XML ya construido.
   *
   * Existe porque los seis flujos de emisión repetían la misma lista de catorce
   * campos con pequeñas variaciones, y cada copia era una oportunidad de que uno
   * de ellos se saneara distinto. Concretamente:
   *
   * - `NitOFE` se toma de `issuer.nit` (la fuente única de identidad fiscal), NO
   *   de `config.nit`: es exactamente la cadena que el XML publica en
   *   `cac:PartyTaxScheme/cbc:CompanyID`. Ambas ya están atadas por la aserción de
   *   identidad de `loadIssuerData`, pero `dian_configurations.nit` guarda formas
   *   heterogéneas en producción (con guion, con DV pegado, con DV vacío) y
   *   hashear la fila cruda dejaba abierta la única puerta que esa aserción no
   *   cierra: mismo NIT, distinta escritura.
   * - `NumAdq` se toma de `customer.document_number`, que es el mismo campo del
   *   que sale el `cbc:CompanyID` del adquiriente.
   * - Ambos pasan por `dianPartyId`, que recorta el DV SOLO cuando la parte
   *   declaró NIT. Con `onlyDigits` un NIT `900123456-7` se hasheaba como
   *   `9001234567` y la DIAN recomputaba con `900123456`: rechazo garantizado.
   */
  private buildKeyInputs(params: {
    document_data: ProviderInvoiceData;
    issue_time: string;
    total_before_tax: string;
    taxes: { iva: string; ica: string; inc: string };
    issuer: DianIssuerData;
    customer: DianCustomerData;
  }): DocumentKeyHashInputs {
    const { document_data, issuer, customer } = params;
    // Un OFE es siempre NIT (§11.2 lo llama NitOFE), pero se respeta el tipo que
    // resolvió la identidad fiscal si trae uno: recortarle un dígito a una parte
    // que NO es NIT produce la identificación de otra persona.
    const issuer_document_type = issuer.document_type || DIAN_ID_TYPES.NIT;

    return {
      invoice_number: document_data.invoice_number,
      issue_date: document_data.issue_date,
      issue_time: params.issue_time,
      total_before_tax: params.total_before_tax,
      tax_iva: params.taxes.iva,
      tax_inc: params.taxes.inc,
      tax_ica: params.taxes.ica,
      total_amount: document_data.total_amount,
      issuer_nit: dianPartyId(issuer.nit, issuer_document_type),
      issuer_document_type,
      customer_nit:
        dianPartyId(customer.document_number, customer.document_type) ||
        DIAN_FINAL_CONSUMER_ID,
      customer_document_type: customer.document_type,
    };
  }

  /**
   * RED DE SEGURIDAD PREVIA A LA TRANSMISIÓN — recomputa desde el XML ya
   * construido los valores que entraron al hash y aborta si alguno difiere.
   *
   * La DIAN recomputa el CUFE/CUDE/CUDS **leyendo el XML que recibe**. Si el hash
   * se armó con un valor y el documento declara otro, rechaza — y el consecutivo
   * autorizado ya se consumió, así que no se puede reintentar con el mismo número.
   * Toda corrección aguas arriba (identificaciones, clasificación de impuestos,
   * hora de emisión) elimina una causa conocida; esta aserción es lo que impide
   * que la PRÓXIMA, todavía desconocida, llegue a producción sin avisar.
   *
   * Réplica del patrón que `loadIssuerData` ya aplica al NIT del emisor: mismo
   * lugar del flujo (antes de firmar y de transmitir), misma forma de reportar
   * (nombrar el campo y AMBOS valores, y explicar la consecuencia). La diferencia
   * es el tipo de excepción: acá se lanza `VendixHttpException` con
   * `INVOICING_CUFE_001` (422) para que el flujo lo distinga de un fallo de
   * transporte y NO lo trate como contingencia.
   *
   * Fuera de comparación por definición: `ClTec` y `TipoAmbiente` entran al hash
   * pero NO viajan en el XML (§11.2). Derivarlos del documento sería inventarlos.
   */
  private assertDocumentKeyMatchesXml(params: DocumentKeyAssertionParams): void {
    const { hashed } = params;
    // `parseFromString` no lanza ante XML malformado: reporta por su errorHandler
    // y puede devolver un documento sin raíz. Por eso la comprobación explícita.
    const parsed_document = new DOMParser().parseFromString(
      params.xml,
      'text/xml',
    );
    const root: Element | null = parsed_document.documentElement ?? null;

    if (!root) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_CUFE_001,
        `No se pudo releer el XML del documento ${hashed.invoice_number} ` +
          `(${params.document_label}) para verificar que declara los mismos valores ` +
          `con los que se calculó su clave. Se aborta antes de transmitir: un ` +
          `documento cuya clave no se puede verificar quema el consecutivo si la ` +
          `DIAN lo rechaza.`,
        { document_number: hashed.invoice_number },
      );
    }

    const cbc = UBL_NAMESPACES.CBC;
    const cac = UBL_NAMESPACES.CAC;

    const [monetary_total] = this.directChildElements(
      root,
      cac,
      params.monetary_total_element,
    );
    const xml_taxes = this.taxAmountsByScheme(root);

    // El documento soporte firma al revés — ver `parties_swapped`.
    const xml_supplier_id = this.partyTaxSchemeCompanyId(
      root,
      'AccountingSupplierParty',
    );
    const xml_customer_id = this.partyTaxSchemeCompanyId(
      root,
      'AccountingCustomerParty',
    );
    const xml_issuer_id = params.parties_swapped
      ? xml_customer_id
      : xml_supplier_id;
    const xml_acquirer_id = params.parties_swapped
      ? xml_supplier_id
      : xml_customer_id;

    const divergences: DocumentKeyDivergence[] = [];
    const compare = (
      field: string,
      hashed_value: string,
      xml_value: string | null,
    ): void => {
      if (hashed_value !== (xml_value ?? '')) {
        divergences.push({
          field,
          hashed_value,
          xml_value: xml_value ?? '(ausente en el XML)',
        });
      }
    };

    compare(
      'NumFac',
      hashed.invoice_number,
      this.directChildText(root, cbc, 'ID'),
    );
    compare(
      'FecFac',
      hashed.issue_date,
      this.directChildText(root, cbc, 'IssueDate'),
    );
    compare(
      'HorFac',
      hashed.issue_time,
      this.directChildText(root, cbc, 'IssueTime'),
    );
    compare(
      'ValFac',
      dianAmount(hashed.total_before_tax),
      this.directChildText(monetary_total ?? null, cbc, 'LineExtensionAmount'),
    );
    compare(
      'ValImp1',
      dianAmount(hashed.tax_iva),
      xml_taxes(DIAN_TAX_CODES.IVA),
    );
    compare(
      'ValImp2',
      dianAmount(hashed.tax_inc),
      xml_taxes(DIAN_TAX_CODES.INC),
    );
    compare(
      'ValImp3',
      dianAmount(hashed.tax_ica),
      xml_taxes(DIAN_TAX_CODES.ICA),
    );
    compare(
      'ValTot',
      dianAmount(hashed.total_amount),
      this.directChildText(monetary_total ?? null, cbc, 'PayableAmount'),
    );
    // Las identificaciones se normalizan por el MISMO camino en los dos lados: el
    // XML publica el DV pegado (`900123456-7`) y el hash no, y eso no es una
    // divergencia sino la misma parte escrita en dos convenciones. Lo que sí lo
    // sería —otro número— sobrevive a la normalización.
    compare(
      'NitOFE',
      hashed.issuer_nit,
      xml_issuer_id === null
        ? null
        : dianPartyId(xml_issuer_id, hashed.issuer_document_type),
    );
    compare(
      'NumAdq',
      hashed.customer_nit,
      xml_acquirer_id === null
        ? null
        : dianPartyId(xml_acquirer_id, hashed.customer_document_type),
    );

    if (divergences.length === 0) return;

    const detail = divergences
      .map((d) => `${d.field}: clave='${d.hashed_value}' XML='${d.xml_value}'`)
      .join('; ');

    throw new VendixHttpException(
      ErrorCodes.INVOICING_CUFE_001,
      `La clave del documento ${hashed.invoice_number} (${params.document_label}) se ` +
        `calculó con valores que el XML no declara: ${detail}. La DIAN recomputa la ` +
        `clave leyendo el XML, así que obtendría otro hash y rechazaría el documento ` +
        `con el consecutivo ya consumido. Se aborta ANTES de firmar y transmitir.`,
      {
        document_number: hashed.invoice_number,
        divergences,
      },
    );
  }

  /**
   * `cac:{Supplier|Customer}Party/cac:Party/cac:PartyTaxScheme/cbc:CompanyID`.
   *
   * Se navega hijo a hijo en vez de `getElementsByTagName*`: `cbc:CompanyID`
   * aparece también bajo `cac:PartyLegalEntity`, y una búsqueda por descendientes
   * podría devolver el de otra parte del documento.
   */
  private partyTaxSchemeCompanyId(
    root: Element,
    party_element: 'AccountingSupplierParty' | 'AccountingCustomerParty',
  ): string | null {
    const cac = UBL_NAMESPACES.CAC;
    const [accounting_party] = this.directChildElements(
      root,
      cac,
      party_element,
    );
    if (!accounting_party) return null;
    const [party] = this.directChildElements(accounting_party, cac, 'Party');
    if (!party) return null;
    const [tax_scheme] = this.directChildElements(party, cac, 'PartyTaxScheme');
    if (!tax_scheme) return null;
    return this.directChildText(tax_scheme, UBL_NAMESPACES.CBC, 'CompanyID');
  }

  /**
   * Totales de impuesto por código de esquema DIAN leídos del `cac:TaxTotal` de
   * CABECERA (hijo directo de la raíz), que es el que la DIAN valida y el que
   * alimenta `ValImp1/2/3`. Las líneas emiten su propio `cac:TaxTotal` anidado;
   * sumarlas acá duplicaría los importes.
   *
   * Un esquema ausente del XML devuelve `'0.00'`, no `null`: el hash siempre lleva
   * las tres casillas, y «no hay ICA» y «ICA vale cero» son el mismo hecho.
   */
  private taxAmountsByScheme(root: Element): (scheme_code: string) => string {
    const cac = UBL_NAMESPACES.CAC;
    const cbc = UBL_NAMESPACES.CBC;
    const amounts_by_scheme = new Map<string, string[]>();

    for (const tax_total of this.directChildElements(root, cac, 'TaxTotal')) {
      for (const subtotal of this.directChildElements(
        tax_total,
        cac,
        'TaxSubtotal',
      )) {
        const [category] = this.directChildElements(
          subtotal,
          cac,
          'TaxCategory',
        );
        const [scheme] = category
          ? this.directChildElements(category, cac, 'TaxScheme')
          : [];
        const code = scheme ? this.directChildText(scheme, cbc, 'ID') : null;
        if (!code) continue;

        const amount = this.directChildText(subtotal, cbc, 'TaxAmount') ?? '0';
        amounts_by_scheme.set(code, [
          ...(amounts_by_scheme.get(code) ?? []),
          amount,
        ]);
      }
    }

    return (scheme_code: string) =>
      dianSum(amounts_by_scheme.get(scheme_code) ?? []);
  }

  /** Elementos hijos DIRECTOS de `parent` con ese namespace y nombre local. */
  private directChildElements(
    parent: Element,
    namespace: string,
    local_name: string,
  ): Element[] {
    const matches: Element[] = [];
    const children = parent.childNodes;
    for (let index = 0; index < children.length; index++) {
      const node: Node | null = children.item(index);
      if (!node || node.nodeType !== XML_ELEMENT_NODE) continue;
      const element = node as Element;
      if (
        element.localName === local_name &&
        element.namespaceURI === namespace
      ) {
        matches.push(element);
      }
    }
    return matches;
  }

  /**
   * Texto del primer hijo directo que coincida, o `null` si no existe. `null` y
   * cadena vacía NO son lo mismo acá: el primero dice «el XML no trae el campo» y
   * el segundo «lo trae vacío», y en un reporte de divergencia esa distinción es
   * la que dice si el builder omitió el elemento o si lo pobló mal.
   */
  private directChildText(
    parent: Element | null,
    namespace: string,
    local_name: string,
  ): string | null {
    if (!parent) return null;
    const [first] = this.directChildElements(parent, namespace, local_name);
    return first ? (first.textContent ?? '').trim() : null;
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
                // LA DIRECCIÓN FISCAL ES LA FILA `type='billing'`, NO LA PRIMARIA.
                //
                // Sin este filtro ganaba cualquier fila con `is_primary=true` y el
                // `id` más bajo. Medido en producción: la tienda 97 tiene DOS filas
                // con `is_primary=true` — una `store_physical` de `id` menor y
                // `municipality_code` NULL, y la `billing` con municipio '11001'—,
                // así que el desempate caía a `id asc`, se elegía la de despacho, el
                // municipio llegaba vacío y el resolvedor estricto abortaba la
                // emisión. `is_primary` significa «la principal para el usuario», no
                // «la fiscal»: son dos conceptos distintos que no siempre coinciden.
                //
                // Es el mismo criterio que ya aplicaba la ruta de habilitación en
                // `dian-test.service.ts`, donde el filtro sí estaba.
                where: { type: 'billing' },
                orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                take: 1,
              },
              organization_settings: true,
            },
          },
          store: {
            include: {
              addresses: {
                // LA DIRECCIÓN FISCAL ES LA FILA `type='billing'`, NO LA PRIMARIA.
                //
                // Sin este filtro ganaba cualquier fila con `is_primary=true` y el
                // `id` más bajo. Medido en producción: la tienda 97 tiene DOS filas
                // con `is_primary=true` — una `store_physical` de `id` menor y
                // `municipality_code` NULL, y la `billing` con municipio '11001'—,
                // así que el desempate caía a `id asc`, se elegía la de despacho, el
                // municipio llegaba vacío y el resolvedor estricto abortaba la
                // emisión. `is_primary` significa «la principal para el usuario», no
                // «la fiscal»: son dos conceptos distintos que no siempre coinciden.
                //
                // Es el mismo criterio que ya aplicaba la ruta de habilitación en
                // `dian-test.service.ts`, donde el filtro sí estaba.
                where: { type: 'billing' },
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
    const identity = resolveIssuerFiscalIdentity({
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

    // ASERCIÓN DE IDENTIDAD DEL EMISOR — un solo NIT en todo el documento.
    //
    // Hay DOS ejes que declaran el NIT emisor y no había nada que los atara:
    //
    //   dian_configurations.nit  ->  nombre del ZIP/XML entregado a la DIAN y
    //                                emparejamiento con el certificado
    //   identity.nit             ->  el XML y, desde `buildKeyInputs`, también el
    //                                hash de la clave (fuente única; el resolvedor
    //                                prefiere `fiscal_data.nit` sobre `config.nit`)
    //
    // Si divergen, el documento se entrega bajo un NIT y declara otro. El terreno
    // para que ocurra existe: en producción la organización de la plataforma tiene
    // tres filas en `dian_configurations`, dos de ellas con el NIT anterior, y una
    // guarda el NIT con guion y `nit_dv` vacío.
    //
    // `certificateNitMatches` en vez de comparar dígitos: es tolerante al DV en
    // cualquiera de los dos lados, así que acepta `'900123456-7'` contra base
    // `900123456` + dv `7` —que son el MISMO NIT— y sigue bloqueando un NIT
    // distinto. Está escrito para certificados, pero lo que implementa es
    // exactamente igualdad de NIT tolerante al DV.
    if (
      !certificateNitMatches({
        certificateTaxId: config.nit,
        nit: identity.nit,
        dv: identity.nit_dv,
      })
    ) {
      throw new Error(
        `El NIT de la configuración DIAN y el de la identidad fiscal no coinciden: ` +
          `dian_configurations declara '${config.nit}' ` +
          `(${normalizeNitDigits(config.nit)}) y la fuente única declara ` +
          `'${identity.nit}' con DV '${identity.nit_dv}'. El documento se entregaría ` +
          `bajo el primero y declararía el segundo, así que la DIAN lo rechazaría ` +
          `con el consecutivo ya gastado. ` +
          `Alinea settings.fiscal_data.nit con dian_configurations.nit antes de emitir.`,
      );
    }

    return identity;
  }

  /**
   * Builds customer data from invoice data.
   *
   * Anexo Técnico 19 alignment (see `DianCustomerData` and
   * `UblCommonBuilder.buildCustomerParty`):
   *
   *   - `document_type` keeps the LITERAL ('NIT', 'CC', 'PPT', …); the builder
   *     translates to the DIAN scheme code via `DIAN_ID_TYPES`. Storing the
   *     literal preserves `@schemeName` and avoids a reverse-mapping table.
   *   - `person_type` is the STRUCTURAL selector (`NATURAL`/`JURIDICA`); the
   *     builder translates to the `cbc:AdditionalAccountID` value ('1'/'2').
   *   - `tax_responsibilities` is the FULL list (concatenated by the builder
   *     with `;` per Anexo 19); previously the provider took only the first.
   *   - `verification_digit` and `ciiu_code` are persisted as-is on the data
   *     shape so the UBL builder can decide where each lands (DV alongside the
   *     bare NIT; CIIU as `cbc:IndustryClassificationCode`).
   *
   * @param fallback en los documentos con ADQUIRIENTE se pasa `{ issuer,
   *   config }` y eso habilita la cascada de respaldo de la dirección
   *   (`acquirer-address.resolver.ts`). En el documento soporte NO se pasa, y
   *   esa ausencia es la que apaga el respaldo: ahí la contraparte es un
   *   TERCERO no obligado a facturar y la dirección del emisor es la de
   *   NUESTRA propia empresa —el comprador—. Declararla como domicilio del
   *   vendedor sería inventar un hecho sobre otra persona, que es justo lo que
   *   la cascada existe para eliminar.
   */
  private async buildCustomerData(
    invoice_data: ProviderInvoiceData,
    role: DianCustomerRole = 'adquiriente',
    fallback?: { issuer: DianIssuerData; config: DianConfigDecrypted },
  ): Promise<DianCustomerData> {
    const address = this.normalizeAddress(invoice_data.customer_address);

    const declared_type = invoice_data.customer_document_type
      ?.trim()
      .toUpperCase();
    const declared_number = String(invoice_data.customer_tax_id ?? '').trim();
    const declared_name = String(invoice_data.customer_name ?? '').trim();

    // El documento DECLARÓ consumidor final cuando trae el número oficial. Se
    // compara también por dígitos porque el número puede llegar formateado.
    const declares_final_consumer =
      declared_number === DIAN_FINAL_CONSUMER_ID ||
      onlyDigits(declared_number) === DIAN_FINAL_CONSUMER_ID;
    // No hay adquiriente en absoluto: ni tipo, ni número, ni nombre. Es la venta
    // de mostrador anónima, que es un caso legítimo.
    const declares_nothing =
      !declared_type && !declared_number && !declared_name;

    const is_final_consumer = declares_final_consumer || declares_nothing;

    if (is_final_consumer) {
      if (role === 'vendedor_documento_soporte') {
        // Un documento soporte declara la compra a un tercero NO obligado a
        // facturar. «Consumidor Final» ahí no es una elección: es la prueba de
        // que se perdió la identidad del vendedor, y el documento afirmaría un
        // costo deducible contra una persona que no existe.
        throw new VendixHttpException(
          ErrorCodes.INVOICING_VALIDATE_001,
          'No se puede emitir el documento soporte: falta la identificación del tercero no obligado a facturar. Registra su documento y nombre antes de emitir.',
          { role, has_document_number: !!declared_number },
        );
      }
      // Emisión del valor OFICIAL, completo y coherente: número, tipo y nombre
      // salen los tres del mismo contrato. Antes cada uno tenía su propia caída,
      // así que era alcanzable un documento con número `222222222222` y el
      // nombre real de un cliente a medio capturar.
      if (
        declares_final_consumer &&
        (declared_name || address?.city_code || invoice_data.customer_email)
      ) {
        this.logger.warn(
          `[DIAN] Documento ${invoice_data.invoice_number}: declara Consumidor Final (${DIAN_FINAL_CONSUMER_ID}) pero trae datos de un cliente identificado. Se emite como Consumidor Final; verifica la captura si debía ser nominativa.`,
        );
      }
      return {
        // Literal derivado de `DIAN_FINAL_CONSUMER_TYPE_CODE` ('13' → 'CC'). El
        // builder traduce literal → código; acá se guarda el literal para que
        // `@schemeName` lo lleve.
        document_type: DIAN_FINAL_CONSUMER_TYPE_LITERAL,
        document_number: DIAN_FINAL_CONSUMER_ID,
        verification_digit: null,
        person_type: 'NATURAL',
        tax_responsibilities: [],
        legal_name: DIAN_FINAL_CONSUMER_NAME,
        // Sin dirección, sin correo y sin teléfono: el consumidor final no los
        // declara, y el grupo de dirección se omite cuando no hay municipio.
        address_line: undefined,
        city_code: undefined,
        city_name: undefined,
        department_code: undefined,
        department_name: undefined,
        country_code: undefined,
        postal_code: undefined,
        email: undefined,
        phone: undefined,
        ciiu_code: null,
        is_withholding_agent: false,
        tax_regime: '2',
        // Sin cascada: el consumidor final NO declara dirección por definición.
        // Marcarlo con un origen diría que hubo un respaldo donde no hubo
        // ninguna búsqueda.
        address_source: null,
      };
    }

    // ADQUIRIENTE NOMINATIVO — se exige la identidad COMPLETA.
    //
    // El defecto que esto cierra: cuando faltaba el número, el código ponía
    // `222222222222`; cuando faltaba el nombre, ponía «Consumidor Final». Con
    // media identidad presente eso produce un documento firmado y legalmente
    // emitido que afirma que la venta fue a un consumidor anónimo cuando el
    // propio documento sabe que no. Completar media identidad con el centinela
    // es inventar un hecho sobre una parte parcialmente conocida.
    //
    // Fallar acá no cuesta nada; un rechazo de la DIAN gasta un consecutivo
    // autorizado que no se recupera.
    if (!declared_number || !declared_name) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        !declared_number
          ? 'No se puede emitir: el adquiriente tiene nombre pero no número de identificación. Complétalo en la ficha del cliente, o emite la venta como Consumidor Final si el comprador no se identifica.'
          : 'No se puede emitir: el adquiriente tiene número de identificación pero no razón social ni nombre. Complétalo en la ficha del cliente, o emite la venta como Consumidor Final si el comprador no se identifica.',
        {
          role,
          has_document_type: !!declared_type,
          has_document_number: !!declared_number,
          has_name: !!declared_name,
        },
      );
    }

    // Literal from `users.document_type` — keep the source-of-truth string so
    // `@schemeName` carries the canonical type name. Un adquiriente identificado
    // con número y nombre pero sin tipo declarado es una cédula: es el documento
    // que tiene una persona natural colombiana por defecto, y el tipo se deriva
    // —no se inventa— del hecho de que el número existe.
    const document_type_literal = declared_type || 'CC';

    // CASCADA DE RESPALDO — dirección fiscal → otra del cliente → tienda.
    const resolved_address = await this.resolveAcquirerAddressForDocument({
      declared_address: address,
      declared_number,
      invoice_number: invoice_data.invoice_number,
      fallback,
    });

    return {
      document_type: document_type_literal,
      document_number: declared_number,
      verification_digit: invoice_data.customer_verification_digit ?? null,
      person_type: this.translatePersonTypeToStructural(
        invoice_data.customer_person_type,
        document_type_literal,
      ),
      tax_responsibilities:
        invoice_data.customer_tax_responsibilities ?? [],
      legal_name: declared_name,
      address_line: resolved_address?.address.address_line,
      city_code: resolved_address?.address.city_code,
      city_name: resolved_address?.address.city_name,
      department_code: resolved_address?.address.department_code,
      department_name: resolved_address?.address.department_name,
      country_code: resolved_address?.address.country_code,
      postal_code: resolved_address?.address.postal_code,
      address_source: resolved_address?.source ?? null,
      email: invoice_data.customer_email,
      phone: invoice_data.customer_phone,
      ciiu_code: invoice_data.customer_ciiu_code ?? null,
      is_withholding_agent: invoice_data.customer_is_withholding_agent ?? false,
      tax_regime: this.normalizePartyAccountType(
        invoice_data.customer_regime,
        document_type_literal,
      ),
    };
  }

  /**
   * CASCADA DE RESPALDO DE LA DIRECCIÓN DEL ADQUIRIENTE — el punto de entrada
   * desde la emisión. La POLÍTICA vive en `acquirer-address.resolver.ts`; acá
   * sólo se reúnen los candidatos y se reporta el resultado.
   *
   * ## Por qué hay una consulta a base de datos en medio de la emisión
   *
   * El llamador (`invoice-flow.service.ts`) carga UNA sola dirección del
   * cliente: `take: 1, orderBy: { is_primary: 'desc' }`. «Principal para el
   * usuario» y «fiscal» son dos conceptos distintos que no siempre coinciden
   * —es el mismo desencuentro que ya obligó a filtrar `type='billing'` en
   * `loadIssuerData`—, así que la dirección que llega puede ser la de envío
   * mientras existe una de facturación que nadie miró. Sin esta lectura, la
   * cascada tendría que decidir con un único candidato y llamaría «respaldo» a
   * lo que en realidad es el dato bueno mal elegido.
   *
   * Sólo corre cuando el candidato en mano NO es una dirección fiscal
   * emitible: el camino feliz no paga ninguna consulta extra.
   *
   * ## Por qué la búsqueda se abandona ante la ambigüedad
   *
   * Se busca por `organization_id` + `document_number`, que es la identidad del
   * cliente dentro del tenant, y **si aparece más de una fila la búsqueda se
   * descarta entera**. `users.document_number` no tiene índice único, así que
   * dos filas son representables; elegir una sería tomar la dirección de una
   * persona y ponérsela a otra. Rendirse ahí deja el documento en el escalón
   * siguiente de la cascada, que es un dato REAL de otra procedencia — nunca
   * el domicilio equivocado de un tercero.
   */
  private async resolveAcquirerAddressForDocument(params: {
    declared_address: AcquirerAddressCandidate | undefined;
    declared_number: string;
    invoice_number: string;
    fallback?: { issuer: DianIssuerData; config: DianConfigDecrypted };
  }): Promise<ResolvedAcquirerAddress | null> {
    const { declared_address, declared_number, invoice_number, fallback } =
      params;

    const store_address = fallback
      ? {
          address_line: fallback.issuer.address_line,
          city_code: fallback.issuer.city_code,
          city_name: fallback.issuer.city_name,
          department_code: fallback.issuer.department_code,
          department_name: fallback.issuer.department_name,
          country_code: fallback.issuer.country_code,
          postal_code: fallback.issuer.postal_code,
        }
      : null;

    const declared_candidates = declared_address ? [declared_address] : [];
    let resolved = resolveAcquirerAddress({
      candidates: declared_candidates,
      store_address,
    });

    if (resolved?.source !== 'fiscal' && fallback) {
      const stored = await this.loadCustomerAddressCandidates(
        fallback.config,
        declared_number,
      );
      if (stored.length) {
        resolved =
          resolveAcquirerAddress({
            // La declarada va PRIMERO: si el llamador compuso una dirección
            // para este documento en concreto (DTO), manda sobre la ficha.
            candidates: [...declared_candidates, ...stored],
            store_address,
          }) ?? resolved;
      }
    }

    if (!resolved) {
      // Sin respaldo habilitado (documento soporte) se conserva el
      // comportamiento actual: el grupo de dirección simplemente no se emite.
      // No hay nada que reprocharle al usuario porque no se intentó ninguna
      // cascada.
      if (!fallback) return null;

      throw new VendixHttpException(
        ErrorCodes.INVOICING_VALIDATE_001,
        'No se puede emitir: el documento no tiene ninguna dirección que declarar para el adquiriente. ' +
          'Se buscó, en orden, la dirección de facturación del cliente, cualquier otra dirección suya ' +
          '(envío, casa, trabajo) y la dirección fiscal de la tienda que emite, y ninguna tiene municipio ' +
          'de la lista DANE. Carga el municipio en Clientes → ficha del cliente → «Direcciones», o —si el ' +
          'cliente no tiene ninguna— en Configuración → Direcciones → la dirección de tipo «Facturación» ' +
          'de la tienda u organización que emite.',
        {
          document_number: invoice_number,
          has_declared_address: !!declared_address,
          store_address_usable: false,
        },
      );
    }

    if (resolved.source !== 'fiscal') {
      // El respaldo se ANUNCIA. Un respaldo silencioso es lo que produjo el
      // defecto original: el documento declaraba un municipio que nadie había
      // elegido y no había forma de saberlo hasta el cruce de la DIAN.
      this.logger.warn(
        `[DIAN] Documento ${invoice_number}: el adquiriente no tiene dirección fiscal utilizable. ` +
          `Se declara la dirección de origen «${resolved.source}» ` +
          `(municipio ${resolved.address.city_code ?? 'sin código'} — ${resolved.address.city_name ?? 'sin nombre'}).`,
      );
    }

    return resolved;
  }

  /**
   * Direcciones del cliente que la emisión NO recibió, leídas por identidad
   * dentro del tenant. Devuelve `[]` ante cualquier ambigüedad o fallo: es un
   * ENRIQUECIMIENTO de la cascada, así que no puede ser el motivo por el que
   * una factura no salga.
   */
  private async loadCustomerAddressCandidates(
    config: DianConfigDecrypted,
    document_number: string,
  ): Promise<AcquirerAddressCandidate[]> {
    const normalized = document_number.trim();
    if (!normalized) return [];

    try {
      const matches = await this.prisma.withoutScope().users.findMany({
        where: {
          organization_id: config.organization_id,
          document_number: normalized,
        },
        select: {
          id: true,
          addresses: {
            orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
            take: 10,
          },
        },
        // `2` y no `1`: se necesita SABER que hay más de una para descartar la
        // búsqueda. Con `take: 1` la ambigüedad sería invisible.
        take: 2,
      });

      if (matches.length !== 1) return [];

      return (matches[0].addresses ?? [])
        .map((row) => this.normalizeAddress(row))
        .filter((row): row is AcquirerAddressCandidate => !!row);
    } catch (error) {
      this.logger.warn(
        `[DIAN] No se pudieron leer las direcciones del cliente para la cascada de respaldo: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Translates the legacy `'1'`/`'2'` person-type code carried in
   * `ProviderInvoiceData.customer_person_type` (and the
   * `cbc:AdditionalAccountID` value) to the STRUCTURAL selector
   * `'NATURAL'`/`'JURIDICA'` consumed by `UblCommonBuilder.buildCustomerParty`.
   *
   *   '1' / 'JURIDICA' / 'juridica'  → 'JURIDICA'
   *   '2' / 'NATURAL'  / 'natural'   → 'NATURAL'
   *   absent                          → derive from the document type literal
   *                                    (NIT → 'JURIDICA', else 'NATURAL');
   *                                    mirrors the historical fallback so an
   *                                    unset person_type still produces a
   *                                    structurally sound customer block.
   */
  private translatePersonTypeToStructural(
    raw: string | undefined,
    document_type_literal: string,
  ): 'NATURAL' | 'JURIDICA' | null {
    const normalized = raw?.trim().toUpperCase();
    if (normalized === '1' || normalized === 'JURIDICA') return 'JURIDICA';
    if (normalized === '2' || normalized === 'NATURAL') return 'NATURAL';
    if (normalized) return null;
    return document_type_literal === 'NIT' ? 'JURIDICA' : 'NATURAL';
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

  /**
   * `type` se conserva porque es lo ÚNICO que distingue el primer escalón de la
   * cascada (dirección fiscal) del segundo (cualquier otra del cliente). No
   * viaja al XML: `resolveAcquirerAddress` lo consume y lo descarta.
   */
  private normalizeAddress(
    address: any,
  ): AcquirerAddressCandidate | undefined {
    if (!address || typeof address !== 'object') return undefined;
    const municipality_code =
      address.municipality_code ||
      address.city_code ||
      address.municipalityCode;
    return {
      type: address.type ?? null,
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
    // Compuerta estructural. Va AQUÍ y no en cada builder porque este método es
    // el único paso obligado de los siete caminos de emisión —factura, nota
    // crédito, nota débito, documento soporte, nota de ajuste, documento
    // equivalente POS y eventos RADIAN—: cubrirlos todos desde un punto evita
    // que el próximo tipo de documento nazca sin la verificación.
    //
    // Corre sobre el XML SIN FIRMAR, que es cuando todavía se puede abortar sin
    // costo. La firma entra bajo `ext:ExtensionContent`, declarado `xsd:any`, así
    // que validar antes no deja fuera nada que el esquema gobierne.
    this.assertStructurallyValid(xml);

    // Segunda compuerta, sobre el MISMO XML sin firmar: la estructura puede ser
    // impecable y la totalización no cerrar. Va después porque un documento mal
    // formado o con la secuencia rota daría lecturas sin sentido acá, y el
    // mensaje útil es el estructural.
    this.assertTotalsCoherent(xml);

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
   * Aborta si el XML no respeta el modelo de contenido de los XSD oficiales.
   *
   * Bloquea en vez de advertir. La asimetría lo decide: una violación de
   * estructura garantiza el rechazo de la DIAN, y ese rechazo quema el
   * consecutivo autorizado sin vuelta atrás; un bloqueo local, en cambio, deja
   * el borrador intacto con su número reservado y se reemite en cuanto se
   * corrija. Ante la duda, el error barato.
   *
   * Un documento cuya raíz el modelo no describe también se bloquea. Podría
   * parecer excesivo —«no sé validarlo, déjalo pasar»—, pero esa raíz sólo la
   * produce código nuestro: no reconocerla significa que alguien añadió un tipo
   * de documento sin regenerar el modelo, y dejarlo pasar en silencio devuelve
   * exactamente el agujero que esta compuerta existe para cerrar.
   */
  private assertStructurallyValid(xml: string): void {
    const result = UblStructureValidator.validate(xml);
    if (result.valid) return;

    const summary = summarizeUblViolations(result.violations);
    this.logger.error(
      `XML estructuralmente inválido (${result.root ?? 'raíz desconocida'}): ` +
        `${result.violations.length} violación(es). ${summary.join(' | ')}`,
    );

    throw new VendixHttpException(
      ErrorCodes.INVOICING_XSD_001,
      'El documento generado no cumple la estructura que exige la DIAN, así que ' +
        'no se transmitió: la numeración autorizada queda intacta y el documento ' +
        'se puede reemitir apenas se corrija. Es un defecto del generador de XML, ' +
        'no de los datos capturados — repórtalo con el detalle que acompaña este ' +
        'error.',
      {
        document_root: result.root,
        violation_count: result.violations.length,
        violations: summary,
      },
    );
  }

  /**
   * Aborta si la totalización del XML no cierra contra las reglas de la DIAN.
   *
   * Bloquea por la misma asimetría que la compuerta estructural: `FAS01b` y las
   * cuatro identidades de totales —`AU02` bruto, `AU04` base, `AU06` bruto más
   * tributos, `AU14` valor a pagar— garantizan el rechazo, y ese rechazo quema
   * el consecutivo. Acá no hay nada perdido — el borrador conserva su número.
   *
   * Un documento sin totales que juzgar (`ApplicationResponse`,
   * `AttachedDocument`) devuelve `root: null` y pasa: no aplicaba.
   */
  private assertTotalsCoherent(xml: string): void {
    const result = DianTotalsValidator.validate(xml);
    if (result.valid) return;

    const summary = summarizeDianTotalsViolations(result.violations);
    this.logger.error(
      `XML con totalización inválida (${result.root ?? 'raíz desconocida'}): ` +
        `${result.violations.length} violación(es). ${summary.join(' | ')}`,
    );

    throw new VendixHttpException(
      ErrorCodes.INVOICING_XSD_002,
      'El documento generado declara unos totales que la DIAN rechaza, así que ' +
        'no se transmitió: la numeración autorizada queda intacta y el documento ' +
        'se puede reemitir apenas se corrija. Es un defecto del generador de XML, ' +
        'no de los datos capturados — repórtalo con el detalle que acompaña este ' +
        'error.',
      {
        document_root: result.root,
        violation_count: result.violations.length,
        rules: [...new Set(result.violations.map((v) => v.rule))],
        violations: summary,
      },
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
