import type { AIMessageContentPart } from '../../../ai-engine/interfaces/ai-provider.interface';
import type { AiDocumentPage } from './document-pages.service';

/**
 * "Native text first" (plan ia-cargas §3.2 step 5): how the model should read
 * one PDF page. Digital PDFs (e-invoices, ERP exports) carry exact text that
 * is cheaper and more precise than a picture of it.
 */
export type PageReadMode = 'text' | 'text+image' | 'image';

/** Native text at or above this many characters can stand alone… */
export const MIN_NATIVE_TEXT_CHARS = 200;
/** …if this share of its non-space characters are letters or digits. */
export const MIN_NATIVE_TEXT_ALNUM_RATIO = 0.6;
/** Below this, the text is noise (page numbers, a stamp) and the page is a scan. */
export const MIN_HINT_TEXT_CHARS = 20;

export function classifyPageText(text: string | null | undefined): PageReadMode {
  const compact = (text ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length < MIN_HINT_TEXT_CHARS) return 'image';
  const visible = compact.replace(/\s/g, '');
  const alnum = (visible.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const ratio = visible.length ? alnum / visible.length : 0;
  if (compact.length >= MIN_NATIVE_TEXT_CHARS && ratio >= MIN_NATIVE_TEXT_ALNUM_RATIO) {
    return 'text';
  }
  return 'text+image';
}

function pageLabel(page: AiDocumentPage): string {
  const doc =
    page.document && page.document.count > 1
      ? `Document ${page.document.index} of ${page.document.count}, `
      : '';
  if (page.strip) {
    return `${doc}Image part ${page.strip.index} of ${page.strip.count} (top to bottom; consecutive parts overlap a little, do not repeat a row that appears in both)`;
  }
  return `${doc}${doc ? 'page' : 'Page'} ${page.page_number}`;
}

/**
 * Content parts of one page for a multimodal user message. Never a raw PDF:
 * text pages travel as text, scanned pages as the rendered JPEG.
 */
export function pageContentParts(page: AiDocumentPage): AIMessageContentPart[] {
  const label = pageLabel(page);
  const parts: AIMessageContentPart[] = [];
  if (page.mode === 'text') {
    parts.push({ type: 'text', text: `--- ${label} (text extracted from the PDF) ---\n${page.text}` });
    return parts;
  }
  if (page.mode === 'text+image') {
    parts.push({
      type: 'text',
      text: `--- ${label} (partial text extracted from the PDF; the image below is the same page) ---\n${page.text}`,
    });
  } else {
    parts.push({ type: 'text', text: `--- ${label} ---` });
  }
  if (page.image) {
    parts.push({ type: 'image_url', image_url: { url: page.image, detail: 'high' } });
  }
  return parts;
}

/** One instruction followed by the pages of a batch, as a single user message content. */
export function pagesMessageContent(
  instruction: string,
  pages: AiDocumentPage[],
): AIMessageContentPart[] {
  return [{ type: 'text', text: instruction }, ...pages.flatMap(pageContentParts)];
}
