import { Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import type { AiJobProgress } from '../../ai-scan-jobs/ai-job-monitor.service';
import {
  AiExtractionError,
  AiExtractionService,
  ExtractionSchema,
} from '../extraction/ai-extraction.service';
import type { IngestLimits } from '../profiles/ingest-profile.interface';
import {
  AiDocumentPage,
  DocumentPagesService,
} from './document-pages.service';
import { pagesMessageContent } from './page-content';

export interface ReadDocumentFile {
  buffer: Buffer;
  originalName?: string | null;
}

/** Where a batch sits in the document, for a per-batch instruction. */
export interface ReadDocumentBatchContext {
  /** Pages (or photo strips) prepared for the model. */
  totalPages: number;
  /** Batches the document was cut into (1 = the whole document at once). */
  totalBatches: number;
}

export interface ReadDocumentOptions {
  file: ReadDocumentFile;
  /** REAL type from the ai-ingest detector (never the multipart/S3 one). */
  mimeType: string;
  pages: DocumentPagesService;
  extraction: AiExtractionService;
  appKey: string;
  /** Schema of the answer for ONE batch of pages. */
  schema: ExtractionSchema;
  /**
   * First text of every batch message. A function gets the batch pages, so a
   * multi-batch document can say "pages 6–10 of 12".
   */
  instruction:
    | string
    | ((batch: AiDocumentPage[], context: ReadDocumentBatchContext) => string);
  limits: Pick<IngestLimits, 'maxPages' | 'pagesPerBatch'>;
  /** Upload size cap (bytes). Default: the pages service default (10 MiB). */
  maxBytes?: number;
  /** Longest edge of photos. Default: the image-prep default (1536 px). */
  imageMaxEdge?: number;
  /** Cut very tall photos into overlapping strips. Default true. */
  splitTallImages?: boolean;
  /** One per load: every batch, repair and split charges the same unit. */
  quotaKey: string;
  reportProgress?: (progress: AiJobProgress) => Promise<void>;
  /** Calls in flight. Default 3. */
  concurrency?: number;
  logLabel?: string;
  /** Template variables of the app prompt (e.g. `{{user_note}}`). Default none. */
  variables?: Record<string, string>;
  /** Fiscal forms: text pages also go with their image (see `renderTextPages`). */
  renderTextPages?: boolean;
  /**
   * Throw the {@link AiExtractionError} itself instead of its HTTP form, so a
   * scanner keeps its own error codes and the provider's message (fiscal
   * scanners: "the linked model does not accept images" is not a bad photo).
   */
  rawExtractionErrors?: boolean;
}

export interface ReadDocumentResult<T> {
  /** One validated answer per batch of pages, in page order. */
  answers: T[];
  /** Same answers with the page numbers each one read, in page order. */
  batches: Array<{ pages: number[]; data: T }>;
  /** Pages (or photo strips) read. */
  pages: number;
  /** Pages read from native PDF text only. */
  textPages: number;
  /** Pages that could not be read (unreadable or a batch the model failed). */
  missingPages: number[];
  /** Spanish, ready to show: pages left out and why. */
  warnings: string[];
}

const logger = new Logger('AiIngestDocumentReader');

function pageList(pages: AiDocumentPage[]): string {
  const doc = pages[0]?.document;
  const prefix = doc && doc.count > 1 ? ` del documento ${doc.index}` : '';
  const strips = pages[0]?.strip;
  const numbers = pages.map((p) => p.page_number).join(', ');
  return strips
    ? `${pages.length > 1 ? 'Las partes' : 'La parte'} ${numbers} de la foto${prefix}`
    : `${pages.length > 1 ? 'Las páginas' : 'La página'} ${numbers}${prefix}`;
}

/** Same document (or none) for every page of a failed batch. */
function groupByDocument(pages: AiDocumentPage[]): AiDocumentPage[][] {
  const groups = new Map<number, AiDocumentPage[]>();
  for (const page of pages) {
    const key = page.document?.index ?? 0;
    const list = groups.get(key) ?? [];
    list.push(page);
    groups.set(key, list);
  }
  return [...groups.values()];
}

type Progress = (done: number, total: number, stage: string) => Promise<void>;

function progressReporter(
  reportProgress: ReadDocumentOptions['reportProgress'],
): Progress {
  return async (done, total, stage) => {
    if (!reportProgress || total <= 0) return;
    try {
      await reportProgress({ done, total, stage, unit: 'páginas' });
    } catch {
      // Progress is best effort.
    }
  };
}

function unreadableWarning(numbers: number[], documentIndex?: number): string {
  const n = numbers;
  const where = documentIndex ? ` del documento ${documentIndex}` : ' del PDF';
  return `${n.length > 1 ? 'Las páginas' : 'La página'} ${n.join(', ')}${where} no ${n.length > 1 ? 'tienen' : 'tiene'} texto ni se ${n.length > 1 ? 'pudieron' : 'pudo'} dibujar; no se leyó.`;
}

type ExtractCommon = Omit<ReadDocumentOptions, 'file' | 'mimeType'>;

interface ExtractedPages<T> {
  batches: Array<{ items: AiDocumentPage[]; data: T }>;
  failedPages: AiDocumentPage[];
  warnings: string[];
}

/**
 * Prepared pages → validated answers, batch by batch. Shared by the one-file
 * and the several-files readers.
 */
async function extractPreparedPages<T>(
  options: ExtractCommon,
  pages: AiDocumentPage[],
  progress: Progress,
): Promise<ExtractedPages<T>> {
  const batchSize = Math.max(1, options.limits.pagesPerBatch);
  const context: ReadDocumentBatchContext = {
    totalPages: pages.length,
    totalBatches: Math.ceil(pages.length / batchSize),
  };
  const instructionFor = (batch: AiDocumentPage[]) =>
    typeof options.instruction === 'function'
      ? options.instruction(batch, context)
      : options.instruction;
  const label = options.logLabel ?? options.appKey;
  const fail = (error: AiExtractionError): never => {
    throw options.rawExtractionErrors ? error : error.toHttpException();
  };

  let outcome;
  try {
    outcome = await options.extraction.extractBatches<AiDocumentPage, T>({
      appKey: options.appKey,
      schema: options.schema,
      items: pages,
      batchSize,
      concurrency: options.concurrency,
      quotaKey: options.quotaKey,
      variables: options.variables,
      buildMessages: (batch) => [
        { role: 'user', content: pagesMessageContent(instructionFor(batch), batch) },
      ],
      onProgress: (done, total) => progress(done, total, 'Leyendo con IA'),
    });
  } catch (error) {
    if (error instanceof AiExtractionError) {
      logger.error(`[${label}] ${error.failure}: ${error.message}`);
      fail(error);
    }
    throw error;
  }

  if (!outcome.results.length && outcome.failed.length) {
    const first = outcome.failed[0];
    logger.error(`[${label}] no page could be read: ${first.failure}: ${first.message}`);
    fail(new AiExtractionError(first.failure, first.message));
  }

  const warnings: string[] = [];
  for (const failed of outcome.failed) {
    for (const group of groupByDocument(failed.items)) {
      warnings.push(
        failed.failure === 'truncated'
          ? `${pageList(group)} ${group.length > 1 ? 'tienen' : 'tiene'} demasiados datos para leerse de una vez y no se cargaron. Súbelas aparte o usa una hoja de cálculo.`
          : `${pageList(group)} no se ${group.length > 1 ? 'pudieron' : 'pudo'} interpretar y no se cargaron. Revisa que se vean nítidas.`,
      );
    }
  }

  const order = (items: AiDocumentPage[]) =>
    Math.min(...items.map((p) => (p.document?.index ?? 0) * 10_000 + p.page_number));
  const batches = [...outcome.results]
    .sort((a, b) => order(a.items) - order(b.items))
    .map((r) => ({ items: r.items, data: r.data }));
  return {
    batches,
    failedPages: outcome.failed.flatMap((f) => f.items),
    warnings,
  };
}

/**
 * PDF or photo → validated answers, page batch by page batch (plan ia-cargas
 * §3.2 steps 5–7):
 *
 * 1. `DocumentPagesService.prepareForAi`: native text first, scans and photos
 *    as images (tall photos in strips), page cap of the profile.
 * 2. `AiExtractionService.extractBatches`: `pagesPerBatch` pages per call
 *    with the schema; a truncated batch is halved; real progress by pages.
 * 3. Pages that still cannot be read are reported by number. If NO page could
 *    be read the load fails with the extraction error (`AI_INGEST_*`).
 */
export async function readDocumentWithAi<T>(
  options: ReadDocumentOptions,
): Promise<ReadDocumentResult<T>> {
  const progress = progressReporter(options.reportProgress);

  const prepared = await options.pages.prepareForAi(
    {
      buffer: options.file.buffer,
      mimetype: options.mimeType,
      size: options.file.buffer.length,
      originalname: options.file.originalName ?? 'documento',
    },
    {
      maxPages: options.limits.maxPages,
      maxBytes: options.maxBytes,
      imageMaxEdge: options.imageMaxEdge,
      splitTallImages: options.splitTallImages,
      renderTextPages: options.renderTextPages,
      onPage: (done, total) => progress(done, total, 'Preparando páginas'),
    },
  );

  const warnings: string[] = [];
  if (prepared.unreadable_pages.length) {
    warnings.push(unreadableWarning(prepared.unreadable_pages));
  }

  const read = await extractPreparedPages<T>(options, prepared.pages, progress);
  warnings.push(...read.warnings);

  const batches = read.batches.map((b) => ({
    pages: b.items.map((p) => p.page_number),
    data: b.data,
  }));
  const missingPages = [
    ...prepared.unreadable_pages,
    ...read.failedPages.map((p) => p.page_number),
  ].sort((a, b) => a - b);

  return {
    answers: batches.map((b) => b.data),
    batches,
    pages: prepared.pages.length,
    textPages: prepared.pages.filter((p) => p.mode === 'text').length,
    missingPages,
    warnings,
  };
}

// ─── Several files read as ONE document ─────────────────────────────────────

export interface ReadDocumentsFile extends ReadDocumentFile {
  /** REAL type from the ai-ingest detector (never the multipart/S3 one). */
  mimeType: string;
}

export interface ReadDocumentsOptions extends ExtractCommon {
  /** Files of ONE document (one sale, one habilitación), in upload order. */
  files: ReadDocumentsFile[];
  /**
   * Pages of all files together. Over it the load fails with
   * `AI_INGEST_TOO_MANY_PAGES` before any model call. Default: no total cap.
   */
  maxTotalPages?: number;
}

/** A page of one of the files: `document` is 1-based in upload order. */
export interface DocumentPageRef {
  document: number;
  page: number;
}

export interface ReadDocumentsResult<T> {
  /** One validated answer per batch, in document/page order. */
  batches: Array<{ pages: DocumentPageRef[]; data: T }>;
  /** Files read. */
  documents: number;
  /** Pages (or photo strips) read, all files together. */
  pages: number;
  /** Pages read from native PDF text only. */
  textPages: number;
  /** Pages that could not be read (unreadable or a batch the model failed). */
  missingPages: DocumentPageRef[];
  /** Spanish, ready to show: pages left out and why. */
  warnings: string[];
}

/**
 * Several files of ONE document (a sale: quotation + the buyer's RUT; a DIAN
 * habilitación: software + test numbering) → validated answers.
 *
 * Every file goes through `prepareForAi` (native text first, photos
 * straightened) with the per-file page cap; each page is labelled with its
 * document so the model can cross them, and pages of different files share a
 * batch: with `pagesPerBatch` ≥ the total pages the whole set is read in ONE
 * call, as the scanners always did.
 */
export async function readDocumentsWithAi<T>(
  options: ReadDocumentsOptions,
): Promise<ReadDocumentsResult<T>> {
  const progress = progressReporter(options.reportProgress);
  const count = options.files.length;
  const all: AiDocumentPage[] = [];
  const warnings: string[] = [];
  const unreadable: DocumentPageRef[] = [];

  for (const [i, file] of options.files.entries()) {
    const index = i + 1;
    const prepared = await options.pages.prepareForAi(
      {
        buffer: file.buffer,
        mimetype: file.mimeType,
        size: file.buffer.length,
        originalname: file.originalName ?? `documento-${index}`,
      },
      {
        maxPages: options.limits.maxPages,
        maxBytes: options.maxBytes,
        imageMaxEdge: options.imageMaxEdge,
        splitTallImages: options.splitTallImages,
        renderTextPages: options.renderTextPages,
      },
    );
    const document = count > 1 ? { index, count } : undefined;
    all.push(...prepared.pages.map((p) => (document ? { ...p, document } : p)));
    if (prepared.unreadable_pages.length) {
      warnings.push(unreadableWarning(prepared.unreadable_pages, document ? index : undefined));
      unreadable.push(...prepared.unreadable_pages.map((page) => ({ document: index, page })));
    }
    if (options.maxTotalPages && all.length > options.maxTotalPages) {
      throw new VendixHttpException(
        ErrorCodes.AI_INGEST_TOO_MANY_PAGES,
        `Los documentos suman más de ${options.maxTotalPages} páginas. Sube solo las páginas que hacen falta o divide la carga.`,
      );
    }
    await progress(index, count, 'Preparando documentos');
  }

  const read = await extractPreparedPages<T>(options, all, progress);
  warnings.push(...read.warnings);

  const ref = (p: AiDocumentPage): DocumentPageRef => ({
    document: p.document?.index ?? 1,
    page: p.page_number,
  });
  const missingPages = [...unreadable, ...read.failedPages.map(ref)].sort(
    (a, b) => a.document - b.document || a.page - b.page,
  );

  return {
    batches: read.batches.map((b) => ({ pages: b.items.map(ref), data: b.data })),
    documents: count,
    pages: all.length,
    textPages: all.filter((p) => p.mode === 'text').length,
    missingPages,
    warnings,
  };
}
