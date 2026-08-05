import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import sharp = require('sharp');

/**
 * One extracted field, already checked against the shape the DIAN actually
 * authorizes.
 *
 * `verified` is deliberately NOT "the model was confident": it means the value
 * passed a structural rule we can prove (a real calendar date, a positive
 * integer, 40 hex characters). A field the model was sure about but that fails
 * its rule arrives with `value: null` — a wrong resolution range emits invoices
 * outside the authorized numbering, which the DIAN rejects one by one.
 */
export interface ResolutionScanField<T> {
  value: T | null;
  /** 0-100, as reported by the model for this field alone. */
  confidence: number;
  /** The value passed its structural rule and may be pre-filled. */
  verified: boolean;
  /** Why a human still has to look at it, or null. */
  warning: string | null;
}

export type ScannedResolutionDocumentType = 'sales_invoice' | 'support_document';
export type ScannedResolutionEnvironment = 'test' | 'production';

/**
 * Result of scanning a DIAN numbering resolution.
 *
 * Nothing here is persisted: the endpoint reads a file and answers. Writing a
 * resolution stays an explicit `POST`/`PATCH` the user triggers after reviewing
 * these fields — the scan is a typist, not an author.
 */
export interface DianResolutionScanResult {
  prefix: ResolutionScanField<string>;
  document_type: ResolutionScanField<ScannedResolutionDocumentType>;
  resolution_number: ResolutionScanField<string>;
  resolution_date: ResolutionScanField<string>;
  range_from: ResolutionScanField<number>;
  range_to: ResolutionScanField<number>;
  valid_from: ResolutionScanField<string>;
  valid_to: ResolutionScanField<string>;
  technical_key: ResolutionScanField<string>;
  environment: ResolutionScanField<ScannedResolutionEnvironment>;
  /** 0-100 overall scan quality reported by the model. */
  confidence: number;
  /** Field keys the user must confirm by hand before saving. */
  requires_manual_confirmation: string[];
  /** Human-readable reasons the extraction cannot be saved as-is. */
  blocking_issues: string[];
  extraction_notes: string | null;
}

/** Below this, a field is pre-filled but flagged for manual confirmation. */
const LOW_CONFIDENCE_THRESHOLD = 75;

const DOCUMENT_TYPES = new Set<ScannedResolutionDocumentType>([
  'sales_invoice',
  'support_document',
]);
const ENVIRONMENTS = new Set<ScannedResolutionEnvironment>([
  'test',
  'production',
]);

/** DIAN prefixes are short and alphanumeric (FE, SETP, FV, POS1). */
const PREFIX_RE = /^[A-Z0-9]{1,10}$/;
const RESOLUTION_NUMBER_RE = /^\d{4,25}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TECHNICAL_KEY_RE = /^[0-9a-f]{40}$/;

/** Sanity ceiling for a single authorized range. */
const MAX_RANGE_SPAN = 500_000_000;

@Injectable()
export class ResolutionScannerService {
  private readonly logger = new Logger(ResolutionScannerService.name);

  constructor(private readonly aiEngine: AIEngineService) {}

