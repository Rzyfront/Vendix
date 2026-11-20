import type { AiDocumentPage } from './document-pages.service';
import type {
  ReadDocumentBatchContext,
  ReadDocumentResult,
  ReadDocumentsResult,
  DocumentPageRef,
} from './document-reader';

/**
 * First text of one batch of a form or document scanner (plan ia-cargas F5b).
 *
 * - One photo read in one call: the scanner's request, word for word, as
 *   before (the photo goes right after it).
 * - PDF pages or several files: the same request plus a line saying the pages
 *   follow labelled, as PDF text and/or image.
 * - A document cut in several batches (only when the model cut its answer or
 *   the document is long): which pages this message holds, and that what is
 *   not printed on them must stay empty instead of being invented.
 */
export function buildFormInstruction(
  base: string,
  batch: AiDocumentPage[],
  context: ReadDocumentBatchContext,
  linesHint?: string,
): string {
  const single = context.totalBatches <= 1;
  const photo =
    single &&
    context.totalPages === 1 &&
    batch.every((p) => p.mode === 'image' && !p.document);
  if (photo) return base;

  const parts = [
    base,
    'The pages follow, each one labelled; a page comes as the text extracted from the PDF, as an image of the page, or both (then the image shows the layout and the text gives the exact characters).',
  ];
  if (!single) {
    const labels = batch.map((p) =>
      p.document && p.document.count > 1
        ? `document ${p.document.index} page ${p.page_number}`
        : `page ${p.page_number}`,
    );
    parts.push(
      `This message holds only ${labels.join(', ')} out of ${context.totalPages} pages; the other pages are read in separate messages. ` +
        'Fill a field ONLY if it is printed on these pages; otherwise use "" or null. Never invent a value.' +
        (linesHint ? ` ${linesHint}` : ''),
    );
  }
  return parts.join('\n\n');
}

/** What was read, for the optional `scan_source` of a scanner result. */
export interface DocumentScanSource {
  /** Files read (several only in multi-file scanners). */
  documents?: number;
  /** Pages (or photo strips) read. */
  pages: number;
  /** Pages read from native PDF text only. */
  text_pages: number;
  /** Model calls the document needed (1 = read in one call, as before). */
  batches: number;
  /** Pages that could not be read: numbers, or `{document, page}` with several files. */
  missing_pages?: Array<number | DocumentPageRef>;
}

export function scanSourceOf(
  read: ReadDocumentResult<unknown> | ReadDocumentsResult<unknown>,
): DocumentScanSource {
  const several = 'documents' in read;
  return {
    ...(several ? { documents: read.documents } : {}),
    pages: read.pages,
    text_pages: read.textPages,
    batches: read.batches.length,
    ...(read.missingPages.length ? { missing_pages: read.missingPages } : {}),
  };
}

/** "Two values for X" warnings of a merged form, with the screen's labels. */
export function conflictWarnings(
  conflicts: string[],
  labels: Record<string, string>,
): string[] {
  return conflicts
    .filter((key) => labels[key])
    .map(
      (key) =>
        `El documento muestra dos valores distintos para «${labels[key]}»; se tomó el de la primera página donde aparece. Revísalo.`,
    );
}
