import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { computeNitDv, onlyDigits } from '@common/utils/nit.util';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import {
  TECHNICAL_KEY_LENGTHS_LABEL,
  isWellFormedTechnicalKey,
} from '../fiscal-document-requirements';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import {
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { toScannerError } from '@common/ai-ingest/extraction/scanner-errors';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import {
  readDocumentsWithAi,
  ReadDocumentsResult,
} from '@common/ai-ingest/documents/document-reader';
import { detectQueuedDocument } from '@common/ai-ingest/documents/queued-document';
import { mergeFormAnswers } from '@common/ai-ingest/documents/merge-answers';
import {
  buildFormInstruction,
  conflictWarnings,
  DocumentScanSource,
  scanSourceOf,
} from '@common/ai-ingest/documents/form-instruction';
import {
  HABILITATION_FIELD_LABELS,
  HABILITATION_INGEST_PROFILE,
  habilitationInstruction,
} from './habilitation-ingest.profile';

/**
 * One extracted field, already checked against the shape the DIAN actually
 * issues.
 *
 * `verified` is NOT "the model was confident": it means the value passed a
 * structural rule we can prove (a UUID, 4-20 digits, 40 hex characters, a real
 * calendar date). A field the model was sure about but that fails its rule
 * arrives with `value: null` — a mis-read `software_id` is accepted by the DIAN
 * endpoint and then never classifies the document, which is indistinguishable
 * from a stuck queue.
 */
export interface HabilitationScanField<T> {
  value: T | null;
  /** 0-100, as reported by the model for this field alone. */
  confidence: number;
  /** The value passed its structural rule and may be pre-filled. */
  verified: boolean;
  /** Why a human still has to look at it, or null. */
  warning: string | null;
}

export type ScannedHabilitationEnvironment = 'test' | 'production';

/**
 * Result of scanning the DIAN habilitación paperwork (the "set de pruebas"
 * screen plus, optionally, the test numbering resolution).
 *
 * Every key mirrors a control of `DianConfigFormComponent` 1:1, so the frontend
 * patches the form without a mapping layer. Nothing is persisted: the endpoint
 * reads files and answers. Saving stays the explicit POST/PATCH the user fires
 * after reviewing — the scan is a typist, not an author.
 */
export interface DianHabilitationScanResult {
  name: HabilitationScanField<string>;
  nit: HabilitationScanField<string>;
  nit_dv: HabilitationScanField<string>;
  environment: HabilitationScanField<ScannedHabilitationEnvironment>;
  software_id: HabilitationScanField<string>;
  software_pin: HabilitationScanField<string>;
  test_set_id: HabilitationScanField<string>;
  resolution_number: HabilitationScanField<string>;
  resolution_prefix: HabilitationScanField<string>;
  resolution_range_from: HabilitationScanField<number>;
  resolution_range_to: HabilitationScanField<number>;
  resolution_valid_from: HabilitationScanField<string>;
  resolution_valid_to: HabilitationScanField<string>;
  resolution_date: HabilitationScanField<string>;
  resolution_technical_key: HabilitationScanField<string>;
  /** 0-100 overall scan quality reported by the model. */
  confidence: number;
  /** Field keys the user must confirm by hand before saving. */
  requires_manual_confirmation: string[];
  /** Field keys nothing in the uploaded documents could fill. */
  missing_fields: string[];
  extraction_notes: string | null;
  /** How many documents the model actually received. */
  documents_scanned: number;
  /** Avisos de lectura en español (páginas sin leer, valores en conflicto). Opcional. */
  warnings?: string[];
  /** Qué se leyó (documentos, páginas, llamadas). Opcional. */
  scan_source?: DocumentScanSource;
}

/** Keys the scanner reports on, in the order the form renders them. */
const SCANNED_FIELD_KEYS = [
  'name',
  'nit',
  'nit_dv',
  'environment',
  'software_id',
  'software_pin',
  'test_set_id',
  'resolution_number',
  'resolution_prefix',
  'resolution_range_from',
  'resolution_range_to',
  'resolution_valid_from',
  'resolution_valid_to',
  'resolution_date',
  'resolution_technical_key',
] as const;

type ScannedFieldKey = (typeof SCANNED_FIELD_KEYS)[number];

/** Below this, a field is pre-filled but flagged for manual confirmation. */
const LOW_CONFIDENCE_THRESHOLD = 75;

/** Máximo de documentos por escaneo — la pantalla de habilitación, la
 * resolución de pruebas y, a lo sumo, un anexo. Más allá el mensaje al modelo
 * crece sin aportar campos nuevos. */
export const MAX_HABILITATION_SCAN_FILES = 3;

/**
 * Espejo de `dianUuidValidator` (frontend) y de `@IsUUID(undefined)` (DTO): se
 * acepta cualquier versión a propósito, porque la DIAN sí ha emitido
 * identificadores que no son v4 y exigir v4 rechazaría un dato legítimo.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Espejo de `dianSoftwarePinValidator`. */
const SOFTWARE_PIN_RE = /^\d{4,20}$/;
const NIT_RE = /^\d{5,15}$/;
const PREFIX_RE = /^[A-Z0-9]{1,10}$/;
const RESOLUTION_NUMBER_RE = /^\d{4,25}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sanity ceiling for a single authorized range. */
const MAX_RANGE_SPAN = 500_000_000;

const ENVIRONMENTS = new Set<ScannedHabilitationEnvironment>([
  'test',
  'production',
]);

@Injectable()
export class DianHabilitationScannerService {
  private readonly logger = new Logger(DianHabilitationScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly extraction: AiExtractionService,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /**
   * Reads 1-3 DIAN habilitación documents and returns every field of the DIAN
   * configuration form, each annotated with whether it can be trusted.
   *
   * Why several files in ONE call instead of several calls: the data the form
   * needs is split across two different screens of the DIAN portal — the
   * software habilitación (SoftwareID, PIN, TestSetId) and the test numbering
   * resolution (prefijo SETP, rango, clave técnica). Sending them together lets
   * the model fill one result from both, and lets it use the second document to
   * disambiguate a character it could not read in the first.
   */
  async scanHabilitationDocuments(
    files: Express.Multer.File[],
  ): Promise<DianHabilitationScanResult> {
    return this.scanHabilitationFromFiles(
      files.map((f) => ({
        buffer: f.buffer,
        mimeType: f.mimetype,
        originalName: f.originalname,
        size: f.size,
      })),
    );
  }

  /** Validación previa a la IA; el controller async la llama ANTES de encolar. */
  async assertReady(): Promise<void> {
    await this.aiEngine.assertVisionModelLinked('dian_habilitation_scanner');
  }

  /**
   * Núcleo del escaneo (handler `dian_habilitation` de la cola `ai-scan`), por
   * el lector común de ai-ingest (plan ia-cargas F5b, #14):
   *
   * - Cada archivo se prepara por páginas (tipo real por firma; PDF con texto
   *   nativo E imagen de cada página; foto enderezada a 1536 px). Nunca viaja
   *   el PDF crudo.
   * - Las páginas de los 1-3 archivos van JUNTAS en UNA llamada, rotuladas por
   *   documento, igual que antes: el modelo llena un solo resultado con las dos
   *   pantallas del portal DIAN (software y resolución de pruebas).
   * - Esquema + una reparación; desde ahí la misma `normalizeResponse`: Test
   *   set id, Software id, PIN y demás campos idénticos con la misma respuesta.
   */
  async scanHabilitationFromFiles(
    files: AiScanFile[],
    options: { reportProgress?: (progress: AiJobProgress) => Promise<void> } = {},
  ): Promise<DianHabilitationScanResult> {
    this.logger.debug(
      `[HabilitationScan] ${files.length} file(s): ${files
        .map((f) => `${f.mimeType}/${f.size}b`)
        .join(', ')}`,
    );

    // Antes de gastar la llamada: sin modelo de visión enlazado, `run()` cae al
    // config de texto por defecto y devuelve JSON inventado con pinta de
    // válido. Acá eso sería un `software_id` inexistente que el comerciante
    // guarda como bueno y solo descubre cuando la DIAN nunca clasifica.
    await this.assertReady();

    const typed = files.map((file) => ({
      buffer: file.buffer,
      originalName: file.originalName ?? null,
      mimeType: detectQueuedDocument(
        { buffer: file.buffer, originalname: file.originalName, mimetype: file.mimeType },
        'Los documentos de habilitación deben ser PDF o fotos (JPG, PNG o WebP).',
      ).mime,
    }));

    let read: ReadDocumentsResult<Record<string, unknown>>;
    try {
      read = await readDocumentsWithAi<Record<string, unknown>>({
        files: typed,
        pages: this.documentPages,
        extraction: this.extraction,
        appKey: 'dian_habilitation_scanner',
        schema: HABILITATION_INGEST_PROFILE.documentSchema,
        instruction: (batch, context) =>
          buildFormInstruction(habilitationInstruction(files.length), batch, context),
        limits: HABILITATION_INGEST_PROFILE.limits,
        maxBytes: HABILITATION_INGEST_PROFILE.limits.maxBytes,
        splitTallImages: false,
        renderTextPages: true,
        quotaKey: newIngestQuotaKey(),
        reportProgress: options.reportProgress,
        logLabel: 'HabilitationScan',
        rawExtractionErrors: true,
      });
    } catch (err) {
      this.logger.error(
        `AI DIAN habilitation extraction failed: ${(err as Error)?.message}`,
      );
      // Se propaga el error del proveedor: "la foto está ilegible" y "el modelo
      // enlazado a esta app no acepta imágenes" no se arreglan igual.
      throw toScannerError(err, {
        parseFail: ErrorCodes.HABILITATION_SCAN_PARSE_FAIL,
        aiFail: ErrorCodes.HABILITATION_SCAN_AI_FAIL,
        aiFailMessage: (e) => `La IA no pudo leer los documentos de habilitación: ${e}`,
      });
    }

    const merged = mergeFormAnswers(read.batches.map((b) => b.data));
    let result: DianHabilitationScanResult;
    try {
      result = this.normalizeResponse(merged.data, files.length);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `Failed to normalize AI DIAN habilitation response: ${(err as Error)?.message}`,
      );
      throw new VendixHttpException(ErrorCodes.HABILITATION_SCAN_PARSE_FAIL);
    }
    const warnings = [
      ...read.warnings,
      ...conflictWarnings(merged.conflicts, HABILITATION_FIELD_LABELS),
    ];
    return {
      ...result,
      ...(warnings.length ? { warnings } : {}),
      scan_source: scanSourceOf(read),
    };
  }

  // --- Private helpers ---

  private normalizeResponse(
    raw: unknown,
    documentsScanned: number,
  ): DianHabilitationScanResult {
    const parsed = (raw ?? {}) as Record<string, unknown>;
    const fieldConfidence = (parsed.field_confidence ?? {}) as Record<
      string,
      unknown
    >;
    const scoreOf = (key: string): number =>
      this.clampConfidence(fieldConfidence[key]);

    const name = this.buildName(parsed.name, scoreOf('name'));
    const nit = this.buildNit(parsed.nit, scoreOf('nit'));
    const nitDv = this.buildNitDv(nit.value, parsed.nit_dv, scoreOf('nit_dv'));
    const softwareId = this.buildUuid(
      parsed.software_id,
      scoreOf('software_id'),
      'identificador del software (SoftwareID)',
    );
    const testSetId = this.buildUuid(
      parsed.test_set_id,
      scoreOf('test_set_id'),
      'identificador del set de pruebas (TestSetId)',
    );
    const softwarePin = this.buildSoftwarePin(
      parsed.software_pin,
      scoreOf('software_pin'),
    );
    const resolutionNumber = this.buildResolutionNumber(
      parsed.resolution_number,
      scoreOf('resolution_number'),
    );
    const resolutionPrefix = this.buildPrefix(
      parsed.resolution_prefix,
      scoreOf('resolution_prefix'),
    );
    const rangeFrom = this.buildInteger(
      parsed.resolution_range_from,
      scoreOf('resolution_range_from'),
      'rango inicial',
    );
    const rangeTo = this.buildInteger(
      parsed.resolution_range_to,
      scoreOf('resolution_range_to'),
      'rango final',
    );
    const validFrom = this.buildDate(
      parsed.resolution_valid_from,
      scoreOf('resolution_valid_from'),
      'inicio de vigencia',
    );
    const validTo = this.buildDate(
      parsed.resolution_valid_to,
      scoreOf('resolution_valid_to'),
      'fin de vigencia',
    );
    const resolutionDate = this.buildDate(
      parsed.resolution_date,
      scoreOf('resolution_date'),
      'fecha de la resolución',
    );
    const technicalKey = this.buildTechnicalKey(
      parsed.resolution_technical_key,
      scoreOf('resolution_technical_key'),
    );
    const environment = this.buildEnvironment(
      parsed.environment,
      scoreOf('environment'),
      resolutionPrefix.value,
      technicalKey.value,
      testSetId.value,
    );

    // Cross-field rules. These cannot live in the per-field builders because
    // each one only sees its own value.
    this.applyRangeCoherence(rangeFrom, rangeTo);
    this.applyValidityCoherence(validFrom, validTo);

    const result: DianHabilitationScanResult = {
      name,
      nit,
      nit_dv: nitDv,
      environment,
      software_id: softwareId,
      software_pin: softwarePin,
      test_set_id: testSetId,
      resolution_number: resolutionNumber,
      resolution_prefix: resolutionPrefix,
      resolution_range_from: rangeFrom,
      resolution_range_to: rangeTo,
      resolution_valid_from: validFrom,
      resolution_valid_to: validTo,
      resolution_date: resolutionDate,
      resolution_technical_key: technicalKey,
      confidence: this.clampConfidence(parsed.confidence),
      requires_manual_confirmation: [],
      missing_fields: [],
      extraction_notes: this.trimOrNull(parsed.extraction_notes),
      documents_scanned: documentsScanned,
    };

    result.requires_manual_confirmation =
      this.collectManualConfirmations(result);
    result.missing_fields = this.collectMissingFields(result);

    return result;
  }

  /**
   * The configuration label. It is free text with no DIAN rule to check, so it
   * is never "wrong" — but it is also the only field the user can rename at
   * will, so a low model confidence just carries its usual warning.
   */
  private buildName(
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    const value = String(raw ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 100);
    if (!value) {
      return this.emptyField(
        'No se leyó un nombre para la configuración. Escríbelo tú.',
      );
    }
    return this.checkedField(value, confidence);
  }

  private buildNit(
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    // The habilitación screen prints the NIT with its DV attached
    // ("900123456-7"), and the form stores them apart.
    const digits = onlyDigits(String(raw ?? '').split('-')[0]);

    if (!digits) {
      return this.emptyField('No se leyó el NIT del facturador.');
    }
    if (!NIT_RE.test(digits)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `El NIT leído ("${digits}") no tiene entre 5 y 15 dígitos. Escríbelo a mano.`,
      };
    }
    return this.checkedField(digits, confidence);
  }

  /**
   * The DV is a checksum of the NIT, not an independent reading: whatever the
   * model saw, the only defensible value is the computed one. A disagreement is
   * reported because it means one of the two readings is wrong, and the NIT is
   * the one that matters.
   */
  private buildNitDv(
    nit: string | null,
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    if (!nit) {
      return this.emptyField(
        'Sin NIT no se puede derivar el dígito de verificación.',
      );
    }

    const expected = computeNitDv(nit);
    const read = onlyDigits(raw as string);

    if (read && read.length === 1 && read !== expected) {
      return {
        value: expected,
        confidence,
        verified: false,
        warning: `La IA leyó DV "${read}" pero al NIT ${nit} le corresponde "${expected}". Revisa que el NIT esté bien leído: el DV entra en el CUFE y un dígito equivocado hace que la DIAN rechace cada documento.`,
      };
    }

    return {
      value: expected,
      // Derived, not read: its trust comes from the NIT it was computed from.
      confidence: 100,
      verified: true,
      warning: null,
    };
  }

  private buildUuid(
    raw: unknown,
    confidence: number,
    label: string,
  ): HabilitationScanField<string> {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

    if (!value) {
      return this.emptyField(`No se leyó el ${label}.`);
    }
    if (!UUID_RE.test(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `El ${label} leído ("${value}") no tiene forma de UUID (8-4-4-4-12). Cópialo a mano del correo de habilitación.`,
      };
    }
    return this.checkedField(value, confidence);
  }

  private buildSoftwarePin(
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    const value = onlyDigits(String(raw ?? ''));

    if (!value) {
      return this.emptyField('No se leyó el PIN del software.');
    }
    if (!SOFTWARE_PIN_RE.test(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `El PIN leído ("${value}") no es numérico de 4 a 20 dígitos. Escríbelo a mano.`,
      };
    }
    // El PIN entra en el cálculo del CUDE: un dígito de más produce un
    // documento que la DIAN recomputa distinto y rechaza con el consecutivo ya
    // gastado. Se precarga, pero nunca como dato cerrado.
    return {
      value,
      confidence,
      verified: false,
      warning:
        'Verifica el PIN contra el correo de habilitación: entra en el cálculo del CUDE y un dígito equivocado invalida el documento.',
    };
  }

  private buildPrefix(
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    const value = String(raw ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');

    if (!value) {
      return this.emptyField('No se leyó el prefijo autorizado.');
    }
    if (!PREFIX_RE.test(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `El prefijo leído ("${value}") no tiene forma de prefijo DIAN. Escríbelo a mano.`,
      };
    }
    return this.checkedField(value, confidence);
  }

  private buildResolutionNumber(
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    // Keep only digits: DIAN numbers are printed with dots, spaces and a
    // leading "No.", none of which belong in the stored value.
    const value = String(raw ?? '').replace(/\D+/g, '');

    if (!value) {
      return this.emptyField('No se leyó el número de la resolución.');
    }
    if (!RESOLUTION_NUMBER_RE.test(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `El número leído ("${value}") no tiene la longitud de una resolución DIAN. Escríbelo a mano.`,
      };
    }
    return this.checkedField(value, confidence);
  }

  private buildDate(
    raw: unknown,
    confidence: number,
    label: string,
  ): HabilitationScanField<string> {
    const value = String(raw ?? '').trim();

    if (!value) {
      return this.emptyField(`No se leyó la ${label}.`);
    }
    if (!ISO_DATE_RE.test(value) || !this.isRealCalendarDate(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `La ${label} leída ("${value}") no es una fecha válida. Escríbela a mano.`,
      };
    }
    return this.checkedField(value, confidence);
  }

  private buildInteger(
    raw: unknown,
    confidence: number,
    label: string,
  ): HabilitationScanField<number> {
    if (raw === null || raw === undefined || raw === '') {
      return this.emptyField(`No se leyó el ${label} del rango autorizado.`);
    }

    // Strip thousand separators before parsing: "1.000.000" and "1,000,000"
    // both reach us as strings when the model echoes the printed form.
    const digits = String(raw).replace(/[^\d]/g, '');
    const value = Number(digits);

    if (!digits || !Number.isSafeInteger(value) || value <= 0) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `El ${label} leído ("${String(raw)}") no es un número válido. Escríbelo a mano.`,
      };
    }
    return this.checkedField(value, confidence);
  }

  /**
   * La clave técnica es el único campo que nunca se da por bueno.
   *
   * Son 40 caracteres hex que alimentan el hash del CUFE: un solo carácter mal
   * leído produce una resolución sintácticamente perfecta cuyas facturas la
   * DIAN rechaza una por una, sin pista de que el OCR fue la causa.
   */
  private buildTechnicalKey(
    raw: unknown,
    confidence: number,
  ): HabilitationScanField<string> {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '');

    if (!value) {
      return this.emptyField(
        'No se leyó clave técnica. Solo las resoluciones de habilitación la traen.',
      );
    }
    // Misma regla que el DTO, el servicio de resoluciones y el generador de
    // consecutivos: una sola definición de qué es una ClTec, en
    // `fiscal-document-requirements.ts`. La limpieza de arriba sigue siendo
    // local porque es específica del OCR (un guion partido en dos líneas).
    if (!isWellFormedTechnicalKey(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `La clave técnica leída no tiene ${TECHNICAL_KEY_LENGTHS_LABEL} caracteres hexadecimales (leyó ${value.length}). Cópiala a mano desde la resolución.`,
      };
    }
    return {
      value,
      confidence,
      verified: false,
      warning:
        'Verifica la clave técnica carácter por carácter contra la resolución: un solo carácter mal leído invalida el CUFE de todas las facturas.',
    };
  }

  private buildEnvironment(
    raw: unknown,
    confidence: number,
    prefix: string | null,
    technicalKey: string | null,
    testSetId: string | null,
  ): HabilitationScanField<ScannedHabilitationEnvironment> {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase() as ScannedHabilitationEnvironment;

    if (ENVIRONMENTS.has(value)) {
      return this.checkedField(value, confidence);
    }

    // Fall back to what the documents' own shape implies: a TestSetId, a clave
    // técnica or the SETP prefix only ever appear in habilitación.
    if (testSetId || technicalKey || prefix === 'SETP') {
      return {
        value: 'test',
        confidence,
        verified: true,
        warning:
          'Ambiente deducido como habilitación (pruebas) por el set de pruebas, la clave técnica o el prefijo SETP. Confírmalo.',
      };
    }
    return this.emptyField(
      'No se determinó el ambiente (pruebas o producción). Selecciónalo.',
    );
  }

  /**
   * A range is only usable as a pair. When the bounds are inverted or absurdly
   * wide, both fields drop to unverified — pre-filling one of them would let
   * the user save a half-corrected range.
   */
  private applyRangeCoherence(
    from: HabilitationScanField<number>,
    to: HabilitationScanField<number>,
  ): void {
    if (from.value === null || to.value === null) return;

    if (to.value <= from.value) {
      const warning = `El rango leído (${from.value} → ${to.value}) está invertido o es de un solo número. Corrígelo a mano.`;
      from.verified = false;
      from.warning = warning;
      to.verified = false;
      to.warning = warning;
      return;
    }

    if (to.value - from.value > MAX_RANGE_SPAN) {
      const warning = `El rango leído abarca ${(to.value - from.value).toLocaleString('es-CO')} números, más de lo que autoriza una resolución típica. Verifícalo.`;
      from.verified = false;
      from.warning = warning;
      to.verified = false;
      to.warning = warning;
    }
  }

  private applyValidityCoherence(
    from: HabilitationScanField<string>,
    to: HabilitationScanField<string>,
  ): void {
    if (!from.value || !to.value) return;

    if (to.value <= from.value) {
      const warning = `La vigencia leída (${from.value} → ${to.value}) termina antes de empezar. Corrígela a mano.`;
      from.verified = false;
      from.warning = warning;
      to.verified = false;
      to.warning = warning;
    }
  }

  /**
   * Fields the UI must show as "confírmalo": read but not provably right, or
   * read with low model confidence. The clave técnica and the PIN are always
   * here by design.
   */
  private collectManualConfirmations(
    result: DianHabilitationScanResult,
  ): string[] {
    return SCANNED_FIELD_KEYS.filter((key) => {
      const field = result[key] as HabilitationScanField<unknown>;
      if (field.value === null) return false; // nothing to confirm — it's empty
      return !field.verified || field.confidence < LOW_CONFIDENCE_THRESHOLD;
    }) as unknown as string[];
  }

  /**
   * Nothing here blocks: the DIAN step of the wizard is optional as a whole and
   * the resolution block is all-or-nothing at the form level. What the user
   * needs is the honest list of what the photos did not carry, so they know
   * what is left to type.
   */
  private collectMissingFields(result: DianHabilitationScanResult): string[] {
    return SCANNED_FIELD_KEYS.filter((key) => {
      const field = result[key] as HabilitationScanField<unknown>;
      return field.value === null;
    }) as unknown as string[];
  }

  // --- primitives ---

  private checkedField<T>(
    value: T,
    confidence: number,
  ): HabilitationScanField<T> {
    return {
      value,
      confidence,
      verified: true,
      warning:
        confidence < LOW_CONFIDENCE_THRESHOLD
          ? 'La IA leyó este campo con baja confianza. Verifícalo.'
          : null,
    };
  }

  private emptyField<T>(warning: string): HabilitationScanField<T> {
    return { value: null, confidence: 0, verified: false, warning };
  }

  private clampConfidence(raw: unknown): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    return Math.round(Math.max(0, Math.min(100, value)));
  }

  /**
   * `2025-02-30` matches the ISO shape but is not a date. Round-tripping through
   * `Date` and comparing the string back is what catches it.
   */
  private isRealCalendarDate(iso: string): boolean {
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.toISOString().slice(0, 10) === iso;
  }

  private trimOrNull(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    return value && value !== 'null' ? value : null;
  }
}

/** Keys the scanner reports on — re-exported for the controller's validation. */
export type { ScannedFieldKey };
