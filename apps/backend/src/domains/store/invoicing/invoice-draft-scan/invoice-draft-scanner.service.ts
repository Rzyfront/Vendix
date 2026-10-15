import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { computeNitDv, normalizeNit, onlyDigits } from '@common/utils/nit.util';
import {
  isValidFiscalResponsibility,
  normalizeFiscalResponsibilityCode,
} from '@common/constants/fiscal-responsibilities';
import {
  AiScanFile,
  AiScanJobContext,
} from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import {
  AIMessage,
  AIMessageContentPart,
} from '../../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import {
  buildCurrencyInstruction,
  checkTotalsConsistency,
  repairScannedAmount,
  StoreCurrencyInfo,
} from '../../../../ai-engine/utils/ocr-money.util';
import { fuzzyScore } from '../../../../ai-engine/utils/ocr-fuzzy-score.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { DIAN_ID_TYPES } from '../providers/dian-direct/constants/dian-document-types';
import {
  DIAN_DEPARTMENTS,
  type DianMunicipality,
  findDianMunicipality,
  listDianMunicipalities,
} from '../providers/dian-direct/constants/dian-geography';
import { SettingsService } from '../../settings/settings.service';
import { CustomersService } from '../../customers/customers.service';
import {
  DraftField,
  DraftLineMatchStatus,
  DraftPaymentForm,
  DraftPersonType,
  DraftWithholdingType,
  INVOICE_DRAFT_LOW_CONFIDENCE_THRESHOLD,
  INVOICE_DRAFT_SCAN_APP_KEY,
  INVOICE_DRAFT_UNIT_CODES,
  InvoiceDraftExistingAcquirer,
  InvoiceDraftScanAiu,
  InvoiceDraftScanContext,
  InvoiceDraftScanLine,
  InvoiceDraftScanResult,
  InvoiceDraftScanWithholding,
  MAX_INVOICE_DRAFT_SCAN_NOTE_LENGTH,
} from './invoice-draft-scan.types';
const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- sharp 0.35 types are ESM-only (export default) but CJS runtime exports the function

/** Valores de `identification_type_enum` (schema.prisma). */
const IDENTIFICATION_TYPES = new Set([
  'CC',
  'CE',
  'NIT',
  'TI',
  'RC',
  'PA',
  'PEP',
  'PPT',
  'DIE',
  'NUIP',
]);

/** Alias impresos / códigos DIAN → `identification_type_enum`. */
const IDENTIFICATION_TYPE_ALIASES: Record<string, string> = {
  '31': 'NIT',
  '13': 'CC',
  '22': 'CE',
  '12': 'TI',
  '11': 'RC',
  '41': 'PA',
  '47': 'PEP',
  '48': 'PPT',
  N_I_T: 'NIT',
  C_C: 'CC',
  C_E: 'CE',
  PASSPORT: 'PA',
  PASAPORTE: 'PA',
  CEDULA: 'CC',
  CEDULA_DE_CIUDADANIA: 'CC',
  CEDULA_DE_EXTRANJERIA: 'CE',
  TARJETA_DE_IDENTIDAD: 'TI',
  REGISTRO_CIVIL: 'RC',
};

/** Valores de `tax_regime_enum`. */
const TAX_REGIMES = new Set([
  'COMUN',
  'SIMPLIFICADO',
  'GRAN_CONTRIBUYENTE',
  'AUTORRETENEDOR',
  'ESPECIAL',
  'NO_APLICA',
]);

/** Tarifas habituales (IVA 0/5/19, INC 4/8/16). Otra tarifa se precarga con aviso. */
const USUAL_TAX_RATES = new Set([0, 4, 5, 8, 16, 19]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

const LOW_CONFIDENCE_WARNING =
  'La IA leyó este campo con baja confianza. Verifícalo.';

/** Umbrales de emparejamiento con el catálogo (mismos que el escáner de compras). */
const MATCHED_THRESHOLD = 90;
const PARTIAL_THRESHOLD = 50;
const SKU_MATCH_CONFIDENCE = 95;

/** Techo defensivo de líneas por borrador. */
const MAX_DRAFT_LINES = 200;

/** Campos que, vacíos, no se reportan como faltantes (son opcionales). */
const OPTIONAL_PATHS = new Set([
  'invoice.reference',
  'invoice.notes',
  'invoice.exchange_rate',
  'invoice.exchange_rate_date',
  'payment.payment_method_hint',
  'lines.discount_percent',
  'lines.unit_code',
]);

const UNIT_CODES: ReadonlySet<string> = new Set(INVOICE_DRAFT_UNIT_CODES);

/**
 * Unidad impresa (ya pasada por `enumKey`) → código UN/ECE rec. 20 de la
 * lista que ofrece la pantalla. «ML» NO está: en obra es metro lineal y en
 * bebidas mililitro, y adivinar entre los dos cambia la cantidad facturada.
 */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  UND: 'NIU',
  UNDS: 'NIU',
  UN: 'NIU',
  U: 'NIU',
  UNID: 'NIU',
  UNIDAD: 'NIU',
  UNIDADES: 'NIU',
  EA: 'NIU',
  PZA: 'NIU',
  PIEZA: 'NIU',
  PIEZAS: 'NIU',
  C_U: 'NIU',
  'C/U': 'NIU',
  GL: 'NIU',
  GLB: 'NIU',
  GLOBAL: 'NIU',
  SERVICIO: 'NIU',
  KG: 'KGM',
  KGS: 'KGM',
  KILO: 'KGM',
  KILOS: 'KGM',
  KILOGRAMO: 'KGM',
  KILOGRAMOS: 'KGM',
  G: 'GRM',
  GR: 'GRM',
  GRS: 'GRM',
  GRAMO: 'GRM',
  GRAMOS: 'GRM',
  L: 'LTR',
  LT: 'LTR',
  LTS: 'LTR',
  LITRO: 'LTR',
  LITROS: 'LTR',
  MILILITRO: 'MLT',
  MILILITROS: 'MLT',
  M: 'MTR',
  MT: 'MTR',
  MTS: 'MTR',
  METRO: 'MTR',
  METROS: 'MTR',
  METRO_LINEAL: 'MTR',
  CM: 'CMT',
  CENTIMETRO: 'CMT',
  CENTIMETROS: 'CMT',
  M2: 'MTK',
  MT2: 'MTK',
  METRO_CUADRADO: 'MTK',
  METROS_CUADRADOS: 'MTK',
  M3: 'MTQ',
  MT3: 'MTQ',
  METRO_CUBICO: 'MTQ',
  METROS_CUBICOS: 'MTQ',
  H: 'HUR',
  HR: 'HUR',
  HRS: 'HUR',
  HORA: 'HUR',
  HORAS: 'HUR',
  DIA: 'DAY',
  DIAS: 'DAY',
  MES: 'LUN',
  MESES: 'LUN',
  PAR: 'PR',
  PARES: 'PR',
  JUEGO: 'SET',
  JGO: 'SET',
  KIT: 'SET',
  CAJA: 'BX',
  CAJAS: 'BX',
  CJ: 'BX',
  PAQUETE: 'PK',
  PAQUETES: 'PK',
  PAQ: 'PK',
  PQ: 'PK',
};

