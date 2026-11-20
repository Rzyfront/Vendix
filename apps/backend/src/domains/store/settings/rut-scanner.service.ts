import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { normalizeFiscalResponsibilityCode } from '@common/constants/fiscal-responsibilities';
import { AiScanFile } from '@common/ai-scan-jobs/interfaces/ai-scan-job.interface';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import {
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { toScannerError } from '@common/ai-ingest/extraction/scanner-errors';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import {
  readDocumentWithAi,
  ReadDocumentResult,
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
  RUT_FIELD_LABELS,
  RUT_INGEST_PROFILE,
  RUT_SCAN_INSTRUCTION,
} from './rut-ingest.profile';

/**
 * Normalized RUT extraction contract.
 *
 * Every field is already mapped to the legal/tax form enums/codes so the
 * frontend can patch the `fiscal_data` form 1:1 without any further mapping.
 */
export interface RutScanResult {
  /** Solo número, SIN dígito de verificación. */
  nit: string;
  /** Un solo dígito de verificación. */
  nit_dv: string;
  /** RUT siempre es NIT. */
  nit_type: 'NIT';
  /** Razón social / nombre. */
  legal_name: string;
  person_type: 'NATURAL' | 'JURIDICA' | '';
  tax_regime: 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE' | '';
  /** Código CIIU de actividad principal (ej 4711). */
  ciiu: string;
  /** Dirección fiscal (línea). */
  fiscal_address: string;
  /** ISO-3166 alfa-2, siempre 'CO' para RUT colombiano. */
  country: string;
  /** Nombre del departamento (ej 'Cundinamarca'). */
  department: string;
  /** Nombre de la ciudad/municipio (ej 'Bogotá'). */
  city: string;
  /** Códigos de responsabilidades del RUT casilla 53 normalizados (01-61 vigentes y R-99-PN). */
  tax_responsibilities: string[];
  /** Responsabilidad principal del emisor, como código RUT normalizado. */
  tax_scheme: string;
  /** 0-100. */
  confidence: number;
  extraction_notes: string | null;
  /** Avisos de lectura en español (páginas sin leer, valores en conflicto). Opcional. */
  warnings?: string[];
  /** Qué se leyó (páginas, páginas de texto, llamadas). Opcional. */
  scan_source?: DocumentScanSource;
}

function toAiScanFile(file: Express.Multer.File): AiScanFile {
  return {
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size,
  };
}

@Injectable()
export class RutScannerService {
  private readonly logger = new Logger(RutScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly extraction: AiExtractionService,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /**
   * Scans a Colombian RUT document (image or PDF) and returns normalized
   * fiscal identity data ready to pre-fill the legal/tax form.
   *
   * Reads it through the common ai-ingest reader (`scanRutFromFiles`).
   */
  async scanRutDocument(file: Express.Multer.File): Promise<RutScanResult> {
    return this.scanRutFromFiles([toAiScanFile(file)]);
  }

  /** Validación previa a la IA; el controller async la llama ANTES de encolar. */
  async assertReady(): Promise<void> {
    // Sin modelo de visión enlazado, `run()` cae al config de texto por defecto
    // y devuelve una identidad fiscal inventada con pinta de válida.
    await this.aiEngine.assertVisionModelLinked('rut_scanner');
  }

  /**
   * Núcleo del escaneo (handler `rut` de la cola `ai-scan`), por el lector
   * común de ai-ingest (plan ia-cargas F5b, #12):
   *
   * - El tipo real se detecta por firma; nunca viaja el PDF crudo.
   * - Cada página del PDF va con su texto nativo Y su imagen: el texto da los
   *   dígitos exactos del NIT y la imagen conserva las casillas del formulario.
   *   Una foto se endereza (EXIF) y se reduce a 1536 px como antes.
   * - Todas las páginas van en UNA llamada (hasta 10), validada con esquema y
   *   reparada una vez si no cuadra.
   * - Desde ahí, la misma `normalizeRutResponse`: con la misma respuesta del
   *   modelo, NIT, DV, razón social, responsabilidades y régimen son idénticos.
   */
  async scanRutFromFiles(
    files: AiScanFile[],
    options: { reportProgress?: (progress: AiJobProgress) => Promise<void> } = {},
  ): Promise<RutScanResult> {
    const file = files[0];
    this.logger.debug(
      `[RutScan] File: mimetype=${file?.mimeType}, size=${file?.size}, buffer=${file?.buffer?.length ?? 'NO BUFFER'}`,
    );

    await this.assertReady();

    const detected = detectQueuedDocument(
      { buffer: file?.buffer, originalname: file?.originalName, mimetype: file?.mimeType },
      'El RUT debe ser un PDF o una foto (JPG, PNG o WebP).',
    );

    let read: ReadDocumentResult<Record<string, unknown>>;
    try {
      read = await readDocumentWithAi<Record<string, unknown>>({
        file: { buffer: file.buffer, originalName: file.originalName ?? 'rut' },
        mimeType: detected.mime,
        pages: this.documentPages,
        extraction: this.extraction,
        appKey: 'rut_scanner',
        schema: RUT_INGEST_PROFILE.documentSchema,
        instruction: (batch, context) =>
          buildFormInstruction(RUT_SCAN_INSTRUCTION, batch, context),
        limits: RUT_INGEST_PROFILE.limits,
        maxBytes: RUT_INGEST_PROFILE.limits.maxBytes,
        // Una foto sigue siendo UNA imagen, como antes.
        splitTallImages: false,
        renderTextPages: true,
        // Una unidad de cuota por escaneo, como la llamada única de antes.
        quotaKey: newIngestQuotaKey(),
        reportProgress: options.reportProgress,
        logLabel: 'RutScan',
        rawExtractionErrors: true,
      });
    } catch (err) {
      this.logger.error(`AI RUT extraction failed: ${(err as Error)?.message}`);
      throw toScannerError(err, {
        parseFail: ErrorCodes.RUT_SCAN_PARSE_FAIL,
        // Se propaga el error del proveedor: "la foto está ilegible" y "el
        // modelo enlazado a esta app no acepta imágenes" son causas distintas
        // y la segunda no se arregla tomando otra foto.
        aiFail: ErrorCodes.RUT_SCAN_AI_FAIL,
        aiFailMessage: (e) => `La IA no pudo leer el RUT: ${e}`,
      });
    }

    const merged = mergeFormAnswers(read.answers);
    let result: RutScanResult;
    try {
      result = this.normalizeRutResponse(merged.data);
    } catch (err) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(`Failed to normalize AI RUT response: ${(err as Error)?.message}`);
      throw new VendixHttpException(ErrorCodes.RUT_SCAN_PARSE_FAIL);
    }
    const warnings = [
      ...read.warnings,
      ...conflictWarnings(merged.conflicts, RUT_FIELD_LABELS),
    ];
    return {
      ...result,
      ...(warnings.length ? { warnings } : {}),
      scan_source: scanSourceOf(read),
    };
  }

  // --- Private helpers ---

  private normalizeRutResponse(parsed: any): RutScanResult {
    const PERSON_TYPES = new Set(['NATURAL', 'JURIDICA']);
    const TAX_REGIMES = new Set([
      'COMUN',
      'SIMPLIFICADO',
      'GRAN_CONTRIBUYENTE',
    ]);

    const personType = String(parsed.person_type || '')
      .trim()
      .toUpperCase();
    const taxRegime = String(parsed.tax_regime || '')
      .trim()
      .toUpperCase();

    const responsibilities = Array.isArray(parsed.tax_responsibilities)
      ? parsed.tax_responsibilities
          .map((r: any) => normalizeFiscalResponsibilityCode(String(r || '').trim()))
          .filter((r: string) => r.length > 0)
      : [];

    const rawTaxScheme = String(parsed.tax_scheme ?? '').trim();
    const taxScheme = rawTaxScheme
      ? normalizeFiscalResponsibilityCode(rawTaxScheme)
      : '';

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      nit: String(parsed.nit ?? '').trim(),
      nit_dv: String(parsed.nit_dv ?? '').trim(),
      nit_type: 'NIT',
      legal_name: String(parsed.legal_name ?? '').trim(),
      person_type: PERSON_TYPES.has(personType)
        ? (personType as 'NATURAL' | 'JURIDICA')
        : '',
      tax_regime: TAX_REGIMES.has(taxRegime)
        ? (taxRegime as 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE')
        : '',
      ciiu: String(parsed.ciiu ?? '').trim(),
      fiscal_address: String(parsed.fiscal_address ?? '').trim(),
      country: String(parsed.country ?? 'CO').trim().toUpperCase() || 'CO',
      department: String(parsed.department ?? '').trim(),
      city: String(parsed.city ?? '').trim(),
      tax_responsibilities: responsibilities,
      tax_scheme: taxScheme,
      confidence,
      extraction_notes:
        parsed.extraction_notes != null && String(parsed.extraction_notes).trim()
          ? String(parsed.extraction_notes).trim()
          : null,
    };
  }
}
