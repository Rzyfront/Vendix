import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import type { AiJobProgress } from '@common/ai-scan-jobs/ai-job-monitor.service';
import {
  AiExtractionError,
  AiExtractionService,
  newIngestQuotaKey,
} from '@common/ai-ingest/extraction/ai-extraction.service';
import { DocumentPagesService } from '@common/ai-ingest/documents/document-pages.service';
import {
  readDocumentWithAi,
  ReadDocumentResult,
} from '@common/ai-ingest/documents/document-reader';
import {
  decodeDataUri,
  detectQueuedDocument,
} from '@common/ai-ingest/documents/queued-document';
import {
  ExpenseLineItem,
  ExpenseScanResult,
  ExpenseScanResponse,
  MatchedCategory,
} from './dto/scan-expense.dto';
import {
  buildExpenseInstruction,
  EXPENSE_INGEST_PROFILE,
  mergeExpenseBatches,
} from './expense-ingest.profile';

export interface ExpenseScanFile {
  buffer: Buffer;
  /** Declared type (multipart/S3); the real one is detected by signature. */
  mimeType?: string | null;
  originalName?: string | null;
}

export interface ExpenseScanRunOptions {
  reportProgress?: (progress: AiJobProgress) => Promise<void>;
}

@Injectable()
export class ExpenseScannerService {
  private readonly logger = new Logger(ExpenseScannerService.name);

