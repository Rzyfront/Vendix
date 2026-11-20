import { Logger } from '@nestjs/common';
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

export interface ReadDocumentOptions {
  file: ReadDocumentFile;
  /** REAL type from the ai-ingest detector (never the multipart/S3 one). */
  mimeType: string;
  pages: DocumentPagesService;
  extraction: AiExtractionService;
  appKey: string;
  /** Schema of the answer for ONE batch of pages. */
  schema: ExtractionSchema;
  /** First text of every batch message. */
  instruction: string;
  limits: Pick<IngestLimits, 'maxPages' | 'pagesPerBatch'>;
  /** One per load: every batch, repair and split charges the same unit. */
  quotaKey: string;
  reportProgress?: (progress: AiJobProgress) => Promise<void>;
  /** Calls in flight. Default 3. */
  concurrency?: number;
  logLabel?: string;
}

export interface ReadDocumentResult<T> {
  /** One validated answer per batch of pages, in page order. */
  answers: T[];
  /** Pages (or photo strips) read. */
  pages: number;
  /** Pages read from native PDF text only. */
  textPages: number;
  /** Spanish, ready to show: pages left out and why. */
  warnings: string[];
}

const logger = new Logger('AiIngestDocumentReader');

function pageList(pages: AiDocumentPage[]): string {
  const strips = pages[0]?.strip;
  const numbers = pages.map((p) => p.page_number).join(', ');
  return strips
    ? `${pages.length > 1 ? 'Las partes' : 'La parte'} ${numbers} de la foto`
    : `${pages.length > 1 ? 'Las páginas' : 'La página'} ${numbers}`;
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
  const progress = async (done: number, total: number, stage: string) => {
    if (!options.reportProgress || total <= 0) return;
    try {
      await options.reportProgress({ done, total, stage, unit: 'páginas' });
    } catch {
      // Progress is best effort.
    }
  };

  const prepared = await options.pages.prepareForAi(
    {
      buffer: options.file.buffer,
      mimetype: options.mimeType,
      size: options.file.buffer.length,
      originalname: options.file.originalName ?? 'documento',
    },
    {
      maxPages: options.limits.maxPages,
      onPage: (done, total) => progress(done, total, 'Preparando páginas'),
    },
  );

  const warnings: string[] = [];
  if (prepared.unreadable_pages.length) {
    const n = prepared.unreadable_pages;
    warnings.push(
      `${n.length > 1 ? 'Las páginas' : 'La página'} ${n.join(', ')} del PDF no ${n.length > 1 ? 'tienen' : 'tiene'} texto ni se ${n.length > 1 ? 'pudieron' : 'pudo'} dibujar; no se leyó.`,
    );
  }

  let outcome;
  try {
    outcome = await options.extraction.extractBatches<AiDocumentPage, T>({
      appKey: options.appKey,
      schema: options.schema,
      items: prepared.pages,
      batchSize: Math.max(1, options.limits.pagesPerBatch),
      concurrency: options.concurrency,
      quotaKey: options.quotaKey,
      buildMessages: (batch) => [
        { role: 'user', content: pagesMessageContent(options.instruction, batch) },
      ],
      onProgress: (done, total) => progress(done, total, 'Leyendo con IA'),
    });
  } catch (error) {
    if (error instanceof AiExtractionError) {
      logger.error(`[${options.logLabel ?? options.appKey}] ${error.failure}: ${error.message}`);
      throw error.toHttpException();
    }
    throw error;
  }

  if (!outcome.results.length && outcome.failed.length) {
    const first = outcome.failed[0];
    logger.error(
      `[${options.logLabel ?? options.appKey}] no page could be read: ${first.failure}: ${first.message}`,
    );
    throw new AiExtractionError(first.failure, first.message).toHttpException();
  }
  for (const failed of outcome.failed) {
    warnings.push(
      failed.failure === 'truncated'
        ? `${pageList(failed.items)} ${failed.items.length > 1 ? 'tienen' : 'tiene'} demasiados datos para leerse de una vez y no se cargaron. Súbelas aparte o usa una hoja de cálculo.`
        : `${pageList(failed.items)} no se ${failed.items.length > 1 ? 'pudieron' : 'pudo'} interpretar y no se cargaron. Revisa que se vean nítidas.`,
    );
  }

  const firstPage = (items: AiDocumentPage[]) =>
    Math.min(...items.map((p) => p.page_number));
  const answers = [...outcome.results]
    .sort((a, b) => firstPage(a.items) - firstPage(b.items))
    .map((r) => r.data);

  return {
    answers,
    pages: prepared.pages.length,
    textPages: prepared.pages.filter((p) => p.mode === 'text').length,
    warnings,
  };
}