  /**
   * Scans a DIAN numbering-resolution document (image or PDF) and returns the
   * fields needed to create an `invoice_resolutions` row, each one annotated
   * with whether it can be trusted.
   *
   * Mirrors `RutScannerService.scanRutDocument`: sharp preprocesses images and
   * PDFs pass through raw as a data-uri the vision model reads natively.
   */
  async scanResolutionDocument(
    file: Express.Multer.File,
  ): Promise<DianResolutionScanResult> {
    this.logger.debug(
      `[ResolutionScan] File: mimetype=${file.mimetype}, size=${file.size}, buffer=${file.buffer?.length ?? 'NO BUFFER'}`,
    );

    // Antes de gastar la llamada: sin modelo de visión enlazado, `run()` cae al
    // config de texto por defecto y devuelve JSON inventado con pinta de válido.
    // En una resolución DIAN eso sería un rango falso que la numeración legal
    // acabaría usando.
    await this.aiEngine.assertVisionModelLinked('dian_resolution_scanner');

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    const documentMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract the numbering-resolution data from this Colombian DIAN resolution document. Return ONLY the JSON object matching the schema defined in your system instructions.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const response = await this.aiEngine.run('dian_resolution_scanner', {}, [
      documentMessage,
    ]);

    this.logger.debug(
      `[ResolutionScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(
        `AI DIAN resolution extraction failed: ${response.error}`,
      );
      // Se propaga el error del proveedor. Un 502 genérico dejaba dos causas muy
      // distintas indistinguibles: "la foto está ilegible" y "el modelo
      // enlazado a esta app no acepta imágenes" — la segunda no se arregla
      // tomando otra foto, se arregla enlazando un modelo de visión.
      throw new VendixHttpException(
        ErrorCodes.RESOLUTION_SCAN_AI_FAIL,
        response.error
          ? `La IA no pudo leer la resolución: ${response.error}`
          : undefined,
      );
    }

    try {
      const parsed = parseAiJson(response.content);
      return this.normalizeResponse(parsed);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `Failed to parse AI DIAN resolution response: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.RESOLUTION_SCAN_PARSE_FAIL);
    }
  }

  // --- Private helpers ---

  /**
   * Same two-path preprocessing as the RUT scanner: sharp for images, raw
   * passthrough when sharp throws (PDFs and unsupported formats), so a PDF
   * reaches the vision model untouched instead of failing the request.
   */
  private async preprocessImage(
    file: Express.Multer.File,
  ): Promise<{ base64: string; mimeType: string }> {
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

      const processedBuffer = await pipeline
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[ResolutionScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  private normalizeResponse(raw: unknown): DianResolutionScanResult {
    const parsed = (raw ?? {}) as Record<string, unknown>;
    const fieldConfidence = (parsed.field_confidence ?? {}) as Record<
      string,
      unknown
    >;
    const scoreOf = (key: string): number =>
      this.clampConfidence(fieldConfidence[key]);

    const prefix = this.buildPrefix(parsed.prefix, scoreOf('prefix'));
    const documentType = this.buildDocumentType(
      parsed.document_type,
      scoreOf('document_type'),
    );
    const resolutionNumber = this.buildResolutionNumber(
      parsed.resolution_number,
      scoreOf('resolution_number'),
    );
    const resolutionDate = this.buildDate(
      parsed.resolution_date,
      scoreOf('resolution_date'),
      'fecha de la resolución',
    );
    const rangeFrom = this.buildInteger(
      parsed.range_from,
      scoreOf('range_from'),
      'rango inicial',
    );
    const rangeTo = this.buildInteger(
      parsed.range_to,
      scoreOf('range_to'),
      'rango final',
    );
    const validFrom = this.buildDate(
      parsed.valid_from,
      scoreOf('valid_from'),
      'inicio de vigencia',
    );
    const validTo = this.buildDate(
      parsed.valid_to,
      scoreOf('valid_to'),
      'fin de vigencia',
    );
    const technicalKey = this.buildTechnicalKey(
      parsed.technical_key,
      scoreOf('technical_key'),
    );
    const environment = this.buildEnvironment(
      parsed.environment,
      scoreOf('environment'),
      prefix.value,
      technicalKey.value,
    );

    // Cross-field rules. These cannot live in the per-field builders because
    // each one only sees its own value.
    this.applyRangeCoherence(rangeFrom, rangeTo);
    this.applyValidityCoherence(validFrom, validTo);

    const result: DianResolutionScanResult = {
      prefix,
      document_type: documentType,
      resolution_number: resolutionNumber,
      resolution_date: resolutionDate,
      range_from: rangeFrom,
      range_to: rangeTo,
      valid_from: validFrom,
      valid_to: validTo,
      technical_key: technicalKey,
      environment,
      confidence: this.clampConfidence(parsed.confidence),
      requires_manual_confirmation: [],
      blocking_issues: [],
      extraction_notes: this.trimOrNull(parsed.extraction_notes),
    };

    result.requires_manual_confirmation =
      this.collectManualConfirmations(result);
    result.blocking_issues = this.collectBlockingIssues(result);

    return result;
  }

  private buildPrefix(
    raw: unknown,
    confidence: number,
  ): ResolutionScanField<string> {
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

  private buildDocumentType(
    raw: unknown,
    confidence: number,
  ): ResolutionScanField<ScannedResolutionDocumentType> {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase() as ScannedResolutionDocumentType;

    if (!DOCUMENT_TYPES.has(value)) {
      return this.emptyField(
        'No se determinó si la resolución es de factura de venta o de documento soporte.',
      );
    }
    return this.checkedField(value, confidence);
  }

  private buildResolutionNumber(
    raw: unknown,
    confidence: number,
  ): ResolutionScanField<string> {
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
  ): ResolutionScanField<string> {
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
  ): ResolutionScanField<number> {
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
   * The clave técnica is the one field that is never auto-trusted.
   *
   * It is 40 random hex characters feeding the CUFE hash: a single mis-read
   * character produces a syntactically perfect resolution whose every invoice
   * the DIAN rejects for an invalid CUFE — with no hint that OCR was the cause.
   * So even a perfectly-shaped key comes back `verified: false`.
   */
  private buildTechnicalKey(
    raw: unknown,
    confidence: number,
  ): ResolutionScanField<string> {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '');

    if (!value) {
      return this.emptyField(
        'No se leyó clave técnica. Solo las resoluciones de habilitación la traen.',
      );
    }
    if (!TECHNICAL_KEY_RE.test(value)) {
      return {
        value: null,
        confidence,
        verified: false,
        warning: `La clave técnica leída no tiene 40 caracteres hexadecimales (leyó ${value.length}). Cópiala a mano desde la resolución.`,
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
  ): ResolutionScanField<ScannedResolutionEnvironment> {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase() as ScannedResolutionEnvironment;

    if (ENVIRONMENTS.has(value)) {
      return this.checkedField(value, confidence);
    }

    // Fall back to what the document's own shape implies: a clave técnica or
    // the SETP prefix only ever appear on the habilitación resolution.
    if (technicalKey || prefix === 'SETP') {
      return {
        value: 'test',
        confidence,
        verified: false,
        warning:
          'Ambiente deducido como pruebas por la clave técnica o el prefijo SETP. Confírmalo.',
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
    from: ResolutionScanField<number>,
    to: ResolutionScanField<number>,
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
    from: ResolutionScanField<string>,
    to: ResolutionScanField<string>,
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
   * read with low model confidence. The clave técnica is always here by design.
   */
  private collectManualConfirmations(
    result: DianResolutionScanResult,
  ): string[] {
    const keys: (keyof DianResolutionScanResult)[] = [
      'prefix',
      'document_type',
      'resolution_number',
      'resolution_date',
      'range_from',
      'range_to',
      'valid_from',
      'valid_to',
      'technical_key',
      'environment',
    ];

    return keys.filter((key) => {
      const field = result[key] as ResolutionScanField<unknown>;
      if (field.value === null) return false; // nothing to confirm — it's empty
      return !field.verified || field.confidence < LOW_CONFIDENCE_THRESHOLD;
    }) as string[];
  }

  /**
   * What makes the extraction unusable as a resolution, in the user's words.
   * The frontend keeps its "Usar estos datos" button enabled and shows these
   * instead of silently disabling itself.
   */
  private collectBlockingIssues(result: DianResolutionScanResult): string[] {
    const issues: string[] = [];

    if (!result.prefix.value) {
      issues.push('Falta el prefijo autorizado.');
    }
    if (result.range_from.value === null || result.range_to.value === null) {
      issues.push('Falta el rango de numeración autorizado (desde / hasta).');
    }
    if (!result.document_type.value) {
      issues.push(
        'Falta el tipo de documento (factura de venta o documento soporte).',
      );
    }
    return issues;
  }

  // --- primitives ---

  private checkedField<T>(value: T, confidence: number): ResolutionScanField<T> {
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

  private emptyField<T>(warning: string): ResolutionScanField<T> {
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