  /**
   * Stopwords en español que se filtran del matching Tier 3 (word overlap) para
   * no inflar el score con palabras vacías.
   */
  private static readonly STOPWORDS_ES = new Set([
    'de',
    'la',
    'el',
    'y',
    'en',
    'los',
    'las',
    'del',
    'un',
    'una',
  ]);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly extraction: AiExtractionService,
    private readonly documentPages: DocumentPagesService,
  ) {}

  /**
   * Real type of an upload, checked in the HTTP request before enqueueing:
   * only a PDF or a photo (JPG, PNG, WebP; HEIC only if the server decodes
   * it). Anything else is `AI_INGEST_INVALID_FILE`, a problem of the document.
   */
  assertValidScanFile(file: { buffer: Buffer; originalname?: string; mimetype?: string }) {
    return detectQueuedDocument(
      file,
      'La factura debe ser un PDF o una foto (JPG, PNG o WebP).',
    );
  }

  /**
   * WORKER path (BullMQ). Lee la factura por el lector común de ai-ingest
   * (plan ia-cargas F5a, #7) y luego hace el matching de categoría. Debe
   * correr dentro de `RequestContextService.run(...)` (lo hace el processor)
   * para que el matching organization-scoped funcione.
   *
   * - Un PDF se lee por páginas con el texto nativo primero (las escaneadas
   *   como imagen); nunca viaja crudo. Una foto se endereza (EXIF) y se
   *   reduce a 1536 px como antes.
   * - Hasta 5 páginas van en UNA llamada; una factura más larga se lee en
   *   lotes que se fusionan (`mergeExpenseBatches`) en UNA respuesta cruda.
   * - La respuesta se valida con esquema (ajv) y, si no cuadra, se repara una
   *   vez. Desde ahí todo sigue igual: la misma
   *   `normalizeExpenseOcrResponse` (montos, impuestos, moneda) y el mismo
   *   matching de categoría. `warnings` y `scan_source` son opcionales.
   */
  async scanFromFile(
    file: ExpenseScanFile,
    options: ExpenseScanRunOptions = {},
  ): Promise<ExpenseScanResponse> {
    const detected = detectQueuedDocument(
      { buffer: file.buffer, originalname: file.originalName ?? undefined, mimetype: file.mimeType ?? undefined },
      'La factura debe ser un PDF o una foto (JPG, PNG o WebP).',
    );
    this.logger.debug(
      `[ExpenseScan] Reading document: mime=${detected.mime}, bytes=${file.buffer.length}`,
    );

    const read = await this.readPages(() =>
      readDocumentWithAi<Record<string, any>>({
        file: { buffer: file.buffer, originalName: file.originalName ?? 'factura' },
        mimeType: detected.mime,
        pages: this.documentPages,
        extraction: this.extraction,
        appKey: 'expense_invoice_ocr',
        schema: EXPENSE_INGEST_PROFILE.documentSchema,
        instruction: buildExpenseInstruction,
        limits: EXPENSE_INGEST_PROFILE.limits,
        maxBytes: EXPENSE_INGEST_PROFILE.limits.maxBytes,
        // A photo stays ONE image, as before: strips of a tall receipt could
        // read a line twice in their overlap and double an amount.
        splitTallImages: false,
        // One unit of quota per scan, as the single call charged before.
        quotaKey: newIngestQuotaKey(),
        reportProgress: options.reportProgress,
        logLabel: 'ExpenseScan',
      }),
    );

    const merged = mergeExpenseBatches(read.batches);
    const scan = this.normalizeExpenseOcrResponse(merged.data);
    const matched_category = await this.matchCategory(
      scan.supplier_name,
      scan.line_items,
    );
    const warnings = [...read.warnings, ...merged.warnings];
    return {
      scan,
      matched_category,
      ...(warnings.length ? { warnings } : {}),
      scan_source: {
        pages: read.pages,
        text_pages: read.textPages,
        batches: read.batches.length,
        ...(read.missingPages.length ? { missing_pages: read.missingPages } : {}),
      },
    };
  }

  /**
   * Jobs queued before F5a carried a data URI (a JPEG prepared at enqueue, or
   * the raw PDF as base64). They still work: the bytes go through the same
   * reader as a new job.
   */
  async scanFromImage(
    dataUri: string,
    mimeType: string,
    options: ExpenseScanRunOptions = {},
  ): Promise<ExpenseScanResponse> {
    const decoded = decodeDataUri(dataUri);
    if (!decoded) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_INVALID_FILE,
        'El documento del escaneo no llegó completo. Súbelo de nuevo.',
      );
    }
    return this.scanFromFile(
      { buffer: decoded.buffer, mimeType: mimeType || decoded.mime },
      options,
    );
  }

  // --- Private helpers ---

  /**
   * Keeps the scanner's error contract: an unusable model answer is still
   * `INV_SCAN_PARSE_FAIL` and an AI failure `INV_SCAN_AI_FAIL` (the queue
   * retries both). Document problems keep their `AI_INGEST_*` code (no pages,
   * too many pages, unsupported type, cut answer) and credits / rate limit
   * their `AI_PROVIDER_*` one.
   */
  private async readPages<T>(
    run: () => Promise<ReadDocumentResult<T>>,
  ): Promise<ReadDocumentResult<T>> {
    try {
      return await run();
    } catch (err) {
      const error = err instanceof AiExtractionError ? err.toHttpException() : err;
      if (error instanceof VendixHttpException) {
        if (error.errorCode === ErrorCodes.AI_INGEST_PARSE_FAIL.code) {
          throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
        }
        if (error.errorCode === ErrorCodes.AI_REQUEST_001.code) {
          throw new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
        }
      }
      throw error;
    }
  }

  /**
   * Matching fuzzy de categoría: combina el nombre del proveedor + las
   * descripciones de los items como texto candidato y lo compara contra
   * las `expense_categories` activas del org.
   *
   * Tiers:
   *  - Tier 1: match exacto case-insensitive = 100
   *  - Tier 2: normalized contains (sin acentos, trim, lower) = 65 + ratio*20 (cap 85)
   *  - Tier 3: word overlap (filtrando stopwords ES) = (matches/maxWords)*60
   *
   * Umbral ≥65 → retorna {id, name, confidence}; si no → null.
   */
  private async matchCategory(
    supplierName: string | null,
    lineItems: ExpenseLineItem[],
  ): Promise<MatchedCategory | null> {
    const candidateText = `${supplierName ?? ''} ${lineItems
      .map((i) => i.description)
      .join(' ')}`.trim();

    if (!candidateText) return null;

    try {
      const categories = await this.prisma.expense_categories.findMany({
        where: {
          ...this.prisma.organizationWhere,
          is_active: true,
        },
        select: { id: true, name: true },
      });

      if (categories.length === 0) return null;

      const candidateLower = this.normalizeText(candidateText);
      let bestMatch: { id: number; name: string } | null = null;
      let bestScore = 0;

      for (const cat of categories) {
        const catLower = this.normalizeText(cat.name);
        if (!catLower) continue;

        // Tier 1: exact match
        if (catLower === candidateLower) {
          return { id: cat.id, name: cat.name, confidence: 100 };
        }

        // Tier 2: bidirectional normalized contains
        if (
          catLower.includes(candidateLower) ||
          candidateLower.includes(catLower)
        ) {
          const ratio =
            Math.min(candidateLower.length, catLower.length) /
            Math.max(candidateLower.length, catLower.length);
          const score = Math.min(85, 65 + ratio * 20);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = cat;
          }
          continue;
        }

        // Tier 3: word overlap (filtrando stopwords ES)
        const candidateWords = candidateLower
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 1 &&
              !ExpenseScannerService.STOPWORDS_ES.has(w),
          );
        const catWords = catLower
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 1 &&
              !ExpenseScannerService.STOPWORDS_ES.has(w),
          );

        if (candidateWords.length === 0 || catWords.length === 0) continue;

        let matches = 0;
        for (const cw of candidateWords) {
          for (const dw of catWords) {
            if (dw.includes(cw) || cw.includes(dw)) {
              matches++;
              break;
            }
          }
        }

        const score =
          (matches / Math.max(candidateWords.length, catWords.length)) *
          60;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = cat;
        }
      }

      if (bestMatch && bestScore >= 65) {
        return {
          id: bestMatch.id,
          name: bestMatch.name,
          confidence: Math.round(bestScore),
        };
      }

      return null;
    } catch (err: any) {
      this.logger.warn(
        `Expense category matching failed gracefully: ${err?.message}`,
      );
      return null;
    }
  }

  /**
   * Normaliza texto: quita acentos/tildes, trim, lower.
   */
  private normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Model answer → `ExpenseScanResult`. Unchanged since before ia-cargas: the
   * amounts, taxes and currency of a given answer are the same as always.
   */
  normalizeExpenseOcrResponse(parsed: any): ExpenseScanResult {
    const lineItems: ExpenseLineItem[] = Array.isArray(parsed.line_items)
      ? parsed.line_items.map((item: any, idx: number) => ({
          description: String(item.description ?? ''),
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          amount: Number(item.amount) || 0,
          line_index:
            Number.isFinite(Number(item.line_index))
              ? Number(item.line_index)
              : idx,
        }))
      : [];

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(100, confidence));

    return {
      supplier_name:
        parsed.supplier_name != null ? String(parsed.supplier_name) : null,
      supplier_tax_id:
        parsed.supplier_tax_id != null
          ? String(parsed.supplier_tax_id)
          : null,
      invoice_number:
        parsed.invoice_number != null
          ? String(parsed.invoice_number)
          : null,
      invoice_date:
        parsed.invoice_date != null ? String(parsed.invoice_date) : null,
      currency: String(parsed.currency ?? 'COP') || 'COP',
      line_items: lineItems,
      subtotal: Number(parsed.subtotal) || 0,
      tax_amount:
        parsed.tax_amount != null ? Number(parsed.tax_amount) || 0 : null,
      total: Number(parsed.total) || 0,
      confidence,
      extraction_notes:
        parsed.extraction_notes != null &&
        String(parsed.extraction_notes).trim()
          ? String(parsed.extraction_notes).trim()
          : null,
    };
  }
}