/** Clase de retención impresa (ya pasada por `enumKey`) → tipo del borrador. */
const WITHHOLDING_TYPE_ALIASES: Readonly<Record<string, DraftWithholdingType>> = {
  RETEFUENTE: 'retefuente',
  RETE_FUENTE: 'retefuente',
  RTE_FTE: 'retefuente',
  RETFTE: 'retefuente',
  RETENCION_EN_LA_FUENTE: 'retefuente',
  RETENCION_FUENTE: 'retefuente',
  WITHHOLDING: 'retefuente',
  RETEIVA: 'reteiva',
  RETE_IVA: 'reteiva',
  RETENCION_DE_IVA: 'reteiva',
  RETENCION_IVA: 'reteiva',
  RETEICA: 'reteica',
  RETE_ICA: 'reteica',
  RETENCION_DE_ICA: 'reteica',
  RETENCION_ICA: 'reteica',
};

/** Techo defensivo de retenciones por borrador. */
const MAX_DRAFT_WITHHOLDINGS = 10;

/** Alias de departamento (ya normalizados con `geoKey`) → código DANE. */
const DEPARTMENT_ALIASES: Readonly<Record<string, string>> = {
  bogota: '11',
  'distrito capital': '11',
  'bogota distrito capital': '11',
  valle: '76',
  'norte santander': '54',
  'san andres': '88',
  'archipielago de san andres providencia y santa catalina': '88',
  guajira: '44',
};

/**
 * Nombre geográfico → clave comparable: sin tildes, minúsculas, sin
 * puntuación y sin el sufijo «D.C.» (la lista DIAN escribe «Bogotá, D.c.»).
 */
function geoKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/ (d c|dc|distrito capital)$/, '')
    .replace(/^(municipio|ciudad) de /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type Raw = Record<string, unknown>;

export interface InvoiceDraftScanOptions {
  note?: string | null;
  /** `store` (default) o `platform` (riel super-admin: Vendix factura). */
  context?: InvoiceDraftScanContext;
  /**
   * Contexto del job de la cola (`AiScanJobContext`). Si falta, se lee el
   * `RequestContextService` que el processor restableció.
   */
  job_context?: AiScanJobContext | null;
}

/** Moneda del borrador de plataforma: Vendix factura en pesos. */
const PLATFORM_CURRENCY: StoreCurrencyInfo = { code: 'COP', decimal_places: 0 };

/**
 * Escáner IA de borrador de factura de venta.
 *
 * Lee 1-6 documentos (cotización, orden de compra, RUT del cliente, contrato…)
 * más una nota libre del usuario y devuelve un borrador normalizado para el
 * formulario «Nueva factura». Todos los documentos y la nota viajan en UNA sola
 * llamada al modelo para que pueda cruzar datos (el RUT trae la identidad del
 * adquiriente, la cotización trae las líneas).
 *
 * Nunca escribe: ni crea el cliente, ni lo vincula a la tienda, ni crea la
 * factura. `existing_customer_id` es una lectura.
 *
 * DOS CONTEXTOS (`options.context`):
 * - `store` (default): moneda de la tienda, cliente existente de la
 *   organización y cruce con el catálogo de productos (StorePrismaService).
 * - `platform`: el riel super-admin, donde el VENDEDOR es Vendix. Exige
 *   super-admin sin tienda; moneda COP; líneas libres (sin catálogo:
 *   `match_status: 'none'`); el adquiriente conocido se busca en tenants y en
 *   `platform_customers` (GlobalPrismaService) y sale en `existing_acquirer`.
 *   Nunca toca StorePrismaService, SettingsService ni CustomersService.
 */
@Injectable()
export class InvoiceDraftScannerService {
  private readonly logger = new Logger(InvoiceDraftScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly settingsService: SettingsService,
    private readonly customersService: CustomersService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /**
   * Validación previa a la IA; el controller la llama ANTES de encolar.
   * Traduce los motivos «la app no existe / está inactiva / no tiene modelo de
   * visión» al código propio del escáner, conservando el mensaje.
   */
  async assertReady(): Promise<void> {
    try {
      await this.aiEngine.assertVisionModelLinked(INVOICE_DRAFT_SCAN_APP_KEY);
    } catch (err) {
      const notReadyCodes = new Set<string>([
        ErrorCodes.AI_APP_001.code,
        ErrorCodes.AI_APP_003.code,
        ErrorCodes.AI_VISION_001.code,
        ErrorCodes.AI_CONFIG_001.code,
      ]);
      if (err instanceof VendixHttpException && notReadyCodes.has(err.errorCode)) {
        throw new VendixHttpException(
          ErrorCodes.INVOICE_DRAFT_SCAN_NOT_READY,
          err.message,
        );
      }
      throw err;
    }
  }

  /** Núcleo del escaneo (handler `invoice_draft` de la cola `ai-scan`). */
  async scanDraftFromFiles(
    files: AiScanFile[],
    options: InvoiceDraftScanOptions = {},
  ): Promise<InvoiceDraftScanResult> {
    const note = this.sanitizeNote(options.note);
    const scope: InvoiceDraftScanContext =
      options.context === 'platform' ? 'platform' : 'store';
    if (scope === 'platform') {
      this.assertPlatformContext(options.job_context);
    }
    this.logger.debug(
      `[InvoiceDraftScan] ${files.length} file(s): ${files
        .map((f) => `${f.mimeType}/${f.size}b`)
        .join(', ')}; note=${note ? note.length : 0} chars; context=${scope}`,
    );

    await this.assertReady();
    const currency =
      scope === 'platform' ? PLATFORM_CURRENCY : await this.resolveCurrency();

    const content: AIMessageContentPart[] = [
      {
        type: 'text',
        text: this.buildInstruction(files.length, currency, note, scope),
      },
    ];
    for (const file of files) {
      const { base64, mimeType } = await this.prepareFile(file);
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
      });
    }
    const message: AIMessage = { role: 'user', content };

    const response = await this.aiEngine.run(
      INVOICE_DRAFT_SCAN_APP_KEY,
      {
        user_note: note ?? '(sin nota)',
        store_currency: currency.code,
      },
      [message],
    );

    if (!response.success || !response.content) {
      this.logger.error(`[InvoiceDraftScan] AI extraction failed: ${response.error}`);
      throw new VendixHttpException(
        ErrorCodes.INVOICE_DRAFT_SCAN_AI_FAILED,
        response.error
          ? `La IA no pudo leer los documentos: ${response.error}`
          : undefined,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseAiJson(response.content);
    } catch (err: any) {
      this.logger.error(
        `[InvoiceDraftScan] Unparseable AI response (${err?.message}): ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.INVOICE_DRAFT_SCAN_PARSE_FAIL);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new VendixHttpException(ErrorCodes.INVOICE_DRAFT_SCAN_PARSE_FAIL);
    }

    const result = this.normalize(parsed as Raw, currency, note, files.length);

    // Enriquecimientos de solo lectura: un fallo de base de datos degrada el
    // borrador (sin cliente / sin emparejar) pero nunca tumba el escaneo.
    if (scope === 'platform') {
      // Sin catálogo: Vendix factura servicios libres; las líneas quedan
      // `match_status: 'none'` tal como salen de `normalize`.
      await this.attachExistingAcquirer(result);
    } else {
      await this.attachExistingCustomer(result);
      await this.matchCatalog(result);
    }

    result.missing_fields = this.collectMissing(result);
    result.requires_review = this.collectReview(result, note);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Mensaje al modelo
  // ---------------------------------------------------------------------------

  private buildInstruction(
    fileCount: number,
    currency: StoreCurrencyInfo,
    note: string | null,
    scope: InvoiceDraftScanContext = 'store',
  ): string {
    const parts = [
      fileCount > 1
        ? `Build ONE sales-invoice draft from these ${fileCount} documents. They belong to the SAME sale (e.g. quotation, purchase order, the customer's RUT, a contract): merge them into a single JSON object.`
        : 'Build a sales-invoice draft from this document.',
      'Return ONLY the JSON object matching the schema defined in your system instructions.',
      buildCurrencyInstruction(currency),
      `The ${scope === 'platform' ? 'default invoice' : 'store'} currency is ${currency.code}; use it for "invoice.currency" unless a document explicitly prints another one.`,
    ];
    if (scope === 'platform') {
      // Riel super-admin: el vendedor es Vendix, no un comercio. Sin esto el
      // modelo podría tomar los datos de Vendix (membrete de la cotización)
      // como si fueran del adquiriente.
      parts.push(
        'SELLER CONTEXT: the seller/issuer of this invoice is Vendix (the software platform itself), not a store or merchant. "acquirer" is ALWAYS the customer Vendix is billing; never fill it with Vendix\'s own identity (name, NIT, address) even if it appears as letterhead. Lines are free-form services: leave "sku" null unless a document prints one.',
      );
    }
    parts.push(
      note
        ? `USER NOTE (it has PRIORITY over the documents; apply it and explain how in "note_applied", in Spanish):\n"""\n${note}\n"""`
        : 'USER NOTE: none. "note_applied" must be null.',
    );
    return parts.join('\n\n');
  }

  /** Imágenes: sharp a 1536 px / JPEG q85. PDFs y formatos que sharp no lee: crudos. */
  private async prepareFile(
    file: AiScanFile,
  ): Promise<{ base64: string; mimeType: string }> {
    const raw = {
      base64: file.buffer.toString('base64'),
      mimeType: file.mimeType,
    };
    if (file.mimeType === 'application/pdf') return raw;

    const MAX_DIMENSION = 1536;
    const JPEG_QUALITY = 85;
    try {
      const metadata = await sharp(file.buffer).metadata();
      const needsResize =
        (metadata.width && metadata.width > MAX_DIMENSION) ||
        (metadata.height && metadata.height > MAX_DIMENSION);
      let pipeline = sharp(file.buffer);
      if (needsResize) {
        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
      const processed = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
      return { base64: processed.toString('base64'), mimeType: 'image/jpeg' };
    } catch (err: any) {
      this.logger.warn(
        `[InvoiceDraftScan] Image preprocessing failed, using raw: ${err?.message}`,
      );
      return raw;
    }
  }

  private async resolveCurrency(): Promise<StoreCurrencyInfo> {
    try {
      return await this.settingsService.getStoreCurrencyInfo();
    } catch (err: any) {
      this.logger.warn(
        `[InvoiceDraftScan] Could not resolve store currency (${err?.message}); defaulting to COP/0.`,
      );
      return { code: 'COP', decimal_places: 0 };
    }
  }

  private sanitizeNote(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim().slice(0, MAX_INVOICE_DRAFT_SCAN_NOTE_LENGTH);
    return value || null;
  }

  // ---------------------------------------------------------------------------
  // Normalización
  // ---------------------------------------------------------------------------

  private normalize(
    parsed: Raw,
    currency: StoreCurrencyInfo,
    note: string | null,
    documentsScanned: number,
  ): InvoiceDraftScanResult {
    const overall = this.clampConfidence(parsed.confidence, 0);
    const fieldConfidence = this.asObject(parsed.field_confidence);
    const scoreOf = (path: string): number =>
      this.clampConfidence(fieldConfidence[path], overall);

    const acq = this.asObject(parsed.acquirer);
    const inv = this.asObject(parsed.invoice);
    const pay = this.asObject(parsed.payment);
    const totalsRaw = this.asObject(parsed.totals);
    const notes: string[] = [];

    // --- Adquiriente -------------------------------------------------------
    const documentType = this.buildDocumentType(
      acq.document_type,
      acq.document_number,
      scoreOf('acquirer.document_type'),
    );
    const { documentNumber, verificationDigit } = this.buildDocument(
      documentType.value,
      acq.document_number,
      acq.verification_digit,
      scoreOf('acquirer.document_number'),
      scoreOf('acquirer.verification_digit'),
    );
    const name = this.buildText(acq.name, scoreOf('acquirer.name'), 255);
    const personType = this.buildPersonType(
      acq.person_type,
      scoreOf('acquirer.person_type'),
      documentType.value,
    );

    const acquirer: InvoiceDraftScanResult['acquirer'] = {
      document_type: documentType,
      document_number: documentNumber,
      verification_digit: verificationDigit,
      person_type: personType,
      name,
      email: this.buildEmail(acq.email, scoreOf('acquirer.email')),
      phone: this.buildPhone(acq.phone, scoreOf('acquirer.phone')),
      address_line: this.buildText(acq.address_line, scoreOf('acquirer.address_line'), 255),
      ...this.buildMunicipality(
        acq.municipality_code,
        acq.city_name,
        acq.department_name,
        scoreOf('acquirer.municipality_code'),
        scoreOf('acquirer.city_name'),
        scoreOf('acquirer.department_name'),
      ),
      tax_regime: this.buildTaxRegime(acq.tax_regime, scoreOf('acquirer.tax_regime')),
      fiscal_responsibilities: this.buildResponsibilities(
        acq.fiscal_responsibilities,
        scoreOf('acquirer.fiscal_responsibilities'),
      ),
      existing_customer_id: null,
      existing_acquirer: null,
    };

    // --- Factura -------------------------------------------------------------
    const issueDate = this.buildDate(inv.issue_date, scoreOf('invoice.issue_date'), 'fecha de emisión');
    const dueDate = this.buildDate(inv.due_date, scoreOf('invoice.due_date'), 'fecha de vencimiento');
    if (issueDate.value && dueDate.value && dueDate.value < issueDate.value) {
      dueDate.warning = `La fecha de vencimiento (${dueDate.value}) es anterior a la de emisión (${issueDate.value}). Corrígela.`;
    }

    const invoiceCurrency = this.buildCurrency(
      inv.currency,
      scoreOf('invoice.currency'),
      currency.code,
    );
    const foreign =
      !!invoiceCurrency.value && invoiceCurrency.value !== currency.code;
    const invoice: InvoiceDraftScanResult['invoice'] = {
      issue_date: issueDate,
      due_date: dueDate,
      currency: invoiceCurrency,
      reference: this.buildText(inv.reference, scoreOf('invoice.reference'), 100),
      notes: this.buildText(inv.notes, scoreOf('invoice.notes'), 1000),
      // La TRM solo tiene sentido con moneda extranjera; en la moneda de la
      // tienda se descarta (una «tasa» 1 o un precio mal leído no es TRM).
      exchange_rate: foreign
        ? this.buildExchangeRate(inv.exchange_rate, scoreOf('invoice.exchange_rate'))
        : this.empty(),
      exchange_rate_date: foreign
        ? this.buildDate(
            inv.exchange_rate_date,
            scoreOf('invoice.exchange_rate_date'),
            'fecha de la TRM',
          )
        : this.empty(),
    };

    // --- Pago ------------------------------------------------------------------
    const termDays = this.buildTermDays(
      pay.payment_term_days,
      scoreOf('payment.payment_term_days'),
      issueDate.value,
      dueDate.value,
    );
    const paymentForm = this.buildPaymentForm(
      pay.payment_form,
      scoreOf('payment.payment_form'),
      termDays.value,
    );
    const payment: InvoiceDraftScanResult['payment'] = {
      payment_form: paymentForm,
      payment_term_days: termDays,
      payment_method_hint: this.buildText(
        pay.payment_method_hint,
        scoreOf('payment.payment_method_hint'),
        100,
      ),
    };

    // --- Líneas ----------------------------------------------------------------
    const repairs = { count: 0 };
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const lines: InvoiceDraftScanLine[] = [];
    for (const item of rawLines.slice(0, MAX_DRAFT_LINES)) {
      const line = this.buildLine(this.asObject(item), overall, currency, repairs);
      if (line) lines.push(line);
    }
    if (rawLines.length > MAX_DRAFT_LINES) {
      notes.push(`Se tomaron solo las primeras ${MAX_DRAFT_LINES} líneas.`);
    }
    if (repairs.count > 0) {
      notes.push(
        `Se corrigieron ${repairs.count} valor(es) leídos con decimales en ${currency.code}, que no los usa. Verifica los precios.`,
      );
    }

    // --- Retenciones y AIU ------------------------------------------------------
    const withholdings = this.buildWithholdings(parsed.withholdings, overall);
    const aiu = this.buildAiu(this.asObject(parsed.aiu), scoreOf, parsed.aiu);

    // --- Totales -------------------------------------------------------------
    const money = (raw: unknown): number | null => {
      const n = this.toNumber(raw);
      if (n === null || n < 0) return null;
      const repaired = repairScannedAmount(n, currency);
      return repaired.value;
    };
    const totals: InvoiceDraftScanResult['totals'] = {
      subtotal: money(totalsRaw.subtotal),
      tax_total: money(totalsRaw.tax_total),
      total: money(totalsRaw.total),
      consistent: null,
    };
    const lineTotals = this.computeLineTotals(lines);
    if (totals.total !== null && lineTotals !== null && lineTotals.length > 0) {
      const mismatch = checkTotalsConsistency(lineTotals, totals.total, currency.code);
      totals.consistent = mismatch === null;
      if (mismatch) notes.push(mismatch);
    }

    const modelNotes = this.trimOrNull(parsed.extraction_notes);
    if (modelNotes) notes.unshift(modelNotes);

    return {
      acquirer,
      invoice,
      payment,
      lines,
      withholdings,
      aiu,
      totals,
      note_applied: note ? this.trimOrNull(parsed.note_applied) : null,
      missing_fields: [],
      requires_review: [],
      extraction_notes: notes.length ? notes.join(' ') : null,
      documents_scanned: documentsScanned,
    };
  }

  private buildDocumentType(
    raw: unknown,
    rawNumber: unknown,
    confidence: number,
  ): DraftField<string> {
    const text = this.str(raw);
    if (!text) {
      // Un número impreso con su DV pegado ("900123456-7") solo puede ser NIT.
      if (/^\s*[\d.\s]{6,}-\s*\d\s*$/.test(this.str(rawNumber))) {
        return {
          value: 'NIT',
          confidence: Math.min(confidence, 70),
          warning: 'Tipo de documento deducido como NIT por el dígito de verificación impreso. Confírmalo.',
        };
      }
      return this.empty();
    }
    const key = this.enumKey(text);
    const value = IDENTIFICATION_TYPES.has(key)
      ? key
      : IDENTIFICATION_TYPE_ALIASES[key] ?? null;
    if (!value) {
      return {
        value: null,
        confidence,
        warning: `Tipo de documento «${text}» no reconocido. Selecciónalo.`,
      };
    }
    return this.checked(value, confidence);
  }

  private buildDocument(
    documentType: string | null,
    rawNumber: unknown,
    rawDv: unknown,
    numberConfidence: number,
    dvConfidence: number,
  ): {
    documentNumber: DraftField<string>;
    verificationDigit: DraftField<string>;
  } {
    const text = this.str(rawNumber);
    if (!text) {
      return { documentNumber: this.empty(), verificationDigit: this.empty() };
    }

    if (documentType === 'NIT') {
      const nit = normalizeNit(text);
      if (!/^\d{5,15}$/.test(nit.number)) {
        return {
          documentNumber: {
            value: null,
            confidence: numberConfidence,
            warning: `El NIT leído («${text}») no tiene entre 5 y 15 dígitos. Escríbelo a mano.`,
          },
          verificationDigit: this.empty(),
        };
      }
      const expected = computeNitDv(nit.number);
      const separateDv = onlyDigits(this.str(rawDv));
      const readDv = nit.provided_dv ?? (separateDv.length === 1 ? separateDv : null);
      const verificationDigit: DraftField<string> =
        readDv !== null && readDv !== expected
          ? {
              value: expected,
              confidence: dvConfidence,
              warning: `La IA leyó DV «${readDv}» pero al NIT ${nit.number} le corresponde «${expected}». Revisa que el NIT esté bien leído.`,
            }
          : { value: expected, confidence: 100, warning: null };
      return {
        documentNumber: this.checked(nit.number, numberConfidence),
        verificationDigit,
      };
    }

    // Pasaporte y PEP/PPT/DIE pueden ser alfanuméricos; el resto, dígitos.
    const alnum = documentType && ['PA', 'PEP', 'PPT', 'DIE'].includes(documentType);
    const value = alnum
      ? text.toUpperCase().replace(/[^A-Z0-9]/g, '')
      : onlyDigits(text.split('-')[0]);
    if (!/^[A-Z0-9]{3,20}$/.test(value)) {
      return {
        documentNumber: {
          value: null,
          confidence: numberConfidence,
          warning: `El número de documento leído («${text}») no es válido. Escríbelo a mano.`,
        },
        verificationDigit: this.empty(),
      };
    }
    return {
      documentNumber: this.checked(value, numberConfidence),
      // Solo el NIT lleva DV.
      verificationDigit: this.empty(),
    };
  }

  private buildPersonType(
    raw: unknown,
    confidence: number,
    documentType: string | null,
  ): DraftField<DraftPersonType> {
    const key = this.enumKey(this.str(raw)).replace(/^PERSONA_/, '');
    if (key === 'NATURAL' || key === 'JURIDICA') {
      return this.checked(key, confidence);
    }
    if (key) {
      return {
        value: null,
        confidence,
        warning: `Tipo de persona «${this.str(raw)}» no reconocido. Selecciónalo.`,
      };
    }
    // Solo un NIT puede ser persona jurídica: cualquier otro documento es natural.
    if (documentType && documentType !== 'NIT') {
      return {
        value: 'NATURAL',
        confidence: 90,
        warning: null,
      };
    }
    return this.empty();
  }

  private buildEmail(raw: unknown, confidence: number): DraftField<string> {
    const value = this.str(raw).toLowerCase().replace(/\s+/g, '');
    if (!value) return this.empty();
    if (!EMAIL_RE.test(value) || value.length > 255) {
      return {
        value: null,
        confidence,
        warning: `El correo leído («${value}») no es válido. Escríbelo a mano.`,
      };
    }
    return this.checked(value, confidence);
  }

  private buildPhone(raw: unknown, confidence: number): DraftField<string> {
    const text = this.str(raw);
    if (!text) return this.empty();
    const digits = onlyDigits(text);
    if (digits.length < 7 || digits.length > 15) {
      return {
        value: null,
        confidence,
        warning: `El teléfono leído («${text}») no es válido. Escríbelo a mano.`,
      };
    }
    return this.checked(text.trim().startsWith('+') ? `+${digits}` : digits, confidence);
  }

  /**
   * Municipio del adquiriente contra el catálogo DIAN (Divipola, 1122):
   *  1. Código leído: debe existir en la lista; si existe, ciudad y
   *     departamento vacíos se completan con los nombres oficiales, y una
   *     ciudad leída que no corresponde al código deja aviso.
   *  2. Sin código utilizable: ciudad (+ departamento) leídos se buscan por
   *     nombre EXACTO normalizado. Solo se acepta una coincidencia ÚNICA (con
   *     departamento, dentro de él); el código sale con aviso para revisión.
   * Nunca se elige entre homónimos: sin departamento, «San Juan» queda vacío.
   */
  private buildMunicipality(
    rawCode: unknown,
    rawCity: unknown,
    rawDepartment: unknown,
    codeConfidence: number,
    cityConfidence: number,
    departmentConfidence: number,
  ): {
    municipality_code: DraftField<string>;
    city_name: DraftField<string>;
    department_name: DraftField<string>;
  } {
    let city = this.buildText(rawCity, cityConfidence, 100);
    let department = this.buildText(rawDepartment, departmentConfidence, 100);
    let code = this.buildMunicipalityCode(rawCode, codeConfidence);

    if (code.value) {
      const found = findDianMunicipality(code.value);
      if (!found) {
        code = {
          value: null,
          confidence: code.confidence,
          warning: `El código DANE leído (${code.value}) no existe en la lista de municipios de la DIAN. Selecciona el municipio.`,
        };
      } else {
        if (city.value && geoKey(city.value) !== geoKey(found.name) && !code.warning) {
          code.warning = `El código DANE ${found.code} corresponde a ${found.name} (${found.department_name}), no a «${city.value}». Confírmalo.`;
        }
        if (!city.value) city = { value: found.name, confidence: code.confidence, warning: null };
        if (!department.value) {
          department = {
            value: found.department_name,
            confidence: code.confidence,
            warning: null,
          };
        }
        return { municipality_code: code, city_name: city, department_name: department };
      }
    }

    if (city.value) {
      const found = this.findMunicipalityByName(city.value, department.value);
      if (found) {
        code = {
          value: found.code,
          confidence: Math.min(
            city.confidence,
            department.value ? department.confidence : city.confidence,
            90,
          ),
          warning: `Municipio tomado del catálogo DANE por su nombre: ${found.name} (${found.department_name}), código ${found.code}. Confírmalo.`,
        };
        if (!department.value) {
          department = {
            value: found.department_name,
            confidence: code.confidence,
            warning: null,
          };
        }
      }
    }
    return { municipality_code: code, city_name: city, department_name: department };
  }

  /** Coincidencia ÚNICA por nombre normalizado (y departamento si se leyó). */
  private findMunicipalityByName(
    city: string,
    department: string | null,
  ): DianMunicipality | null {
    const cityKey = geoKey(city);
    if (!cityKey) return null;
    let candidates = listDianMunicipalities().filter(
      (m) => geoKey(m.name) === cityKey,
    );
    if (department) {
      const departmentCode = this.departmentCodeOf(department);
      // Un departamento leído pero desconocido no autoriza a elegir.
      if (!departmentCode) return null;
      candidates = candidates.filter((m) => m.department_code === departmentCode);
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  private departmentCodeOf(department: string): string | null {
    const key = geoKey(department).replace(/^departamento (de |del )?/, '');
    if (!key) return null;
    if (DEPARTMENT_ALIASES[key]) return DEPARTMENT_ALIASES[key];
    for (const [code, name] of Object.entries(DIAN_DEPARTMENTS)) {
      if (geoKey(name) === key) return code;
    }
    return null;
  }

  /** TRM: pesos por unidad de la moneda extranjera; > 0 y razonable. */
  private buildExchangeRate(raw: unknown, confidence: number): DraftField<number> {
    const n = this.toNumber(raw);
    if (n === null) return this.empty();
    if (!(n > 0) || n > 1_000_000) {
      return {
        value: null,
        confidence,
        warning: `La tasa de cambio leída (${n}) no es válida. Escríbela a mano.`,
      };
    }
    return this.checked(Math.round(n * 100) / 100, confidence);
  }

  private buildUnitCode(raw: unknown, confidence: number): DraftField<string> {
    const text = this.str(raw).replace(/²/g, '2').replace(/³/g, '3');
    if (!text) return this.empty();
    const upper = text.toUpperCase().trim();
    const key = this.enumKey(text);
    const code = UNIT_CODES.has(upper)
      ? upper
      : (UNIT_ALIASES[key] ?? UNIT_ALIASES[upper] ?? null);
    if (!code) {
      return {
        value: null,
        confidence,
        warning: `Unidad «${text}» no reconocida: queda la unidad por defecto. Elígela si no es «unidad».`,
      };
    }
    return this.checked(code, confidence);
  }

  /**
   * Retenciones impresas. Una fila necesita clase y tarifa válidas; lo demás
   * se descarta. La tarifa es PORCENTAJE; una ReteICA mayor a 2 % casi siempre
   * es la tarifa por mil sin convertir y queda con aviso.
   */
  private buildWithholdings(raw: unknown, overall: number): InvoiceDraftScanWithholding[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: InvoiceDraftScanWithholding[] = [];
    for (const entry of list) {
      if (out.length >= MAX_DRAFT_WITHHOLDINGS) break;
      const item = this.asObject(entry);
      const confidence = this.clampConfidence(item.confidence, overall);
      const typeText = this.str(item.type);
      const typeValue = typeText
        ? (WITHHOLDING_TYPE_ALIASES[this.enumKey(typeText)] ?? null)
        : null;
      const rateRaw = this.toNumber(item.rate);
      if (!typeValue && rateRaw === null) continue;

      const type: DraftField<DraftWithholdingType> = typeValue
        ? this.checked(typeValue, confidence)
        : {
            value: null,
            confidence,
            warning: typeText
              ? `Retención «${typeText}» no reconocida. Elige el concepto.`
              : 'Retención sin clase. Elige el concepto.',
          };

      let rate: DraftField<number>;
      if (rateRaw === null) {
        rate = this.empty();
      } else if (!(rateRaw > 0) || rateRaw > 100) {
        rate = {
          value: null,
          confidence,
          warning: `Tarifa de retención leída (${rateRaw} %) no válida. Escríbela a mano.`,
        };
      } else {
        rate = this.checked(Math.round(rateRaw * 10000) / 10000, confidence);
        if (typeValue === 'reteica' && rateRaw > 2 && !rate.warning) {
          rate.warning = `ReteICA de ${rateRaw} % parece la tarifa por mil sin convertir (${rateRaw} ‰ = ${Math.round(rateRaw * 100) / 1000} %). Confírmala.`;
        }
      }
      out.push({
        type,
        rate,
        concept_hint: this.str(item.concept).slice(0, 100) || null,
      });
    }
    return out;
  }

  /** Reparto AIU impreso; null si el documento no trae ninguno de sus datos. */
  private buildAiu(
    raw: Raw,
    scoreOf: (path: string) => number,
    original: unknown,
  ): InvoiceDraftScanAiu | null {
    if (!original || typeof original !== 'object' || Array.isArray(original)) return null;
    const percent = (key: string): DraftField<number> => {
      const confidence = scoreOf(`aiu.${key}`);
      const n = this.toNumber(raw[key]);
      if (n === null) return this.empty();
      if (n < 0 || n > 100) {
        return {
          value: null,
          confidence,
          warning: `Porcentaje AIU leído (${n} %) fuera de 0-100. Escríbelo a mano.`,
        };
      }
      return this.checked(Math.round(n * 100) / 100, confidence);
    };
    const aiu: InvoiceDraftScanAiu = {
      administracion_percent: percent('administracion_percent'),
      imprevistos_percent: percent('imprevistos_percent'),
      utilidad_percent: percent('utilidad_percent'),
      contract_object: this.buildText(
        raw.contract_object,
        scoreOf('aiu.contract_object'),
        500,
      ),
    };
    const any = Object.values(aiu).some((field) => field.value !== null || field.warning);
    return any ? aiu : null;
  }

  private buildMunicipalityCode(raw: unknown, confidence: number): DraftField<string> {
    const text = this.str(raw);
    if (!text) return this.empty();
    const digits = onlyDigits(text);
    if (!/^\d{5}$/.test(digits)) {
      return {
        value: null,
        confidence,
        warning: `El código de municipio leído («${text}») no es un código DANE de 5 dígitos.`,
      };
    }
    // Un código DANE equivocado declara a la DIAN un municipio falso: solo se
    // precarga cuando la IA lo conoce con confianza.
    if (confidence < INVOICE_DRAFT_LOW_CONFIDENCE_THRESHOLD) {
      return {
        value: null,
        confidence,
        warning: 'El código DANE del municipio no se leyó con confianza. Selecciona el municipio.',
      };
    }
    return this.checked(digits, confidence);
  }

  private buildTaxRegime(raw: unknown, confidence: number): DraftField<string> {
    const text = this.str(raw);
    if (!text) return this.empty();
    const key = this.enumKey(text).replace(/^REGIMEN_/, '');
    if (!TAX_REGIMES.has(key)) {
      return {
        value: null,
        confidence,
        warning: `Régimen tributario «${text}» no reconocido. Selecciónalo.`,
      };
    }
    return this.checked(key, confidence);
  }

  private buildResponsibilities(raw: unknown, confidence: number): DraftField<string[]> {
    const list = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? raw.split(/[,;]+/)
        : [];
    const valid: string[] = [];
    const rejected: string[] = [];
    for (const item of list) {
      const text = this.str(item);
      if (!text) continue;
      const code = normalizeFiscalResponsibilityCode(text);
      if (isValidFiscalResponsibility(code)) {
        if (!valid.includes(code)) valid.push(code);
      } else {
        rejected.push(text);
      }
    }
    if (!valid.length) {
      return rejected.length
        ? {
            value: null,
            confidence,
            warning: `Responsabilidades fiscales no reconocidas: ${rejected.join(', ')}.`,
          }
        : this.empty();
    }
    const field = this.checked(valid, confidence);
    if (rejected.length) {
      field.warning = `Se descartaron responsabilidades no reconocidas: ${rejected.join(', ')}.`;
    }
    return field;
  }

  private buildDate(raw: unknown, confidence: number, label: string): DraftField<string> {
    const text = this.str(raw);
    if (!text) return this.empty();
    const iso = this.toIsoDate(text);
    if (!iso) {
      return {
        value: null,
        confidence,
        warning: `La ${label} leída («${text}») no es una fecha válida. Escríbela a mano.`,
      };
    }
    return this.checked(iso, confidence);
  }

  private buildCurrency(raw: unknown, confidence: number, storeCode: string): DraftField<string> {
    const text = this.str(raw).toUpperCase();
    if (!text) return { value: storeCode, confidence: 100, warning: null };
    if (!CURRENCY_RE.test(text)) {
      return {
        value: storeCode,
        confidence,
        warning: `Moneda «${text}» no reconocida; se usó ${storeCode}, la de la tienda.`,
      };
    }
    const field = this.checked(text, confidence);
    if (text !== storeCode && !field.warning) {
      field.warning = `La moneda leída (${text}) es distinta a la de la tienda (${storeCode}). Confírmala.`;
    }
    return field;
  }

  private buildTermDays(
    raw: unknown,
    confidence: number,
    issueDate: string | null,
    dueDate: string | null,
  ): DraftField<number> {
    const n = this.toNumber(raw);
    if (n === null) {
      if (issueDate && dueDate && dueDate > issueDate) {
        const days = Math.round(
          (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${issueDate}T00:00:00Z`)) /
            86_400_000,
        );
        return {
          value: days,
          confidence: Math.min(confidence || 80, 80),
          warning: 'Plazo calculado a partir de las fechas de emisión y vencimiento. Confírmalo.',
        };
      }
      return this.empty();
    }
    const days = Math.round(n);
    if (days < 0 || days > 365) {
      return {
        value: null,
        confidence,
        warning: `El plazo leído (${n} días) no es válido. Escríbelo a mano.`,
      };
    }
    return this.checked(days, confidence);
  }

  private buildPaymentForm(
    raw: unknown,
    confidence: number,
    termDays: number | null,
  ): DraftField<DraftPaymentForm> {
    const key = this.enumKey(this.str(raw));
    const map: Record<string, DraftPaymentForm> = {
      CASH: 'cash',
      CONTADO: 'cash',
      DE_CONTADO: 'cash',
      CREDIT: 'credit',
      CREDITO: 'credit',
      A_CREDITO: 'credit',
    };
    const value = map[key] ?? null;
    if (key && !value) {
      return {
        value: null,
        confidence,
        warning: `Forma de pago «${this.str(raw)}» no reconocida. Selecciónala.`,
      };
    }
    if (!value) {
      if (termDays !== null && termDays > 0) {
        return {
          value: 'credit',
          confidence: Math.min(confidence || 80, 80),
          warning: 'Forma de pago deducida como crédito por el plazo leído. Confírmala.',
        };
      }
      return this.empty();
    }
    const field = this.checked(value, confidence);
    if (value === 'cash' && termDays !== null && termDays > 0) {
      field.warning = `Se leyó pago de contado pero con plazo de ${termDays} días. Revisa la forma de pago.`;
    }
    return field;
  }

  private buildLine(
    item: Raw,
    overall: number,
    currency: StoreCurrencyInfo,
    repairs: { count: number },
  ): InvoiceDraftScanLine | null {
    const confidence = this.clampConfidence(item.confidence, overall);
    const description = this.buildText(item.description, confidence, 500);
    // Una línea sin descripción no es facturable: se descarta.
    if (!description.value) return null;

    const qtyRaw = this.toNumber(item.quantity);
    const quantity: DraftField<number> =
      qtyRaw === null
        ? this.empty()
        : qtyRaw > 0
          ? this.checked(qtyRaw, confidence)
          : {
              value: null,
              confidence,
              warning: `Cantidad leída (${qtyRaw}) no válida. Escríbela a mano.`,
            };

    const priceRaw = this.toNumber(item.unit_price);
    let unitPrice: DraftField<number>;
    if (priceRaw === null) {
      unitPrice = this.empty();
    } else if (priceRaw < 0) {
      unitPrice = {
        value: null,
        confidence,
        warning: `Precio leído (${priceRaw}) negativo. Escríbelo a mano.`,
      };
    } else {
      const repaired = repairScannedAmount(priceRaw, currency);
      unitPrice = this.checked(repaired.value, confidence);
      if (repaired.repaired) {
        repairs.count++;
        unitPrice.warning = `Precio corregido de ${priceRaw} a ${repaired.value}: ${currency.code} no usa decimales. Verifícalo.`;
      } else if (repaired.value === 0 && !unitPrice.warning) {
        unitPrice.warning = 'Precio en cero. Confírmalo.';
      }
    }

    const discRaw = this.toNumber(item.discount_percent);
    const discountPercent: DraftField<number> =
      discRaw === null
        ? { value: 0, confidence, warning: null }
        : discRaw >= 0 && discRaw <= 100
          ? this.checked(discRaw, confidence)
          : {
              value: null,
              confidence,
              warning: `Descuento leído (${discRaw} %) fuera de 0-100. Escríbelo a mano.`,
            };

    let taxRaw = this.toNumber(item.tax_rate);
    let taxRate: DraftField<number>;
    if (taxRaw === null) {
      taxRate = this.empty();
    } else {
      let fractionWarning: string | null = null;
      if (taxRaw > 0 && taxRaw < 1) {
        taxRaw = Math.round(taxRaw * 10000) / 100;
        fractionWarning = `Tarifa leída como fracción; se interpretó como ${taxRaw} %.`;
      }
      if (taxRaw < 0 || taxRaw > 100) {
        taxRate = {
          value: null,
          confidence,
          warning: `Tarifa leída (${taxRaw} %) fuera de 0-100. Selecciónala.`,
        };
      } else {
        taxRate = this.checked(taxRaw, confidence);
        taxRate.warning =
          fractionWarning ??
          (!USUAL_TAX_RATES.has(taxRaw)
            ? `Tarifa ${taxRaw} % poco habitual. Confírmala.`
            : taxRate.warning);
      }
    }

    const sku = this.str(item.sku).slice(0, 100) || null;
    return {
      description,
      quantity,
      unit_price: unitPrice,
      discount_percent: discountPercent,
      tax_rate: taxRate,
      unit_code: this.buildUnitCode(item.unit_code ?? item.unit, confidence),
      sku,
      product_id: null,
      product_variant_id: null,
      match_status: 'none',
      match_confidence: 0,
    };
  }

  /** Totales por línea (con descuento e impuesto) o null si alguna línea está incompleta. */
  private computeLineTotals(lines: InvoiceDraftScanLine[]): number[] | null {
    const totals: number[] = [];
    for (const line of lines) {
      const q = line.quantity.value;
      const p = line.unit_price.value;
      if (q === null || p === null) return null;
      const d = line.discount_percent.value ?? 0;
      const t = line.tax_rate.value ?? 0;
      totals.push(q * p * (1 - d / 100) * (1 + t / 100));
    }
    return totals;
  }

  // ---------------------------------------------------------------------------
  // Enriquecimientos de solo lectura
  // ---------------------------------------------------------------------------

  /**
   * Contexto `platform`: solo super-admin y sin tienda. Lo que llega por la
   * cola es el contexto del job (quien encoló); si falta, el del request
   * restablecido por el processor.
   */
  private assertPlatformContext(jobContext?: AiScanJobContext | null): void {
    const ctx = jobContext ?? RequestContextService.getContext();
    if (!ctx?.is_super_admin || ctx.store_id != null) {
      throw new VendixHttpException(
        ErrorCodes.INVOICE_DRAFT_SCAN_PLATFORM_FORBIDDEN,
      );
    }
  }

  /**
   * Contexto `platform`: ¿la plataforma ya conoce a este adquiriente? Busca
   * por documento exacto, en orden: organización, tienda, cliente externo
   * (`platform_customers`, mismo tipo de documento si se leyó) y usuario. Los
   * tenants van primero porque son la entidad canónica; el cliente externo
   * es lo que quedó de facturas anteriores. Lectura pura vía
   * GlobalPrismaService; un fallo degrada a null.
   */
  private async attachExistingAcquirer(result: InvoiceDraftScanResult): Promise<void> {
    result.acquirer.existing_customer_id = null;
    result.acquirer.existing_acquirer = null;
    const number = result.acquirer.document_number.value;
    if (!number) return;
    const literal = result.acquirer.document_type.value;
    const documentCode = literal ? (DIAN_ID_TYPES[literal] ?? null) : null;
    const found = (
      kind: InvoiceDraftExistingAcquirer['kind'],
      id: number,
    ): InvoiceDraftExistingAcquirer => ({
      kind,
      tenant_id: id,
      id: `${kind === 'organization' ? 'org' : kind}:${id}`,
    });
    try {
      const org = await this.globalPrisma.organizations.findFirst({
        where: { tax_id: number, state: 'active', is_platform: false },
        select: { id: true },
      });
      if (org) {
        result.acquirer.existing_acquirer = found('organization', org.id);
        return;
      }
      const store = await this.globalPrisma.stores.findFirst({
        where: { tax_id: number, is_active: true },
        select: { id: true },
      });
      if (store) {
        result.acquirer.existing_acquirer = found('store', store.id);
        return;
      }
      const customer = await this.globalPrisma.platform_customers.findFirst({
        where: {
          tax_id: number,
          ...(documentCode ? { document_type: documentCode } : {}),
        },
        orderBy: { last_invoiced_at: { sort: 'desc', nulls: 'last' } },
        select: { id: true },
      });
      if (customer) {
        result.acquirer.existing_acquirer = found('customer', customer.id);
        return;
      }
      const user = await this.globalPrisma.users.findFirst({
        where: { document_number: number },
        select: { id: true },
      });
      if (user) {
        result.acquirer.existing_acquirer = found('user', user.id);
      }
    } catch (err: any) {
      this.logger.warn(`[InvoiceDraftScan] Platform acquirer lookup failed: ${err?.message}`);
    }
  }

  private async attachExistingCustomer(result: InvoiceDraftScanResult): Promise<void> {
    const number = result.acquirer.document_number.value;
    const organizationId = RequestContextService.getContext()?.organization_id;
    if (!number || !organizationId) return;
    try {
      // `findByDocumentInOrganization` es un `findFirst` (rol customer, no
      // archivado): NO vincula a la tienda, a diferencia de CustomerLookupService.
      const customer = await this.customersService.findByDocumentInOrganization(
        organizationId,
        number,
        result.acquirer.document_type.value ?? undefined,
      );
      result.acquirer.existing_customer_id =
        typeof customer?.id === 'number' ? customer.id : null;
    } catch (err: any) {
      this.logger.warn(`[InvoiceDraftScan] Customer lookup failed: ${err?.message}`);
    }
  }

  /**
   * Emparejamiento con el catálogo de la tienda, en dos niveles (los mismos
   * del escáner de compras, sin el nivel de catálogo de proveedor):
   * 1. SKU exacto (producto, luego variante) → `matched`.
   * 2. Palabras clave del nombre + `fuzzyScore` compartido → ≥90 `matched`,
   *    ≥50 `partial`, si no `none`.
   * Los archivados nunca se proponen.
   */
  private async matchCatalog(result: InvoiceDraftScanResult): Promise<void> {
    for (const line of result.lines) {
      try {
        await this.matchLine(line);
      } catch (err: any) {
        this.logger.warn(`[InvoiceDraftScan] Catalog match failed: ${err?.message}`);
      }
    }
  }

  private async matchLine(line: InvoiceDraftScanLine): Promise<void> {
    if (line.sku) {
      const product = await this.prisma.products.findFirst({
        where: {
          sku: { equals: line.sku, mode: 'insensitive' },
          state: { not: 'archived' },
        },
        select: { id: true },
      });
      if (product) {
        this.setMatch(line, product.id, null, 'matched', SKU_MATCH_CONFIDENCE);
        return;
      }
      const variant = await this.prisma.product_variants.findFirst({
        where: {
          sku: { equals: line.sku, mode: 'insensitive' },
          products: { state: { not: 'archived' } },
        },
        select: { id: true, product_id: true },
      });
      if (variant) {
        this.setMatch(line, variant.product_id, variant.id, 'matched', SKU_MATCH_CONFIDENCE);
        return;
      }
    }

    const description = line.description.value ?? '';
    const keywords = description
      .split(/[\s,;.\-/]+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);
    if (!keywords.length) return;

    const candidates = await this.prisma.products.findMany({
      where: {
        OR: keywords.map((kw) => ({
          name: { contains: kw, mode: 'insensitive' as const },
        })),
        state: { not: 'archived' },
      },
      select: { id: true, name: true },
      take: 10,
    });

    let best: { id: number; score: number } | null = null;
    for (const candidate of candidates) {
      const score = fuzzyScore(description, candidate.name);
      if (!best || score > best.score) best = { id: candidate.id, score };
    }
    if (!best || best.score < PARTIAL_THRESHOLD) return;
    this.setMatch(
      line,
      best.id,
      null,
      best.score >= MATCHED_THRESHOLD ? 'matched' : 'partial',
      best.score,
    );
  }

  private setMatch(
    line: InvoiceDraftScanLine,
    productId: number,
    variantId: number | null,
    status: DraftLineMatchStatus,
    confidence: number,
  ): void {
    line.product_id = productId;
    line.product_variant_id = variantId;
    line.match_status = status;
    line.match_confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  }

  // ---------------------------------------------------------------------------
  // Listas de revisión
  // ---------------------------------------------------------------------------

  private fieldEntries(result: InvoiceDraftScanResult): Array<[string, DraftField<unknown>]> {
    const entries: Array<[string, DraftField<unknown>]> = [];
    const sections = ['acquirer', 'invoice', 'payment'] as const;
    for (const section of sections) {
      for (const [key, field] of Object.entries(result[section])) {
        if (field && typeof field === 'object' && 'confidence' in field) {
          entries.push([`${section}.${key}`, field as DraftField<unknown>]);
        }
      }
    }
    result.lines.forEach((line, i) => {
      for (const key of [
        'description',
        'quantity',
        'unit_price',
        'discount_percent',
        'tax_rate',
        'unit_code',
      ] as const) {
        entries.push([`lines.${i}.${key}`, line[key]]);
      }
    });
    return entries;
  }

  /**
   * Retenciones y AIU: solo cuentan para REVISIÓN (aviso o confianza baja),
   * nunca como faltantes — son opcionales por naturaleza.
   */
  private optionalEntries(
    result: InvoiceDraftScanResult,
  ): Array<[string, DraftField<unknown>]> {
    const entries: Array<[string, DraftField<unknown>]> = [];
    result.withholdings.forEach((row, i) => {
      entries.push([`withholdings.${i}.type`, row.type]);
      entries.push([`withholdings.${i}.rate`, row.rate]);
    });
    if (result.aiu) {
      for (const [key, field] of Object.entries(result.aiu)) {
        entries.push([`aiu.${key}`, field as DraftField<unknown>]);
      }
    }
    return entries;
  }

  private collectMissing(result: InvoiceDraftScanResult): string[] {
    const isNit = result.acquirer.document_type.value === 'NIT';
    const missing = this.fieldEntries(result)
      .filter(([path, field]) => {
        if (field.value !== null) return false;
        if (OPTIONAL_PATHS.has(path.replace(/^lines\.\d+\./, 'lines.'))) return false;
        if (path === 'acquirer.verification_digit' && !isNit) return false;
        return true;
      })
      .map(([path]) => path);
    if (!result.lines.length) missing.push('lines');
    return missing;
  }

  private collectReview(result: InvoiceDraftScanResult, note: string | null): string[] {
    const review = [...this.fieldEntries(result), ...this.optionalEntries(result)]
      .filter(
        ([, field]) =>
          field.warning !== null ||
          (field.value !== null && field.confidence < INVOICE_DRAFT_LOW_CONFIDENCE_THRESHOLD),
      )
      .map(([path]) => path);
    result.lines.forEach((line, i) => {
      if (line.match_status === 'partial') review.push(`lines.${i}.product_id`);
    });
    if (result.totals.consistent === false) review.push('totals.total');
    if (note && !result.note_applied) review.push('note_applied');
    return review;
  }

  // ---------------------------------------------------------------------------
  // Primitivas
  // ---------------------------------------------------------------------------

  private buildText(raw: unknown, confidence: number, maxLength: number): DraftField<string> {
    const value = this.str(raw).replace(/\s+/g, ' ').slice(0, maxLength).trim();
    if (!value) return this.empty();
    return this.checked(value, confidence);
  }

  private checked<T>(value: T, confidence: number): DraftField<T> {
    return {
      value,
      confidence,
      warning:
        confidence < INVOICE_DRAFT_LOW_CONFIDENCE_THRESHOLD ? LOW_CONFIDENCE_WARNING : null,
    };
  }

  private empty<T>(): DraftField<T> {
    return { value: null, confidence: 0, warning: null };
  }

  private clampConfidence(raw: unknown, fallback: number): number {
    if (raw === null || raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.round(Math.max(0, Math.min(100, value)));
  }

  /** Número desde JSON; acepta cadenas con coma decimal ("0,5"). Nunca separadores de miles. */
  private toNumber(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    const text = raw.trim().replace(/[%$\s]/g, '');
    if (!text) return null;
    const normalized = /^-?\d+,\d+$/.test(text) ? text.replace(',', '.') : text;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  /** `YYYY-MM-DD` o `DD/MM/YYYY` → ISO; null si no es una fecha de calendario real. */
  private toIsoDate(text: string): string | null {
    let y: number, m: number, d: number;
    const head = text.trim().slice(0, 10);
    const iso = ISO_DATE_RE.exec(head);
    const dmy = DMY_DATE_RE.exec(text.trim());
    if (iso) {
      [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    } else if (dmy) {
      [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    } else {
      return null;
    }
    if (y < 1900 || y > 2100) return null;
    const value = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10) === value ? value : null;
  }

  /** "Cédula de ciudadanía" → "CEDULA_DE_CIUDADANIA". */
  private enumKey(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toUpperCase()
      .replace(/[.\s-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private str(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return raw.trim() === 'null' ? '' : raw.trim();
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
    return '';
  }

  private trimOrNull(raw: unknown): string | null {
    const value = this.str(raw);
    return value || null;
  }

  private asObject(raw: unknown): Raw {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Raw) : {};
  }
}
